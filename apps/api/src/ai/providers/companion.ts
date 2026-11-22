import { ExternalServiceError } from "../../lib/errors";
import type { DeviceGateway } from "../../devices/gateway";
import type { ChatChunk, ChatMessage, ChatOptions, ChatResult, EmbedOptions, ModelProvider, ProviderHealth } from "../types";
import { buildOllamaChatRequest, parseOllamaChatResult, parseOllamaChunk } from "./ollama-format";

/**
 * Routes inference to the user's local AI companion over the device gateway.
 * The companion validates each job and forwards it to Ollama on 127.0.0.1.
 */
export class CompanionProvider implements ModelProvider {
  readonly id = "companion" as const;

  constructor(
    private readonly gateway: DeviceGateway,
    private readonly userId: string,
    private readonly timeoutMs: number,
  ) {}

  resolveChatModel(requested: string) {
    return requested;
  }

  resolveEmbeddingModel(requested: string) {
    return requested;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const data = await this.gateway.request(this.userId, "chat", { ...buildOllamaChatRequest(messages, opts, false) }, {
      timeoutMs: opts.timeoutMs ?? this.timeoutMs,
      signal: opts.signal,
    });
    return parseOllamaChatResult(data, opts.model);
  }

  async *streamChat(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<ChatChunk> {
    const stream = this.gateway.stream(this.userId, "chat", { ...buildOllamaChatRequest(messages, opts, true) }, {
      timeoutMs: opts.timeoutMs ?? this.timeoutMs,
      signal: opts.signal,
    });
    for await (const event of stream) {
      if (event.kind === "chunk") yield parseOllamaChunk(event.data);
      else if (Object.keys(event.data).length > 0) yield parseOllamaChunk({ ...event.data, done: true });
    }
  }

  async embed(texts: string[], opts: EmbedOptions): Promise<number[][]> {
    const data = await this.gateway.request(this.userId, "embed", { model: opts.model, input: texts, truncate: true }, {
      timeoutMs: opts.timeoutMs ?? this.timeoutMs,
      signal: opts.signal,
    });
    const embeddings = data.embeddings as number[][] | undefined;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new ExternalServiceError("companion", "unexpected embedding response");
    }
    return embeddings;
  }

  async health(): Promise<ProviderHealth> {
    const devices = this.gateway.userDevices(this.userId);
    const healthy = devices.find((d) => d.health?.ollama_reachable);
    if (healthy?.health) {
      return { available: true, detail: null, version: healthy.health.ollama_version, models: healthy.health.models };
    }
    return {
      available: false,
      detail: devices.length > 0 ? "Companion is connected but Ollama is not reachable on that device" : "No local AI companion is connected",
      models: devices[0]?.health?.models ?? [],
    };
  }
}
