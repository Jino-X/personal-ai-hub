import { Hono } from "hono";
import { z } from "zod";
import {
  bookmarkCreateSchema,
  feedQuerySchema,
  INTELLIGENCE_FEEDS,
  itemStateSchema,
  markAllReadSchema,
  newsSourceCreateSchema,
  newsSourceUpdateSchema,
  type FeedItem,
  type IntelligenceCategory,
  type IntelligenceFeed,
  type NewsSource,
} from "@hub/shared";
import { explainItem } from "../agents/ai-news";
import { enqueueDueSources } from "../agents/research";
import { resolveAI } from "../ai/service";
import { enqueueJob } from "../jobs/queue";
import { badRequest, notFound, unwrap } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { definedOnly, idParam, parseBody, parseQuery } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

type FeedRow = FeedItem & { total_count: number };

export const intelligenceRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/feed", async (c) => {
    const q = parseQuery(c, feedQuerySchema);
    // Relevance ranking looks at a recent window by default; other sorts browse everything.
    const sinceDays = q.since_days ?? (q.sort === "relevance" && !q.q && !q.bookmarked ? 21 : undefined);
    const rows = unwrap<FeedRow[]>(
      await c.get("db").rpc("intelligence_feed", {
        p_feed: q.feed ?? null,
        p_category: q.category ?? null,
        p_technology: q.technology ?? null,
        p_search: q.q || null,
        p_unread_only: q.unread ?? false,
        p_bookmarked_only: q.bookmarked ?? false,
        p_watchlist_id: q.watchlist_id ?? null,
        p_since: sinceDays ? new Date(Date.now() - sinceDays * 86_400_000).toISOString() : null,
        p_sort: q.sort,
        p_limit: q.limit,
        p_offset: q.offset,
      }),
    );
    const total = rows[0]?.total_count ?? 0;
    return c.json({ items: rows.map(({ total_count: _t, ...item }) => item), total, limit: q.limit, offset: q.offset });
  })
  .get("/categories", async (c) => {
    return c.json({
      items: unwrap<IntelligenceCategory[]>(await c.get("db").from("intelligence_categories").select("id, slug, name, description").order("sort_order")),
    });
  })
  .get("/status", async (c) => {
    const db = c.get("db");
    const [pending, sources] = await Promise.all([
      db.from("intelligence_items").select("feed", { count: "exact", head: true }).eq("ai_status", "pending").is("duplicate_of", null),
      db.from("news_sources").select("feed, last_success_at, enabled"),
    ]);
    const lastUpdated: Partial<Record<IntelligenceFeed, string | null>> = {};
    for (const s of unwrap<{ feed: IntelligenceFeed; last_success_at: string | null; enabled: boolean }[]>(sources)) {
      if (!s.enabled || !s.last_success_at) continue;
      if (!lastUpdated[s.feed] || s.last_success_at > lastUpdated[s.feed]!) lastUpdated[s.feed] = s.last_success_at;
    }
    return c.json({ pending_ai: pending.count ?? 0, last_updated: lastUpdated });
  })
  .post("/refresh", rateLimit({ name: "intel-refresh", capacity: 4, windowMs: 10 * 60_000 }), async (c) => {
    const body = await parseBody(c, z.object({ feed: z.enum(INTELLIGENCE_FEEDS).optional() }));
    const enqueued = await enqueueDueSources({ feed: body.feed, force: true, userId: c.get("user").id });
    return c.json({ enqueued });
  })
  .post("/items/:id/state", async (c) => {
    const id = idParam(c);
    const body = await parseBody(c, itemStateSchema);
    const row: Record<string, unknown> = { user_id: c.get("user").id, item_id: id };
    if (body.read !== undefined) row.read_at = body.read ? new Date().toISOString() : null;
    if (body.hidden !== undefined) row.hidden = body.hidden;
    if (body.feedback !== undefined) row.feedback = body.feedback;
    unwrap(await c.get("db").from("intelligence_item_states").upsert(row, { onConflict: "user_id,item_id" }));
    return c.json({ ok: true });
  })
  .post("/mark-read", async (c) => {
    const body = await parseBody(c, markAllReadSchema);
    const db = c.get("db");
    let ids = body.item_ids ?? [];
    if (ids.length === 0) {
      const rows = unwrap<{ id: string }[]>(
        await db.rpc("intelligence_feed", { p_feed: body.feed ?? null, p_unread_only: true, p_sort: "newest", p_limit: 100, p_offset: 0 }),
      );
      ids = rows.map((r) => r.id);
    }
    if (ids.length === 0) return c.json({ updated: 0 });
    const now = new Date().toISOString();
    const userId = c.get("user").id;
    unwrap(await db.from("intelligence_item_states").upsert(ids.map((item_id) => ({ user_id: userId, item_id, read_at: now })), { onConflict: "user_id,item_id" }));
    return c.json({ updated: ids.length });
  })
  .post("/items/:id/bookmark", async (c) => {
    const id = idParam(c);
    const body = await parseBody(c, bookmarkCreateSchema.omit({ item_id: true }));
    unwrap(
      await c
        .get("db")
        .from("bookmarks")
        .upsert({ user_id: c.get("user").id, item_id: id, note: body.note ?? null }, { onConflict: "user_id,item_id" }),
    );
    return c.json({ ok: true }, 201);
  })
  .delete("/items/:id/bookmark", async (c) => {
    unwrap(await c.get("db").from("bookmarks").delete().eq("item_id", idParam(c)));
    return c.body(null, 204);
  })
  .post("/items/:id/explain", rateLimit({ name: "ai-explain", capacity: 12, windowMs: 60_000 }), async (c) => {
    const id = idParam(c);
    const item = unwrap<{ feed: IntelligenceFeed; title: string; source_name: string; source_excerpt: string | null; url: string } | null>(
      await c.get("db").from("intelligence_items").select("feed, title, source_name, source_excerpt, url").eq("id", id).maybeSingle(),
    );
    if (!item) throw notFound("Item");
    const ai = await resolveAI(c.get("user").id);
    return c.json(await explainItem(ai, item));
  })
  // ── Sources ──
  .get("/sources", async (c) => {
    const db = c.get("db");
    const [sources, prefs] = await Promise.all([
      db.from("news_sources").select("*").order("feed").order("name"),
      db.from("user_preferences").select("muted_source_ids").single(),
    ]);
    const muted = new Set((prefs.data?.muted_source_ids as string[] | undefined) ?? []);
    return c.json({ items: unwrap<NewsSource[]>(sources).map((s) => ({ ...s, muted: muted.has(s.id), built_in: s.user_id === null })) });
  })
  .post("/sources", rateLimit({ name: "source-create", capacity: 20, windowMs: 60 * 60_000 }), async (c) => {
    const body = await parseBody(c, newsSourceCreateSchema);
    const configJson: Record<string, unknown> = {};
    if (body.kind === "github_releases") configJson.repo = body.repo;
    if (body.kind === "arxiv") Object.assign(configJson, { query: body.query, max_results: 30 });
    const row = unwrap<NewsSource>(
      await c
        .get("db")
        .from("news_sources")
        .insert({
          user_id: c.get("user").id,
          kind: body.kind,
          name: body.name,
          url: body.kind === "rss" ? body.url : body.kind === "github_releases" ? `https://github.com/${body.repo}` : "https://arxiv.org",
          feed: body.feed,
          config: configJson,
          fetch_interval_minutes: body.fetch_interval_minutes ?? (body.kind === "rss" ? 60 : 360),
        })
        .select("*")
        .single(),
    );
    await enqueueJob({ agent: "research", kind: "research.ingest_source", payload: { source_id: row.id }, userId: row.user_id, dedupeKey: `ingest:${row.id}` });
    return c.json(row, 201);
  })
  .patch("/sources/:id", async (c) => {
    const body = definedOnly(await parseBody(c, newsSourceUpdateSchema));
    const row = unwrap<NewsSource | null>(
      await c.get("db").from("news_sources").update(body).eq("id", idParam(c)).eq("user_id", c.get("user").id).select("*").maybeSingle(),
    );
    if (!row) throw badRequest("Only your own sources can be edited. Built-in sources can be muted instead.");
    return c.json(row);
  })
  .post("/sources/:id/mute", async (c) => {
    const id = idParam(c);
    const { muted } = await parseBody(c, z.object({ muted: z.boolean() }));
    const db = c.get("db");
    const prefs = unwrap<{ muted_source_ids: string[] }>(await db.from("user_preferences").select("muted_source_ids").single(), "Preferences");
    const set = new Set(prefs.muted_source_ids ?? []);
    if (muted) set.add(id);
    else set.delete(id);
    unwrap(await db.from("user_preferences").update({ muted_source_ids: [...set] }).eq("user_id", c.get("user").id));
    return c.json({ ok: true, muted });
  })
  .post("/sources/:id/refresh", rateLimit({ name: "source-refresh", capacity: 10, windowMs: 10 * 60_000 }), async (c) => {
    const id = idParam(c);
    const source = unwrap<{ id: string; user_id: string | null } | null>(await c.get("db").from("news_sources").select("id, user_id").eq("id", id).maybeSingle());
    if (!source) throw notFound("Source");
    await enqueueJob({ agent: "research", kind: "research.ingest_source", payload: { source_id: id }, userId: source.user_id, dedupeKey: `ingest:${id}` });
    return c.json({ ok: true });
  })
  .delete("/sources/:id", async (c) => {
    unwrap(await c.get("db").from("news_sources").delete().eq("id", idParam(c)).eq("user_id", c.get("user").id));
    return c.body(null, 204);
  });
