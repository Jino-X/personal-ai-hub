import { Hono } from "hono";
import { z } from "zod";
import {
  idSchema,
  queryBool,
  watchlistCreateSchema,
  watchlistItemCreateSchema,
  watchlistItemUpdateSchema,
  watchlistUpdateSchema,
  type Watchlist,
  type WatchlistItem,
  type WatchlistMatch,
  type WatchlistWithItems,
} from "@hub/shared";
import { enqueueJob } from "../jobs/queue";
import { unwrap } from "../lib/errors";
import { definedOnly, idParam, parseBody, parseQuery } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const matchesQuery = z.object({
  watchlist_id: idSchema.optional(),
  unseen: queryBool.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const watchlistRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = c.get("db");
    const [lists, items, matches] = await Promise.all([
      db.from("watchlists").select("*").order("created_at"),
      db.from("watchlist_items").select("*").order("kind").order("value"),
      db.from("watchlist_matches").select("watchlist_item_id").is("seen_at", null).limit(10_000),
    ]);
    const counts = new Map<string, number>();
    for (const m of unwrap<{ watchlist_item_id: string }[]>(matches)) counts.set(m.watchlist_item_id, (counts.get(m.watchlist_item_id) ?? 0) + 1);
    const byList = new Map<string, (WatchlistItem & { match_count: number })[]>();
    for (const i of unwrap<WatchlistItem[]>(items)) {
      byList.set(i.watchlist_id, [...(byList.get(i.watchlist_id) ?? []), { ...i, match_count: counts.get(i.id) ?? 0 }]);
    }
    const result: WatchlistWithItems[] = unwrap<Watchlist[]>(lists).map((l) => ({ ...l, items: byList.get(l.id) ?? [] }));
    return c.json({ items: result });
  })
  .post("/", async (c) => {
    const body = await parseBody(c, watchlistCreateSchema);
    const row = unwrap<Watchlist>(await c.get("db").from("watchlists").insert({ ...definedOnly(body), user_id: c.get("user").id }).select("*").single());
    return c.json({ ...row, items: [] }, 201);
  })
  .patch("/:id", async (c) => {
    const body = definedOnly(await parseBody(c, watchlistUpdateSchema));
    return c.json(unwrap<Watchlist>(await c.get("db").from("watchlists").update(body).eq("id", idParam(c)).select("*").single(), "Watchlist"));
  })
  .delete("/:id", async (c) => {
    unwrap(await c.get("db").from("watchlists").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  })
  .post("/:id/items", async (c) => {
    const watchlistId = idParam(c);
    const body = await parseBody(c, watchlistItemCreateSchema);
    const row = unwrap<WatchlistItem>(
      await c
        .get("db")
        .from("watchlist_items")
        .insert({ watchlist_id: watchlistId, user_id: c.get("user").id, kind: body.kind, value: body.value, match_terms: body.match_terms ?? [] })
        .select("*")
        .single(),
    );
    await enqueueJob({ agent: "watchlist", kind: "watchlist.backfill_item", payload: { watchlist_item_id: row.id }, userId: row.user_id, priority: 4 });
    if (row.kind === "repository") {
      await enqueueJob({ agent: "developer", kind: "developer.check_watched_repos", dedupeKey: "developer.check_watched_repos", priority: 4 });
    }
    return c.json({ ...row, match_count: 0 }, 201);
  })
  .patch("/items/:id", async (c) => {
    const body = await parseBody(c, watchlistItemUpdateSchema);
    const row = unwrap<WatchlistItem>(await c.get("db").from("watchlist_items").update(body).eq("id", idParam(c)).select("*").single(), "Watch item");
    await enqueueJob({ agent: "watchlist", kind: "watchlist.backfill_item", payload: { watchlist_item_id: row.id }, userId: row.user_id, priority: 4 });
    return c.json(row);
  })
  .delete("/items/:id", async (c) => {
    unwrap(await c.get("db").from("watchlist_items").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  })
  .get("/matches", async (c) => {
    const q = parseQuery(c, matchesQuery);
    let query = c
      .get("db")
      .from("watchlist_matches")
      .select(
        "*, item:intelligence_items(id, title, url, source_name, published_at, feed, ai_summary), watchlist_item:watchlist_items!inner(id, kind, value, watchlist_id)",
      )
      .order("created_at", { ascending: false })
      .limit(q.limit);
    if (q.watchlist_id) query = query.eq("watchlist_item.watchlist_id", q.watchlist_id);
    if (q.unseen) query = query.is("seen_at", null);
    return c.json({ items: unwrap<WatchlistMatch[]>(await query) });
  })
  .post("/matches/seen", async (c) => {
    const body = await parseBody(c, z.object({ ids: z.array(idSchema).max(500).optional(), watchlist_id: idSchema.optional() }));
    const db = c.get("db");
    let ids = body.ids ?? [];
    if (ids.length === 0) {
      let q = db.from("watchlist_matches").select("id, watchlist_item:watchlist_items!inner(watchlist_id)").is("seen_at", null).limit(1000);
      if (body.watchlist_id) q = q.eq("watchlist_item.watchlist_id", body.watchlist_id);
      ids = unwrap<{ id: string }[]>(await q).map((m) => m.id);
    }
    if (ids.length) unwrap(await db.from("watchlist_matches").update({ seen_at: new Date().toISOString() }).in("id", ids));
    return c.json({ updated: ids.length });
  });
