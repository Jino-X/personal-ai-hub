import { Hono } from "hono";
import { calendarEventCreateSchema, calendarEventUpdateSchema, calendarRangeQuery, type CalendarEvent } from "@hub/shared";
import { badRequest, notFound, unwrap } from "../lib/errors";
import { definedOnly, idParam, parseBody, parseQuery } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const MAX_RANGE_MS = 120 * 86_400_000;

export const calendarRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/events", async (c) => {
    const { from, to } = parseQuery(c, calendarRangeQuery);
    if (new Date(to).getTime() - new Date(from).getTime() > MAX_RANGE_MS) throw badRequest("Date range too large (max 120 days)");
    // Events that overlap the range: start before `to` and (end after `from`, or start after `from`).
    const rows = unwrap<CalendarEvent[]>(
      await c
        .get("db")
        .from("calendar_events")
        .select("*")
        .lt("starts_at", to)
        .or(`ends_at.gte.${from},and(ends_at.is.null,starts_at.gte.${from})`)
        .order("starts_at")
        .limit(1000),
    );
    return c.json({ items: rows });
  })
  .post("/events", async (c) => {
    const body = await parseBody(c, calendarEventCreateSchema);
    const row = unwrap<CalendarEvent>(
      await c.get("db").from("calendar_events").insert({ ...definedOnly(body), user_id: c.get("user").id, source: "local" }).select("*").single(),
    );
    return c.json(row, 201);
  })
  .patch("/events/:id", async (c) => {
    const id = idParam(c);
    const body = definedOnly(await parseBody(c, calendarEventUpdateSchema));
    const db = c.get("db");
    const existing = unwrap<CalendarEvent | null>(await db.from("calendar_events").select("source, starts_at, ends_at").eq("id", id).maybeSingle());
    if (!existing) throw notFound("Event");
    if (existing.source !== "local") throw badRequest("Synced events are read-only here — edit them in Google Calendar.");
    const starts = body.starts_at ?? existing.starts_at;
    const ends = body.ends_at === undefined ? existing.ends_at : body.ends_at;
    if (ends && new Date(ends) < new Date(starts)) throw badRequest("End time must be after the start time");
    return c.json(unwrap<CalendarEvent>(await db.from("calendar_events").update(body).eq("id", id).select("*").single(), "Event"));
  })
  .delete("/events/:id", async (c) => {
    const id = idParam(c);
    const db = c.get("db");
    const existing = unwrap<{ source: string } | null>(await db.from("calendar_events").select("source").eq("id", id).maybeSingle());
    if (!existing) throw notFound("Event");
    if (existing.source !== "local") throw badRequest("Synced events are read-only here — delete them in Google Calendar.");
    unwrap(await db.from("calendar_events").delete().eq("id", id));
    return c.body(null, 204);
  });
