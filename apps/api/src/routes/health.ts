import { Hono } from "hono";
import { adminDb } from "../lib/supabase";
import type { AppEnv } from "../types";

const startedAt = Date.now();

export const healthRoutes = new Hono<AppEnv>()
  .get("/", (c) => c.json({ status: "ok", service: "hub-api", uptime_s: Math.round((Date.now() - startedAt) / 1000) }))
  .get("/ready", async (c) => {
    const { error } = await adminDb.from("intelligence_categories").select("id", { head: true, count: "exact" }).limit(1);
    if (error) return c.json({ status: "degraded", database: "unreachable" }, 503);
    return c.json({ status: "ready", database: "ok" });
  });
