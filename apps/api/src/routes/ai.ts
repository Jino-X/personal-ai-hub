import { Hono } from "hono";
import { aiSettingsUpdateSchema, EMBEDDING_DIMENSIONS, type AIRuntimeStatus, type LocalAIDevice } from "@hub/shared";
import { config } from "../config";
import { modelAvailable } from "../ai/providers/ollama-format";
import { providerHealth, resolveAI } from "../ai/service";
import { getAISettings, invalidateAISettings, mergeAISettings } from "../ai/settings";
import type { ProviderId } from "../ai/types";
import { deviceGateway } from "../devices/gateway";
import { enqueueJob } from "../jobs/queue";
import { audit } from "../lib/audit";
import { AIUnavailableError, badRequest, errorMessage, unwrap } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { parseBody } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const PROVIDERS: ProviderId[] = ["companion", "ollama", "openai_compatible"];

export const aiRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/status", async (c) => {
    const user = c.get("user");
    const settings = await getAISettings(user.id);
    const devices = unwrap<LocalAIDevice[]>(
      await c.get("db").from("local_ai_devices").select("*").eq("status", "active").order("last_seen_at", { ascending: false, nullsFirst: false }),
    ).map((d) => ({ ...d, online: deviceGateway.isOnline(d.id), health: deviceGateway.connectionHealth(d.id) ?? d.health }));

    const healths = await Promise.all(PROVIDERS.map(async (id) => ({ id, ...(await providerHealth(id, user.id)) })));

    let provider: AIRuntimeStatus["provider"] = null;
    let reason: string | null = null;
    try {
      provider = (await resolveAI(user.id)).provider.id;
    } catch (err) {
      reason = err instanceof AIUnavailableError ? err.message : errorMessage(err);
    }
    const active = healths.find((h) => h.id === provider);
    const isCloud = provider === "openai_compatible";

    const status: AIRuntimeStatus = {
      available: provider !== null,
      provider,
      reason,
      settings,
      chat_model_available: isCloud || Boolean(active && modelAvailable(active.models, settings.chat_model)),
      embedding_model_available: isCloud || Boolean(active && modelAvailable(active.models, settings.embedding_model)),
      devices,
      providers: healths.map((h) => ({ id: h.id, configured: h.configured, available: h.available, detail: h.detail })),
      checked_at: new Date().toISOString(),
    };
    return c.json(status);
  })
  .get("/settings", async (c) => {
    return c.json({
      settings: await getAISettings(c.get("user").id),
      server: {
        ollama_direct: Boolean(config.ai.ollamaDirectUrl),
        cloud: Boolean(config.ai.openaiCompatible),
        cloud_chat_model: config.ai.openaiCompatible?.chatModel ?? null,
        embedding_dimensions: EMBEDDING_DIMENSIONS,
        request_timeout_ms: config.ai.requestTimeoutMs,
      },
    });
  })
  .patch("/settings", async (c) => {
    const user = c.get("user");
    const patch = await parseBody(c, aiSettingsUpdateSchema);
    if (patch.provider === "openai_compatible" && !config.ai.openaiCompatible) {
      throw badRequest("No cloud provider is configured on the server.");
    }
    if (patch.provider === "ollama" && !config.ai.ollamaDirectUrl) {
      throw badRequest("Direct Ollama access is not configured on the server (OLLAMA_DIRECT_URL).");
    }
    const db = c.get("db");
    const current = unwrap<{ ai_settings: Record<string, unknown> }>(await db.from("user_preferences").select("ai_settings").single(), "Preferences");
    const previous = mergeAISettings(current.ai_settings);
    const next = { ...current.ai_settings, ...patch };
    unwrap(await db.from("user_preferences").update({ ai_settings: next }).eq("user_id", user.id));
    invalidateAISettings(user.id);

    await audit({ userId: user.id, actor: "user", action: "ai.settings_updated", metadata: { changes: patch }, c });
    if (patch.embedding_model && patch.embedding_model !== previous.embedding_model) {
      await enqueueJob({ agent: "knowledge", kind: "knowledge.reindex_all", userId: user.id, dedupeKey: `reindex:${user.id}`, priority: 7 });
    }
    return c.json({ settings: mergeAISettings(next) });
  })
  .get("/models", async (c) => {
    const user = c.get("user");
    try {
      const ai = await resolveAI(user.id);
      const health = await ai.provider.health();
      return c.json({ provider: ai.provider.id, models: health.models });
    } catch (err) {
      if (err instanceof AIUnavailableError) {
        const companion = await providerHealth("companion", user.id);
        return c.json({ provider: null, models: companion.models, reason: err.message });
      }
      throw err;
    }
  })
  .post("/test", rateLimit({ name: "ai-test", capacity: 10, windowMs: 60_000 }), async (c) => {
    const user = c.get("user");
    const ai = await resolveAI(user.id);
    const started = performance.now();
    const reply = await ai.chat([{ role: "user", content: "Reply with exactly the word OK." }], { maxTokens: 16, think: false, temperature: 0 });
    const chatMs = Math.round(performance.now() - started);

    let embedding: { ok: boolean; dimensions?: number; latency_ms?: number; error?: string };
    try {
      const t = performance.now();
      const vector = await ai.embedQuery("connectivity check");
      embedding = { ok: true, dimensions: vector.length, latency_ms: Math.round(performance.now() - t) };
    } catch (err) {
      embedding = { ok: false, error: errorMessage(err) };
    }
    return c.json({
      ok: true,
      provider: ai.provider.id,
      model: reply.model,
      reply: reply.content.trim().slice(0, 100),
      latency_ms: chatMs,
      embedding,
    });
  });
