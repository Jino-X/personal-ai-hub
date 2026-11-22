import { Hono } from "hono";
import { z } from "zod";
import { paginationQuery, queryBool, type Notification } from "@hub/shared";
import { unwrap } from "../lib/errors";
import { idParam, parseQuery } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const listQuery = paginationQuery.extend({ unread: queryBool.optional() });

export const notificationRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const q = parseQuery(c, listQuery);
    const db = c.get("db");
    let query = db
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .range(q.offset, q.offset + q.limit - 1);
    if (q.unread) query = query.is("read_at", null);
    const [items, unread] = await Promise.all([
      query,
      db.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    ]);
    return c.json({ items: unwrap(items) as Notification[], unread: unread.count ?? 0 });
  })
  .post("/read-all", async (c) => {
    unwrap(await c.get("db").from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null));
    return c.json({ ok: true });
  })
  .post("/:id/read", async (c) => {
    const id = idParam(c);
    const row = unwrap(
      await c.get("db").from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).select().single(),
      "Notification",
    );
    return c.json(row as Notification);
  })
  .delete("/:id", async (c) => {
    unwrap(await c.get("db").from("notifications").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  });

const jobsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

/** Activity log of the user's background agent jobs. */
export const jobRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const { limit } = parseQuery(c, jobsQuery);
    const rows = unwrap(
      await c
        .get("db")
        .from("agent_jobs")
        .select("id, agent, kind, status, attempts, max_attempts, run_at, started_at, finished_at, last_error, created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
    );
    return c.json({ items: rows });
  })
  .get("/:id", async (c) => {
    const row = unwrap(await c.get("db").from("agent_jobs").select("*").eq("id", idParam(c)).maybeSingle(), "Job");
    return c.json(row);
  });
