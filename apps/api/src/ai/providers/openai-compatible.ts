import { randomUUID } from "node:crypto";
import { EMBEDDING_DIMENSIONS } from "@hub/shared";
import { ExternalServiceError } from "../../lib/errors";
import type { ChatChunk, ChatMessage, ChatOptions, ChatResult, EmbedOptions, ModelProvider, ProviderHealth, ToolCall } from "../types";

interface CloudConfig {
  baseUrl: string;
  apiKey: string;
  chatModel?: string;
  embeddingModel?: string;
}

/**
 * Optional cloud provider for any OpenAI-compatible Chat Completions API.
 * Disabled unless configured on the server AND enabled by the user (privacy first).
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = "openai_compatible" as const;

  constructor(
    private readonly cfg: CloudConfig,
    private readonly timeoutMs: number,
  ) {}

  resolveChatModel(requested: string) {
    return this.cfg.chatModel ?? requested;
  }

  resolveEmbeddingModel(requested: string) {
    return this.cfg.embeddingModel ?? requested;
  }

  private headers() {
    return { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` };
  }

  private signal(opts: { signal?: AbortSignal; timeoutMs?: number }) {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs);
    return opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  }

  private body(messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
    return {
      model: this.resolveChatModel(opts.model),
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      temperature: opts.temperature,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      messages: messages.map((m) => {
        if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id ?? m.tool_name ?? "tool", content: m.content };
        if (m.tool_calls?.length)
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.arguments) } })),
          };
        return { role: m.role, content: m.content };
      }),
      ...(opts.format
        ? {
            response_format:
              opts.format === "json"
                ? { type: "json_object" }
                : { type: "json_schema", json_schema: { name: "response", schema: opts.format, strict: false } },
          }
        : {}),
      ...(opts.tools?.length
        ? { tools: opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {}),
    };
  }

  private async post(path: string, body: unknown, signal: AbortSignal) {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal }).catch((err) => {
      throw new ExternalServiceError("cloud-ai", err instanceof Error ? err.message : "request failed", undefined, true);
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ExternalServiceError("cloud-ai", `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, res.status === 429 || res.status >= 500);
    }
    return res;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const res = await this.post("/chat/completions", this.body(messages, opts, false), this.signal(opts));
    const json = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = json.choices?.[0]?.message;
    return {
      content: msg?.content ?? "",
      thinking: "",
      toolCalls: (msg?.tool_calls ?? []).map((t) => ({ id: t.id, name: t.function.name, arguments: safeJson(t.function.arguments) })),
      model: json.model ?? this.resolveChatModel(opts.model),
      usage: { prompt_tokens: json.usage?.prompt_tokens, completion_tokens: json.usage?.completion_tokens },
    };
  }

  async *streamChat(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<ChatChunk> {
    const res = await this.post("/chat/completions", this.body(messages, opts, true), this.signal(opts));
    if (!res.body) throw new ExternalServiceError("cloud-ai", "empty response body");
    const decoder = new TextDecoder();
    const pendingTools = new Map<number, { id: string; name: string; args: string }>();
    let buffer = "";
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(part, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          const toolCalls: ToolCall[] = [...pendingTools.values()].map((t) => ({ id: t.id, name: t.name, arguments: safeJson(t.args) }));
          yield { done: true, toolCalls: toolCalls.length ? toolCalls : undefined };
          return;
        }
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const delta = json.choices?.[0]?.delta;
        for (const t of delta?.tool_calls ?? []) {
          const cur = pendingTools.get(t.index) ?? { id: t.id ?? `call_${randomUUID().slice(0, 12)}`, name: "", args: "" };
          if (t.function?.name) cur.name += t.function.name;
          if (t.function?.arguments) cur.args += t.function.arguments;
          pendingTools.set(t.index, cur);
        }
        if (delta?.content) yield { content: delta.content };
        if (json.usage) yield { usage: { prompt_tokens: json.usage.prompt_tokens, completion_tokens: json.usage.completion_tokens } };
      }
    }
  }

  async embed(texts: string[], opts: EmbedOptions): Promise<number[][]> {
    const res = await this.post(
      "/embeddings",
      { model: this.resolveEmbeddingModel(opts.model), input: texts, dimensions: EMBEDDING_DIMENSIONS },
      this.signal(opts),
    );
    const json = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const data = [...(json.data ?? [])].sort((a, b) => a.index - b.index);
    if (data.length !== texts.length) throw new ExternalServiceError("cloud-ai", "unexpected embedding response");
    return data.map((d) => d.embedding);
  }

  async health(): Promise<ProviderHealth> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/models`, { headers: this.headers(), signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return { available: false, detail: `Cloud provider returned HTTP ${res.status}`, models: [] };
      const json = (await res.json()) as { data?: { id: string }[] };
      return { available: true, detail: null, models: (json.data ?? []).slice(0, 200).map((m) => ({ name: m.id })) };
    } catch {
      return { available: false, detail: "Cloud provider is unreachable", models: [] };
    }
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
