"""Thin async client for the local Ollama HTTP API."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx


class OllamaError(Exception):
    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


class OllamaClient:
    def __init__(self, base_url: str) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(connect=5, read=600, write=30, pool=30),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str, timeout: float = 4) -> dict[str, Any]:
        try:
            response = await self._client.get(path, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as exc:
            raise OllamaError(f"GET {path} failed: {exc}", retryable=True) from exc

    async def version(self) -> str | None:
        return (await self._get("/api/version")).get("version")

    async def tags(self) -> list[dict[str, Any]]:
        return (await self._get("/api/tags")).get("models", [])

    async def running(self) -> list[dict[str, Any]]:
        return (await self._get("/api/ps")).get("models", [])

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._client.post(path, json=payload)
        except httpx.TransportError as exc:
            raise OllamaError(f"Ollama unreachable: {exc.__class__.__name__}", retryable=True) from exc
        if response.status_code >= 400:
            raise OllamaError(
                f"Ollama returned {response.status_code}: {response.text[:300]}",
                retryable=response.status_code >= 500,
            )
        return response.json()

    async def chat(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/chat", {**payload, "stream": False})

    async def embed(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/embed", payload)

    async def chat_stream(self, payload: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        try:
            async with self._client.stream("POST", "/api/chat", json={**payload, "stream": True}) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode(errors="replace")
                    raise OllamaError(
                        f"Ollama returned {response.status_code}: {body[:300]}",
                        retryable=response.status_code >= 500,
                    )
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    if "error" in chunk:
                        raise OllamaError(str(chunk["error"]), retryable=False)
                    yield chunk
        except httpx.TransportError as exc:
            raise OllamaError(f"Ollama stream failed: {exc.__class__.__name__}", retryable=True) from exc
