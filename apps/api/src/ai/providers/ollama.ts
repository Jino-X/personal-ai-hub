import { ExternalServiceError } from "../../lib/errors";
import type { ChatChunk, ChatMessage, ChatOptions, ChatResult, EmbedOptions, ModelProvider, ProviderHealth } from "../types";
import { buildOllamaChatRequest, parseOllamaChatResult, parseOllamaChunk, parseOllamaModels } from "./ollama-format";

/**
 * Talks to an Ollama server directly over HTTP. Intended for deployments where the
 * API runs on the same machine/private network as Ollama (OLLAMA_DIRECT_URL).
 * Ollama itself must never be exposed to the public internet.
 */
export class OllamaHttpProvider implements ModelProvider {
  readonly id = "ollama" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  resolveChatModel(requested: string) {
    return requested;
  }

  resolveEmbeddingModel(requested: string) {
    return requested;
  }

  private signal(opts: { signal?: AbortSignal; timeoutMs?: number }) {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs);
    return opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  }

  private async post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new ExternalServiceError("ollama", timedOut ? "request timed out" : "Ollama is unreachable", undefined, true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ExternalServiceError("ollama", `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, res.status >= 500);
    }
    return res;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const res = await this.post("/api/chat", buildOllamaChatRequest(messages, opts, false), this.signal(opts));
    return parseOllamaChatResult(await res.json(), opts.model);
  }

  async *streamChat(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<ChatChunk> {
    const res = await this.post("/api/chat", buildOllamaChatRequest(messages, opts, true), this.signal(opts));
    if (!res.body) throw new ExternalServiceError("ollama", "empty response body");
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(part, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield parseOllamaChunk(JSON.parse(line));
      }
    }
    if (buffer.trim()) yield parseOllamaChunk(JSON.parse(buffer));
  }

  async embed(texts: string[], opts: EmbedOptions): Promise<number[][]> {
    const res = await this.post("/api/embed", { model: opts.model, input: texts, truncate: true, keep_alive: "15m" }, this.signal(opts));
    const json = (await res.json()) as { embeddings?: number[][] };
    if (!json.embeddings || json.embeddings.length !== texts.length) throw new ExternalServiceError("ollama", "unexpected embedding response");
    return json.embeddings;
  }

  async health(): Promise<ProviderHealth> {
    try {
      const signal = AbortSignal.timeout(4_000);
      const [version, tags] = await Promise.all([
        fetch(`${this.baseUrl}/api/version`, { signal }).then((r) => r.json() as Promise<{ version?: string }>),
        fetch(`${this.baseUrl}/api/tags`, { signal }).then((r) => r.json()),
      ]);
      return { available: true, detail: null, version: version.version ?? null, models: parseOllamaModels(tags) };
    } catch {
      return { available: false, detail: `Ollama is not reachable at ${this.baseUrl}`, models: [] };
    }
  }
}
