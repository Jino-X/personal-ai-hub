"""Validation and execution of inference jobs received from the API.

Jobs are untrusted input: every payload is rebuilt from an explicit allow-list of
fields, model names are checked against the locally installed (and optionally
allow-listed) models, and resource limits are clamped before anything reaches Ollama.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from hub_companion.config import Settings
from hub_companion.ollama import OllamaClient, OllamaError

log = logging.getLogger(__name__)

Send = Callable[[dict[str, Any]], Awaitable[None]]
MODEL_PATTERN = r"^[A-Za-z0-9][\w.:\-/]{0,119}$"


class JobRejected(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class JobMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    job_id: str = Field(min_length=1, max_length=64)
    op: Literal["chat", "embed", "health"]
    payload: dict[str, Any] = Field(default_factory=dict)
    timeout_ms: int = Field(default=180_000, ge=1_000, le=900_000)


class ToolFunction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(max_length=64)
    description: str = Field(default="", max_length=2_000)
    parameters: dict[str, Any] = Field(default_factory=dict)


class Tool(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["function"] = "function"
    function: ToolFunction


class ChatMessageIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    role: Literal["system", "user", "assistant", "tool"]
    content: str = Field(default="", max_length=400_000)
    tool_calls: list[dict[str, Any]] | None = Field(default=None, max_length=32)
    tool_name: str | None = Field(default=None, max_length=64)


class ChatOptionsIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    num_ctx: int | None = Field(default=None, ge=512)
    temperature: float | None = Field(default=None, ge=0, le=2)
    num_predict: int | None = Field(default=None, ge=1)


class ChatPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    model: str = Field(pattern=MODEL_PATTERN)
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=400)
    stream: bool = False
    think: bool | None = None
    format: dict[str, Any] | Literal["json"] | None = None
    tools: list[Tool] | None = Field(default=None, max_length=32)
    options: ChatOptionsIn = Field(default_factory=ChatOptionsIn)
    keep_alive: str | None = Field(default=None, pattern=r"^\d{1,4}[smh]$")


class EmbedPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    model: str = Field(pattern=MODEL_PATTERN)
    input: list[str] = Field(min_length=1)
    truncate: bool = True

    @field_validator("input")
    @classmethod
    def _limit_length(cls, value: list[str]) -> list[str]:
        for text in value:
            if len(text) > 200_000:
                raise ValueError("input text too long")
        return value


def _model_matches(installed: set[str], wanted: str) -> bool:
    wanted = wanted.lower()
    candidates = {wanted, wanted if ":" in wanted else f"{wanted}:latest"}
    return any(name in candidates or name.startswith(f"{wanted}-") for name in installed)


class JobExecutor:
    def __init__(self, settings: Settings, ollama: OllamaClient) -> None:
        self._settings = settings
        self._ollama = ollama
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._installed: set[str] = set()

    @property
    def active_jobs(self) -> int:
        return len(self._tasks)

    def update_installed_models(self, names: list[str]) -> None:
        self._installed = {n.lower() for n in names}

    def _check_model(self, model: str) -> None:
        allowed = self._settings.allowed_models
        if allowed and not _model_matches({m.lower() for m in allowed}, model):
            raise JobRejected("model_not_allowed", f"Model '{model}' is not in this device's allow-list")
        if self._installed and not _model_matches(self._installed, model):
            raise JobRejected("model_not_installed", f"Model '{model}' is not installed. Run: ollama pull {model}")

    def _chat_request(self, raw: dict[str, Any]) -> dict[str, Any]:
        payload = ChatPayload.model_validate(raw)
        self._check_model(payload.model)
        options: dict[str, Any] = {}
        if payload.options.num_ctx:
            options["num_ctx"] = min(payload.options.num_ctx, self._settings.max_context_length)
        if payload.options.temperature is not None:
            options["temperature"] = payload.options.temperature
        options["num_predict"] = min(payload.options.num_predict or self._settings.max_output_tokens, self._settings.max_output_tokens)
        request: dict[str, Any] = {
            "model": payload.model,
            "messages": [m.model_dump(exclude_none=True) for m in payload.messages],
            "options": options,
            "keep_alive": payload.keep_alive or "15m",
        }
        if payload.think is not None:
            request["think"] = payload.think
        if payload.format is not None:
            request["format"] = payload.format
        if payload.tools:
            request["tools"] = [t.model_dump() for t in payload.tools]
        return request

    def _embed_request(self, raw: dict[str, Any]) -> dict[str, Any]:
        payload = EmbedPayload.model_validate(raw)
        if len(payload.input) > self._settings.max_embed_inputs:
            raise JobRejected("too_many_inputs", f"At most {self._settings.max_embed_inputs} inputs per embedding job")
        self._check_model(payload.model)
        return {"model": payload.model, "input": payload.input, "truncate": payload.truncate, "keep_alive": "15m"}

    def submit(self, message: dict[str, Any], send: Send, health: Callable[[], Awaitable[dict[str, Any]]]) -> None:
        try:
            job = JobMessage.model_validate(message)
        except ValidationError:
            log.warning("Ignoring malformed job message")
            return
        if job.job_id in self._tasks:
            return
        task = asyncio.create_task(self._run(job, send, health), name=f"job-{job.job_id}")
        self._tasks[job.job_id] = task
        task.add_done_callback(lambda _t: self._tasks.pop(job.job_id, None))

    def cancel(self, job_id: str) -> None:
        task = self._tasks.get(job_id)
        if task:
            task.cancel()

    def cancel_all(self) -> None:
        for task in list(self._tasks.values()):
            task.cancel()

    async def _run(self, job: JobMessage, send: Send, health: Callable[[], Awaitable[dict[str, Any]]]) -> None:
        async def fail(code: str, message: str, retryable: bool) -> None:
            await send({"type": "job_error", "job_id": job.job_id, "error": {"code": code, "message": message, "retryable": retryable}})

        try:
            async with self._semaphore, asyncio.timeout(job.timeout_ms / 1000):
                if job.op == "health":
                    await send({"type": "result", "job_id": job.job_id, "data": await health()})
                elif job.op == "embed":
                    result = await self._ollama.embed(self._embed_request(job.payload))
                    await send({"type": "result", "job_id": job.job_id, "data": {"embeddings": result.get("embeddings", [])}})
                elif job.op == "chat":
                    request = self._chat_request(job.payload)
                    if job.payload.get("stream"):
                        async for chunk in self._ollama.chat_stream(request):
                            await send({"type": "chunk", "job_id": job.job_id, "data": chunk})
                        await send({"type": "result", "job_id": job.job_id, "data": {}})
                    else:
                        await send({"type": "result", "job_id": job.job_id, "data": await self._ollama.chat(request)})
                log.info("Job %s (%s) completed", job.job_id[:8], job.op)
        except asyncio.CancelledError:
            log.info("Job %s cancelled", job.job_id[:8])
            raise
        except TimeoutError:
            await fail("timeout", "Inference timed out on the device", True)
        except JobRejected as exc:
            await fail(exc.code, str(exc), False)
        except ValidationError as exc:
            await fail("invalid_payload", f"Job payload rejected: {exc.error_count()} validation error(s)", False)
        except OllamaError as exc:
            await fail("ollama_error", str(exc), exc.retryable)
        except Exception as exc:  # noqa: BLE001 — report and keep the connection alive
            log.exception("Unexpected job failure")
            await fail("internal_error", f"{exc.__class__.__name__}", True)
