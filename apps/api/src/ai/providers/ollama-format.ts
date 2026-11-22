import { randomUUID } from "node:crypto";
import type { ChatChunk, ChatMessage, ChatOptions, ChatResult, ModelInfo, ToolCall } from "../types";

/**
 * Ollama wire format helpers, shared by the direct Ollama provider and the
 * companion provider (the companion forwards these requests to its local Ollama).
 */

export interface OllamaChatRequest {
  model: string;
  messages: Record<string, unknown>[];
  stream: boolean;
  think?: boolean;
  format?: Record<string, unknown> | "json";
  tools?: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
  options: { num_ctx?: number; temperature?: number; num_predict?: number };
  keep_alive?: string;
}

export function buildOllamaChatRequest(messages: ChatMessage[], opts: ChatOptions, stream: boolean): OllamaChatRequest {
  return {
    model: opts.model,
    stream,
    messages: messages.map((m) => {
      const out: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.tool_calls?.length) out.tool_calls = m.tool_calls.map((t) => ({ function: { name: t.name, arguments: t.arguments } }));
      if (m.role === "tool" && m.tool_name) out.tool_name = m.tool_name;
      return out;
    }),
    // Thinking is opt-in; structured output always runs without it for speed and reliability.
    think: opts.format ? false : Boolean(opts.think),
    ...(opts.format ? { format: opts.format } : {}),
    ...(opts.tools?.length
      ? { tools: opts.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) }
      : {}),
    options: {
      ...(opts.contextLength ? { num_ctx: opts.contextLength } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
    },
    keep_alive: "15m",
  };
}

interface OllamaMessage {
  content?: string;
  thinking?: string;
  tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
}

interface OllamaChatResponse {
  model?: string;
  message?: OllamaMessage;
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

function parseToolCalls(raw: OllamaMessage["tool_calls"]): ToolCall[] {
  return (raw ?? [])
    .filter((t) => t.function?.name)
    .map((t) => {
      let args: unknown = t.function?.arguments ?? {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      return {
        id: t.id ?? `call_${randomUUID().slice(0, 12)}`,
        name: t.function!.name!,
        arguments: (args && typeof args === "object" ? args : {}) as Record<string, unknown>,
      };
    });
}

export function parseOllamaChunk(raw: unknown): ChatChunk {
  const r = (raw ?? {}) as OllamaChatResponse;
  if (r.error) throw new Error(r.error);
  const toolCalls = parseToolCalls(r.message?.tool_calls);
  return {
    content: r.message?.content || undefined,
    thinking: r.message?.thinking || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    done: Boolean(r.done),
    usage: r.done
      ? {
          prompt_tokens: r.prompt_eval_count,
          completion_tokens: r.eval_count,
          total_duration_ms: r.total_duration ? Math.round(r.total_duration / 1e6) : undefined,
        }
      : undefined,
  };
}

export function parseOllamaChatResult(raw: unknown, fallbackModel: string): ChatResult {
  const r = (raw ?? {}) as OllamaChatResponse;
  const chunk = parseOllamaChunk(r);
  return {
    content: chunk.content ?? "",
    thinking: chunk.thinking ?? "",
    toolCalls: chunk.toolCalls ?? [],
    model: r.model ?? fallbackModel,
    usage: chunk.usage,
  };
}

export function parseOllamaModels(raw: unknown): ModelInfo[] {
  const models = ((raw ?? {}) as { models?: { name?: string; model?: string; size?: number; details?: Record<string, string> }[] }).models ?? [];
  return models
    .filter((m) => m.name || m.model)
    .map((m) => ({
      name: (m.name ?? m.model)!,
      size: m.size,
      family: m.details?.family ?? null,
      parameter_size: m.details?.parameter_size ?? null,
      quantization: m.details?.quantization_level ?? null,
    }));
}

/** "qwen3:8b" matches "qwen3:8b" and "qwen3:8b-q4_K_M"; "nomic-embed-text" matches "nomic-embed-text:latest". */
export function modelAvailable(models: { name: string }[], wanted: string): boolean {
  const w = wanted.toLowerCase();
  const base = w.includes(":") ? w : `${w}:latest`;
  return models.some((m) => {
    const n = m.name.toLowerCase();
    return n === w || n === base || n.startsWith(`${w}-`);
  });
}
