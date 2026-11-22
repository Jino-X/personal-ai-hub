import { Hono } from "hono";
import {
  projectCreateSchema,
  projectUpdateSchema,
  statsQuery,
  taskCreateSchema,
  taskListQuery,
  taskUpdateSchema,
  type Project,
  type Task,
} from "@hub/shared";
import { createNextOccurrence } from "../agents/productivity/recurrence";
import { planDay } from "../agents/productivity/planner";
import { productivityStats } from "../agents/productivity/stats";
import { resolveAI } from "../ai/service";
import { unwrap } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { dayBounds } from "../lib/time";
import { userTimezone } from "../lib/user";
import { definedOnly, escapeLike, idParam, parseBody, parseQuery } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const OPEN = ["todo", "in_progress"];

export const taskRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const q = parseQuery(c, taskListQuery);
    const db = c.get("db");
    let query = db.from("tasks").select("*", { count: "exact" });

    if (q.status === "open") query = query.in("status", OPEN);
    else if (q.status !== "all") query = query.eq("status", q.status);
    if (q.priority) query = query.eq("priority", q.priority);
    if (q.project_id === "none") query = query.is("project_id", null);
    else if (q.project_id) query = query.eq("project_id", q.project_id);
    if (q.goal_id) query = query.eq("goal_id", q.goal_id);
    if (q.tag) query = query.contains("tags", [q.tag.toLowerCase()]);
    if (q.category) query = query.eq("category", q.category);
    if (q.q) query = query.ilike("title", `%${escapeLike(q.q)}%`);

    if (q.due) {
      const tz = await userTimezone(db, c.get("user").id);
      const { start, end } = dayBounds(tz);
      const now = new Date().toISOString();
      if (q.due === "today") query = query.gte("due_at", start.toISOString()).lt("due_at", end.toISOString());
      else if (q.due === "overdue") query = query.lt("due_at", now).in("status", OPEN);
      else if (q.due === "week") query = query.gte("due_at", start.toISOString()).lt("due_at", new Date(start.getTime() + 7 * 86_400_000).toISOString());
      else if (q.due === "upcoming") query = query.gte("due_at", end.toISOString());
      else if (q.due === "none") query = query.is("due_at", null);
    }

    switch (q.sort) {
      case "priority":
        query = query.order("priority_rank", { ascending: false }).order("due_at", { ascending: true, nullsFirst: false });
        break;
      case "created":
        query = query.order("created_at", { ascending: false });
        break;
      case "manual":
        query = query.order("sort_order").order("created_at");
        break;
      default:
        query = q.status === "done"
          ? query.order("completed_at", { ascending: false })
          : query.order("due_at", { ascending: true, nullsFirst: false }).order("priority_rank", { ascending: false });
    }

    const { data, count, error } = await query.range(q.offset, q.offset + q.limit - 1);
    return c.json({ items: unwrap<Task[]>({ data, error }), total: count ?? 0, limit: q.limit, offset: q.offset });
  })
  .get("/stats", async (c) => {
    const { range } = parseQuery(c, statsQuery);
    const db = c.get("db");
    const tz = await userTimezone(db, c.get("user").id);
    return c.json(await productivityStats(db, tz, range));
  })
  .post("/plan", rateLimit({ name: "ai-plan", capacity: 10, windowMs: 60_000 }), async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const [ai, tz] = await Promise.all([resolveAI(user.id), userTimezone(db, user.id)]);
    return c.json(await planDay(ai, db, tz));
  })
  .get("/:id", async (c) => {
    return c.json(unwrap<Task>(await c.get("db").from("tasks").select("*").eq("id", idParam(c)).maybeSingle(), "Task"));
  })
  .post("/", async (c) => {
    const body = await parseBody(c, taskCreateSchema);
    const row = unwrap<Task>(
      await c
        .get("db")
        .from("tasks")
        .insert({ ...definedOnly(body), user_id: c.get("user").id, completed_at: body.status === "done" ? new Date().toISOString() : null })
        .select("*")
        .single(),
    );
    return c.json(row, 201);
  })
  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = definedOnly(await parseBody(c, taskUpdateSchema));
    const db = c.get("db");
    const current = unwrap<Task>(await db.from("tasks").select("*").eq("id", id).maybeSingle(), "Task");

    const patch: Record<string, unknown> = { ...body };
    const completing = body.status === "done" && current.status !== "done";
    if (completing) patch.completed_at = new Date().toISOString();
    if (body.status && body.status !== "done") patch.completed_at = null;
    if ("remind_at" in body && body.remind_at !== current.remind_at) patch.reminder_sent_at = null;

    const updated = unwrap<Task>(await db.from("tasks").update(patch).eq("id", id).select("*").single(), "Task");

    let next: Task | null = null;
    if (completing && updated.recurrence) {
      next = await createNextOccurrence(db, updated, await userTimezone(db, c.get("user").id));
    }
    return c.json({ task: updated, next_occurrence: next });
  })
  .delete("/:id", async (c) => {
    unwrap(await c.get("db").from("tasks").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  });

export const projectRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = c.get("db");
    const [projects, openTasks] = await Promise.all([
      db.from("projects").select("*").neq("status", "archived").order("created_at"),
      db.from("tasks").select("project_id").in("status", OPEN).not("project_id", "is", null).limit(10_000),
    ]);
    const counts = new Map<string, number>();
    for (const t of unwrap<{ project_id: string }[]>(openTasks)) counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1);
    return c.json({ items: unwrap<Project[]>(projects).map((p) => ({ ...p, open_task_count: counts.get(p.id) ?? 0 })) });
  })
  .post("/", async (c) => {
    const body = await parseBody(c, projectCreateSchema);
    const row = unwrap<Project>(await c.get("db").from("projects").insert({ ...definedOnly(body), user_id: c.get("user").id }).select("*").single());
    return c.json({ ...row, open_task_count: 0 }, 201);
  })
  .patch("/:id", async (c) => {
    const body = definedOnly(await parseBody(c, projectUpdateSchema));
    return c.json(unwrap<Project>(await c.get("db").from("projects").update(body).eq("id", idParam(c)).select("*").single(), "Project"));
  })
  .delete("/:id", async (c) => {
    unwrap(await c.get("db").from("projects").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  });
