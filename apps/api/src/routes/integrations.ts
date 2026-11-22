import { Hono } from "hono";
import type { ConnectedIntegration, IntegrationStatus } from "@hub/shared";
import { completeGoogleConnection, googleAuthUrl, revokeGoogle, verifyGoogleState } from "../agents/productivity/google-calendar";
import { config } from "../config";
import { enqueueJob } from "../jobs/queue";
import { audit } from "../lib/audit";
import { badRequest, notFound, unwrap } from "../lib/errors";
import { logger } from "../lib/logger";
import { rateLimit } from "../lib/rate-limit";
import { adminDb } from "../lib/supabase";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const integrationRoutes = new Hono<AppEnv>()
  /** OAuth redirect target — a browser navigation from Google, authenticated by the signed `state`. */
  .get("/google/callback", async (c) => {
    const back = (status: string) => c.redirect(`${config.webAppUrl}/settings/integrations?google=${status}`);
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (c.req.query("error") || !code || !state) return back("cancelled");
    try {
      const userId = await verifyGoogleState(state);
      const integrationId = await completeGoogleConnection(userId, code);
      await audit({ userId, actor: "user", action: "integration.connected", targetType: "integration", targetId: integrationId, metadata: { provider: "google_calendar" }, c });
      return back("connected");
    } catch (err) {
      logger.warn({ err }, "google oauth callback failed");
      return back("error");
    }
  })
  .get("/", requireAuth, async (c) => {
    const db = c.get("db");
    const [integrations, sources] = await Promise.all([
      db.from("connected_integrations").select("*"),
      db.from("news_sources").select("id", { count: "exact", head: true }).not("user_id", "is", null),
    ]);
    const google = unwrap<ConnectedIntegration[]>(integrations).find((i) => i.provider === "google_calendar") ?? null;
    const items: IntegrationStatus[] = [
      {
        provider: "google_calendar",
        name: "Google Calendar",
        description: "Read-only sync of your primary calendar into Personal AI Hub.",
        configured: Boolean(config.google),
        connected: Boolean(google && google.status !== "disconnected"),
        scope: "user",
        detail: config.google ? (google?.account_label ?? null) : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API to enable.",
        integration: google,
      },
      {
        provider: "github",
        name: "GitHub",
        description: "Trending repositories, release tracking and repository imports.",
        configured: true,
        connected: Boolean(config.sources.githubToken),
        scope: "server",
        detail: config.sources.githubToken ? "Authenticated API access (higher rate limits, README enrichment)." : "Public API (60 requests/hour). Set GITHUB_TOKEN for more.",
      },
      {
        provider: "huggingface",
        name: "Hugging Face",
        description: "Trending models and Daily Papers.",
        configured: true,
        connected: Boolean(config.sources.hfToken),
        scope: "server",
        detail: config.sources.hfToken ? "Authenticated API access." : "Public API. Set HF_TOKEN for higher rate limits.",
      },
      {
        provider: "product_hunt",
        name: "Product Hunt",
        description: "New AI products.",
        configured: Boolean(config.sources.productHuntToken),
        connected: Boolean(config.sources.productHuntToken),
        scope: "server",
        detail: config.sources.productHuntToken ? null : "Set PRODUCT_HUNT_TOKEN on the API to enable.",
      },
      {
        provider: "rss",
        name: "RSS & custom sources",
        description: "Your own feeds, release trackers and arXiv queries.",
        configured: true,
        connected: (sources.count ?? 0) > 0,
        scope: "user",
        detail: `${sources.count ?? 0} custom source(s)`,
      },
      {
        provider: "ollama",
        name: "Ollama (direct)",
        description: "Same-host Ollama access for the API, in addition to the companion.",
        configured: Boolean(config.ai.ollamaDirectUrl),
        connected: Boolean(config.ai.ollamaDirectUrl),
        scope: "server",
        detail: config.ai.ollamaDirectUrl ? null : "Not configured — inference goes through your local AI companion.",
      },
    ];
    return c.json({ items });
  })
  .post("/google/connect", requireAuth, rateLimit({ name: "google-connect", capacity: 10, windowMs: 60 * 60_000 }), async (c) => {
    if (!config.google) throw badRequest("Google Calendar is not configured on the server.");
    return c.json({ url: await googleAuthUrl(c.get("user").id) });
  })
  .post("/google/sync", requireAuth, rateLimit({ name: "google-sync", capacity: 10, windowMs: 10 * 60_000 }), async (c) => {
    const integration = unwrap<{ id: string } | null>(await c.get("db").from("connected_integrations").select("id").eq("provider", "google_calendar").maybeSingle());
    if (!integration) throw notFound("Google Calendar integration");
    await enqueueJob({ agent: "productivity", kind: "calendar.sync_google", userId: c.get("user").id, payload: { integration_id: integration.id }, dedupeKey: `gcal:${integration.id}`, priority: 2 });
    return c.json({ ok: true });
  })
  .delete("/google", requireAuth, async (c) => {
    const user = c.get("user");
    const integration = unwrap<{ id: string } | null>(await c.get("db").from("connected_integrations").select("id").eq("provider", "google_calendar").maybeSingle());
    if (!integration) throw notFound("Google Calendar integration");
    await revokeGoogle(integration.id);
    // Deleting the integration cascades to its credentials and synced events.
    await adminDb.from("connected_integrations").delete().eq("id", integration.id).eq("user_id", user.id);
    await audit({ userId: user.id, actor: "user", action: "integration.disconnected", targetType: "integration", targetId: integration.id, metadata: { provider: "google_calendar" }, c });
    return c.body(null, 204);
  });
