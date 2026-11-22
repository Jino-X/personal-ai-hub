"""Persistent, self-healing WebSocket connection to the Personal AI Hub API.

The companion only ever makes outbound connections (HTTPS/WSS), so nothing on the
Mac needs to accept inbound traffic and Ollama stays bound to localhost.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from typing import Any

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

from hub_companion import __version__
from hub_companion.auth import AuthError, DeviceRevokedError, TokenManager, platform_label
from hub_companion.config import Settings
from hub_companion.health import collect_health
from hub_companion.jobs import JobExecutor
from hub_companion.ollama import OllamaClient

log = logging.getLogger(__name__)

MAX_BACKOFF_S = 60


class CompanionConnection:
    def __init__(self, settings: Settings, tokens: TokenManager, ollama: OllamaClient) -> None:
        self._settings = settings
        self._tokens = tokens
        self._ollama = ollama
        self._executor = JobExecutor(settings, ollama)
        self._send_lock = asyncio.Lock()
        self._heartbeat_interval = 20.0
        self._fatal: BaseException | None = None

    @property
    def connect_url(self) -> str:
        base = self._tokens.creds.server_url
        return base.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/v1/devices/connect"

    async def run_forever(self) -> None:
        backoff = 1.0
        force_refresh = False
        while True:
            try:
                token = await self._tokens.access_token(force=force_refresh)
                force_refresh = False
                log.info("Connecting to %s", self.connect_url)
                async with connect(
                    self.connect_url,
                    additional_headers={"Authorization": f"Bearer {token.token}"},
                    user_agent_header=f"hub-companion/{__version__}",
                    open_timeout=15,
                    ping_interval=20,
                    ping_timeout=30,
                    max_size=16 * 1024 * 1024,
                    compression="deflate",
                ) as ws:
                    log.info("Connected — waiting for inference jobs")
                    backoff = 1.0
                    await self._session(ws)
            except DeviceRevokedError:
                raise
            except AuthError as exc:
                raise DeviceRevokedError(str(exc)) from exc
            except InvalidStatus as exc:
                status = exc.response.status_code
                if status == 403:
                    raise DeviceRevokedError("The server rejected this device (revoked).") from exc
                force_refresh = status == 401
                log.warning("Server refused the connection (HTTP %s)", status)
            except ConnectionClosed as exc:
                force_refresh = exc.rcvd is not None and exc.rcvd.code == 4001
                if exc.rcvd is not None and exc.rcvd.code == 4003:
                    raise DeviceRevokedError("The device was revoked from the web app.") from exc
                log.warning("Connection closed (%s)", exc.rcvd.reason if exc.rcvd else "no close frame")
            except (OSError, TimeoutError) as exc:
                log.warning("Connection failed: %s", exc)
            finally:
                self._executor.cancel_all()

            delay = min(MAX_BACKOFF_S, backoff) * (0.7 + random.random() * 0.6)  # noqa: S311 — jitter, not crypto
            log.info("Reconnecting in %.1fs", delay)
            await asyncio.sleep(delay)
            backoff = min(MAX_BACKOFF_S, backoff * 2)

    async def _send(self, ws: ClientConnection, message: dict[str, Any]) -> None:
        async with self._send_lock:
            await ws.send(json.dumps(message, separators=(",", ":")))

    async def _health(self) -> dict[str, Any]:
        return await collect_health(self._settings, self._ollama, self._executor)

    async def _session(self, ws: ClientConnection) -> None:
        async def send(message: dict[str, Any]) -> None:
            try:
                await self._send(ws, message)
            except ConnectionClosed:
                log.debug("Dropped message after disconnect")

        await send({"type": "hello", "companion_version": __version__, "platform": platform_label(), "health": await self._health()})

        self._fatal = None
        heartbeat = asyncio.create_task(self._heartbeat_loop(send), name="heartbeat")
        reauth = asyncio.create_task(self._reauth_loop(ws, send), name="reauth")
        try:
            async for raw in ws:
                if isinstance(raw, bytes):
                    continue
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                self._handle(message, send)
        finally:
            heartbeat.cancel()
            reauth.cancel()
            await asyncio.gather(heartbeat, reauth, return_exceptions=True)
        if self._fatal is not None:
            raise self._fatal

    def _handle(self, message: dict[str, Any], send: Any) -> None:
        kind = message.get("type")
        if kind == "welcome":
            interval = message.get("heartbeat_interval_ms")
            if isinstance(interval, int) and 5_000 <= interval <= 120_000:
                self._heartbeat_interval = interval / 1000
            log.info("Server accepted device %s", str(message.get("device_id", ""))[:8])
        elif kind == "job":
            self._executor.submit(message, send, self._health)
        elif kind == "cancel":
            self._executor.cancel(str(message.get("job_id", "")))
        elif kind == "reauth_ok":
            log.debug("Access token renewed")
        elif kind == "error":
            log.warning("Server error: %s", message.get("message"))

    async def _heartbeat_loop(self, send: Any) -> None:
        while True:
            await asyncio.sleep(self._heartbeat_interval)
            await send({"type": "heartbeat", "health": await self._health()})

    async def _reauth_loop(self, ws: ClientConnection, send: Any) -> None:
        """Renew the short-lived access token in-band before it expires."""
        try:
            while True:
                token = await self._tokens.access_token()
                await asyncio.sleep(max(30.0, token.remaining_s - 120))
                fresh = await self._tokens.access_token(force=True)
                await send({"type": "reauth", "access_token": fresh.token})
        except (DeviceRevokedError, AuthError) as exc:
            # Credentials are no longer valid: stop the session and surface the error.
            self._fatal = exc if isinstance(exc, DeviceRevokedError) else DeviceRevokedError(str(exc))
            await ws.close(code=1000, reason="credentials_invalid")
