"""Companion settings, loaded from environment variables (HUB_COMPANION_*) or a .env file."""

from __future__ import annotations

import os
import platform
import socket
from functools import lru_cache
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def default_config_dir() -> Path:
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "hub-companion"
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "hub-companion"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HUB_COMPANION_", env_file=".env", extra="ignore")

    # Local Ollama endpoint. Keep it on loopback — the companion is the only thing that talks to it.
    ollama_url: str = "http://127.0.0.1:11434"
    # Optional allow-list of model names jobs may use. Empty = any locally installed model.
    allowed_models: Annotated[list[str], NoDecode] = Field(default_factory=list)
    max_concurrent_jobs: int = Field(default=2, ge=1, le=16)
    max_context_length: int = Field(default=32_768, ge=2048, le=262_144)
    max_output_tokens: int = Field(default=8_192, ge=64, le=65_536)
    max_embed_inputs: int = Field(default=64, ge=1, le=512)
    config_dir: Path = Field(default_factory=default_config_dir)
    device_name: str = Field(default_factory=lambda: socket.gethostname().removesuffix(".local"))
    # Allow ws:// / http:// to non-local servers (development only).
    allow_insecure: bool = False
    log_level: str = "INFO"

    @field_validator("allowed_models", mode="before")
    @classmethod
    def _split_models(cls, value: object) -> object:
        if isinstance(value, str):
            return [m.strip() for m in value.split(",") if m.strip()]
        return value

    @field_validator("ollama_url")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.rstrip("/")

    @property
    def credentials_path(self) -> Path:
        return self.config_dir / "credentials.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def is_local_host(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".localhost")


def ensure_secure_server(url: str, allow_insecure: bool) -> str:
    """Require HTTPS for remote servers so tokens and prompts are always encrypted in transit."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"Invalid server URL: {url}")
    if parsed.scheme != "https" and not is_local_host(url) and not allow_insecure:
        raise ValueError("The server URL must use https:// (use --insecure only for local development).")
    return url.rstrip("/")
