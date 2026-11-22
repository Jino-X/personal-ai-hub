"""Pairing and token management against the Personal AI Hub API."""

from __future__ import annotations

import asyncio
import logging
import platform
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

from hub_companion import __version__, credentials
from hub_companion.config import Settings

log = logging.getLogger(__name__)


class DeviceRevokedError(Exception):
    """The server revoked this device; it must be paired again."""


class AuthError(Exception):
    """Credentials were rejected."""


@dataclass
class AccessToken:
    token: str
    expires_at: float  # epoch seconds
    ttl_s: int

    @property
    def remaining_s(self) -> float:
        return self.expires_at - time.time()


def _parse_expiry(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _error_message(response: httpx.Response) -> str:
    try:
        return response.json().get("error", {}).get("message") or response.text
    except ValueError:
        return response.text


def platform_label() -> str:
    return f"{platform.system()} {platform.release()} ({platform.machine()})"


async def pair(settings: Settings, server_url: str, code: str, name: str) -> credentials.Credentials:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            f"{server_url}/v1/devices/pair",
            json={"code": code, "name": name, "platform": platform_label(), "companion_version": __version__},
        )
    if response.status_code != 201:
        raise AuthError(f"Pairing failed ({response.status_code}): {_error_message(response)}")
    data = response.json()
    creds = credentials.Credentials(
        server_url=server_url,
        device_id=data["device_id"],
        refresh_token=data["refresh_token"],
        device_name=name,
        paired_at=datetime.now(UTC).isoformat(),
    )
    credentials.save(settings.credentials_path, creds)
    return creds


class TokenManager:
    """Keeps a valid short-lived access token, rotating the refresh token on each use."""

    def __init__(self, settings: Settings, creds: credentials.Credentials) -> None:
        self._settings = settings
        self._creds = creds
        self._token: AccessToken | None = None
        self._lock = asyncio.Lock()

    @property
    def creds(self) -> credentials.Credentials:
        return self._creds

    async def access_token(self, *, force: bool = False) -> AccessToken:
        async with self._lock:
            if force or self._token is None or self._token.remaining_s < 60:
                self._token = await self._refresh()
            return self._token

    async def _refresh(self) -> AccessToken:
        attempt = 0
        while True:
            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    response = await client.post(
                        f"{self._creds.server_url}/v1/devices/token",
                        json={"device_id": self._creds.device_id, "refresh_token": self._creds.refresh_token},
                    )
            except httpx.TransportError as exc:
                attempt += 1
                delay = min(60, 2**attempt)
                log.warning("Token refresh failed (%s); retrying in %ss", exc.__class__.__name__, delay)
                await asyncio.sleep(delay)
                continue

            if response.status_code == 403:
                raise DeviceRevokedError(_error_message(response))
            if response.status_code == 401:
                raise AuthError(_error_message(response))
            if response.status_code == 429 or response.status_code >= 500:
                attempt += 1
                delay = min(60, 2**attempt)
                log.warning("Token endpoint returned %s; retrying in %ss", response.status_code, delay)
                await asyncio.sleep(delay)
                continue
            response.raise_for_status()

            data = response.json()
            # Persist the rotated refresh token before using the new access token.
            self._creds.refresh_token = data["refresh_token"]
            credentials.save(self._settings.credentials_path, self._creds)
            return AccessToken(
                token=data["access_token"],
                expires_at=_parse_expiry(data["access_token_expires_at"]),
                ttl_s=int(data.get("access_token_ttl_s", 900)),
            )
