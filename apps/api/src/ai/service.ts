import { z } from "zod";
import { DEFAULT_AI_SETTINGS, type AISettings } from "@hub/shared";
import { config } from "../config";
import { deviceGateway } from "../devices/gateway";
import { AIUnavailableError, ExternalServiceError } from "../lib/errors";
import { logger } from "../lib/logger";
import { embeddingFormat, fitEmbedding } from "./embeddings";
import { CompanionProvider } from "./providers/companion";
import { modelAvailable } from "./providers/ollama-format";
import { OllamaHttpProvider } from "./providers/ollama";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import { getAISettings } from "./settings";
import type { ChatChunk, ChatMessage, ChatOptions, ChatResult, ModelProvider, ProviderHealth, ProviderId } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err: unknown) {
  if (err instanceof ExternalServiceError) return err.retryable;
  return err instanceof Error && err.name === "TimeoutError";
}

/** Retries transient provider failures (device reconnects, timeouts, 5xx). */
async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      attempt++;
      await sleep(700 * 2 ** attempt);
    }
  }
}

export type ChatCallOptions = Partial<Omit<ChatOptions, "model">> & { model?: string };

/**
 * Business-logic facade over a ModelProvider: applies the user's model settings,
 * context limits, retries, structured output parsing and embedding conventions.
 */
export class AIService {
  constructor(
    readonly provider: ModelProvider,
    readonly settings: AISettings,
  ) {}

  get chatModel() {
    return this.provider.resolveChatModel(this.settings.chat_model);
  }

  get embeddingModel() {
    return this.provider.resolveEmbeddingModel(this.settings.embedding_model);
  }

  private options(opts: ChatCallOptions = {}): ChatOptions {
    return {
      model: opts.model ?? this.chatModel,
      temperature: opts.temperature ?? this.settings.temperature,
      contextLength: opts.contextLength ?? this.settings.context_length,
      maxTokens: opts.maxTokens,
      think: opts.think ?? this.settings.thinking,
      format: opts.format,
      tools: opts.tools,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? config.ai.requestTimeoutMs,
    };
  }

  chat(messages: ChatMessage[], opts?: ChatCallOptions): Promise<ChatResult> {
    return withRetry(() => this.provider.chat(messages, this.options(opts)));
  }

  /** Streams a chat completion. Retries transparently only if nothing has been emitted yet. */
  async *streamChat(messages: ChatMessage[], opts?: ChatCallOptions): AsyncIterable<ChatChunk> {
    let attempt = 0;
    for (;;) {
      let emitted = false;
      try {
        for await (const chunk of this.provider.streamChat(messages, this.options(opts))) {
          emitted = true;
          yield chunk;
        }
        return;
      } catch (err) {
        if (emitted || attempt >= 1 || !isRetryable(err)) throw err;
        attempt++;
        await sleep(1000);
      }
    }
  }

  /**
   * Structured output: constrains generation with a JSON Schema (Ollama `format`),
   * validates with zod, and gives the model one repair attempt on invalid output.
   */
  async generateObject<S extends z.ZodType>(
    schema: S,
    messages: ChatMessage[],
    opts: ChatCallOptions = {},
  ): Promise<{ object: z.output<S>; model: string }> {
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as Record<string, unknown>;
    delete jsonSchema.$schema;
    const callOpts: ChatCallOptions = { temperature: 0.2, ...opts, format: jsonSchema, think: false };

    let conversation = messages;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.chat(conversation, callOpts);
      const parsed = parseJsonLoose(result.content);
      const validated = parsed.ok ? schema.safeParse(parsed.value) : null;
      if (validated?.success) return { object: validated.data, model: result.model };

      const problem = validated ? validated.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") : "not valid JSON";
      logger.debug({ problem }, "structured output repair");
      conversation = [
        ...messages,
        { role: "assistant", content: result.content.slice(0, 4000) },
        { role: "user", content: `That output was invalid (${problem}). Reply again with only JSON that matches the schema exactly.` },
      ];
    }
    throw new ExternalServiceError("ai", "the model did not return valid structured output", undefined, true);
  }

  private async embedRaw(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const model = this.embeddingModel;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16);
      const vectors = await withRetry(() => this.provider.embed(batch, { model, signal, timeoutMs: config.ai.requestTimeoutMs }));
      out.push(...vectors.map((v) => fitEmbedding(v, model)));
    }
    return out;
  }

  embedDocuments(texts: string[], signal?: AbortSignal) {
    const fmt = embeddingFormat(this.settings.embedding_model);
    return this.embedRaw(texts.map(fmt.document), signal);
  }

  async embedQuery(text: string, signal?: AbortSignal) {
    const fmt = embeddingFormat(this.settings.embedding_model);
    const [vector] = await this.embedRaw([fmt.query(text)], signal);
    return vector!;
  }
}

function parseJsonLoose(text: string): { ok: true; value: unknown } | { ok: false } {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(cleaned.slice(start, end + 1)) };
      } catch {
        /* fall through */
      }
    }
    return { ok: false };
  }
}

// ── Provider resolution ─────────────────────────────────────────────────────

const ollamaDirect = config.ai.ollamaDirectUrl ? new OllamaHttpProvider(config.ai.ollamaDirectUrl, config.ai.requestTimeoutMs) : null;
const cloud = config.ai.openaiCompatible ? new OpenAICompatibleProvider(config.ai.openaiCompatible, config.ai.requestTimeoutMs) : null;

let directHealthCache: { value: ProviderHealth; at: number } | null = null;
async function directHealth(): Promise<ProviderHealth> {
  if (!ollamaDirect) return { available: false, detail: "OLLAMA_DIRECT_URL is not configured", models: [] };
  if (directHealthCache && Date.now() - directHealthCache.at < 15_000) return directHealthCache.value;
  const value = await ollamaDirect.health();
  directHealthCache = { value, at: Date.now() };
  return value;
}

export function providerFor(id: ProviderId, userId: string): ModelProvider | null {
  switch (id) {
    case "companion":
      return new CompanionProvider(deviceGateway, userId, config.ai.requestTimeoutMs);
    case "ollama":
      return ollamaDirect;
    case "openai_compatible":
      return cloud;
  }
}

export async function providerHealth(id: ProviderId, userId: string): Promise<ProviderHealth & { configured: boolean }> {
  if (id === "ollama") return { configured: Boolean(ollamaDirect), ...(await directHealth()) };
  if (id === "openai_compatible") {
    return cloud
      ? { configured: true, available: true, detail: null, models: [] }
      : { configured: false, available: false, detail: "No cloud provider is configured on the server", models: [] };
  }
  const provider = providerFor("companion", userId)!;
  return { configured: true, ...(await provider.health()) };
}

function candidateOrder(settings: AISettings): ProviderId[] {
  if (settings.provider === "auto") return ["companion", "ollama", ...(settings.allow_cloud_fallback ? (["openai_compatible"] as const) : [])];
  return [settings.provider];
}

/**
 * Resolves the AI service for a user: their chosen provider, or in "auto" mode the
 * local companion first, then direct Ollama, then (only if allowed) the cloud.
 * Throws AIUnavailableError when nothing can serve the request.
 */
export async function resolveAI(userId: string, opts: { requireEmbeddings?: boolean } = {}): Promise<AIService> {
  const settings = await getAISettings(userId);
  let reason: string | undefined;
  for (const id of candidateOrder(settings)) {
    const provider = providerFor(id, userId);
    if (!provider) continue;
    if (id === "openai_compatible") return new AIService(provider, settings);

    const health = await providerHealth(id, userId);
    if (!health.available) {
      reason ??= health.detail ?? undefined;
      continue;
    }
    const wanted = opts.requireEmbeddings ? settings.embedding_model : settings.chat_model;
    if (!modelAvailable(health.models, wanted)) {
      reason = `The model "${wanted}" is not installed on your local AI device. Run: ollama pull ${wanted}`;
      continue;
    }
    return new AIService(provider, settings);
  }
  throw new AIUnavailableError(reason ? `Local AI is not available: ${reason}.` : undefined);
}

/**
 * AI for system-level work on public content (e.g. summarising news for the shared
 * feed). Uses direct Ollama when configured, otherwise any connected companion.
 */
export async function resolveSystemAI(opts: { requireEmbeddings?: boolean } = {}): Promise<AIService | null> {
  const health = await directHealth();
  if (ollamaDirect && health.available) return new AIService(ollamaDirect, DEFAULT_AI_SETTINGS);
  for (const userId of deviceGateway.onlineUserIds()) {
    const ai = await tryResolveAI(userId, opts);
    if (ai && ai.provider.id !== "openai_compatible") return ai;
  }
  return null;
}

/** Non-throwing variant for background work that can degrade gracefully. */
export async function tryResolveAI(userId: string, opts: { requireEmbeddings?: boolean } = {}): Promise<AIService | null> {
  try {
    return await resolveAI(userId, opts);
  } catch (err) {
    if (err instanceof AIUnavailableError) return null;
    throw err;
  }
}
