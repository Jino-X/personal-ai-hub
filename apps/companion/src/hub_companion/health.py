"""Device and Ollama health reporting (sent with every heartbeat)."""

from __future__ import annotations

import asyncio
from typing import Any

from hub_companion import __version__
from hub_companion.auth import platform_label
from hub_companion.config import Settings
from hub_companion.jobs import JobExecutor
from hub_companion.ollama import OllamaClient, OllamaError


async def collect_health(settings: Settings, ollama: OllamaClient, executor: JobExecutor) -> dict[str, Any]:
    base: dict[str, Any] = {
        "ollama_reachable": False,
        "ollama_version": None,
        "models": [],
        "running_models": [],
        "active_jobs": executor.active_jobs,
        "companion_version": __version__,
        "platform": platform_label(),
    }
    try:
        version, tags, running = await asyncio.gather(ollama.version(), ollama.tags(), ollama.running())
    except OllamaError:
        return base

    allowed = {m.lower() for m in settings.allowed_models}
    models = []
    for m in tags:
        name = m.get("name") or m.get("model")
        if not name or (allowed and name.lower() not in allowed and name.lower().split(":")[0] not in allowed):
            continue
        details = m.get("details") or {}
        models.append(
            {
                "name": name,
                "size": m.get("size"),
                "family": details.get("family"),
                "parameter_size": details.get("parameter_size"),
                "quantization": details.get("quantization_level"),
            }
        )
    executor.update_installed_models([m["name"] for m in models])
    return {
        **base,
        "ollama_reachable": True,
        "ollama_version": version,
        "models": models,
        "running_models": [r.get("name") for r in running if r.get("name")],
    }
