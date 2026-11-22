import { Hono } from "hono";
import { z } from "zod";
import { BRIEFING_KINDS, briefingGenerateSchema, briefingListQuery, type Briefing } from "@hub/shared";
import { generateBriefing } from "../agents/briefing";
import { unwrap } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { idParam, parseBody, parseQuery } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const briefingRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const q = parseQuery(c, briefingListQuery);
    let query = c.get("db").from("briefings").select("*").order("period_start", { ascending: false }).order("kind").limit(q.limit);
    if (q.kind) query = query.eq("kind", q.kind);
    return c.json({ items: unwrap<Briefing[]>(await query) });
  })
  .get("/latest", async (c) => {
    const { kind } = parseQuery(c, z.object({ kind: z.enum(BRIEFING_KINDS).default("daily") }));
    const row = unwrap<Briefing | null>(
      await c.get("db").from("briefings").select("*").eq("kind", kind).order("period_start", { ascending: false }).limit(1).maybeSingle(),
    );
    return c.json({ briefing: row });
  })
  .get("/:id", async (c) => {
    return c.json(unwrap<Briefing>(await c.get("db").from("briefings").select("*").eq("id", idParam(c)).maybeSingle(), "Briefing"));
  })
  /** Builds the data sections immediately; the AI narrative is added in the background. */
  .post("/generate", rateLimit({ name: "briefing-generate", capacity: 6, windowMs: 10 * 60_000 }), async (c) => {
    const body = await parseBody(c, briefingGenerateSchema);
    const briefing = await generateBriefing(c.get("user").id, body.kind, body.date, false);
    return c.json(briefing, 201);
  })
  .delete("/:id", async (c) => {
    unwrap(await c.get("db").from("briefings").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  });
