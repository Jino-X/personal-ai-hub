import { Hono } from "hono";
import { z } from "zod";
import {
  GOAL_STATUSES,
  goalCreateSchema,
  goalUpdateSchema,
  learningResourceCreateSchema,
  learningResourceUpdateSchema,
  milestoneCreateSchema,
  milestoneUpdateSchema,
  skillCreateSchema,
  skillUpdateSchema,
  type Goal,
  type GoalMilestone,
  type GoalWithDetails,
  type LearningResource,
  type Skill,
} from "@hub/shared";
import { analyzeGoals } from "../agents/productivity/planner";
import { resolveAI } from "../ai/service";
import { unwrap } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { userTimezone } from "../lib/user";
import { definedOnly, idParam, parseBody, parseQuery } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const goalListQuery = z.object({ status: z.enum([...GOAL_STATUSES, "all", "current"]).default("current") });

export const goalRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const { status } = parseQuery(c, goalListQuery);
    const db = c.get("db");
    let goalsQuery = db.from("goals").select("*").order("status").order("target_date", { ascending: true, nullsFirst: false });
    if (status === "current") goalsQuery = goalsQuery.in("status", ["active", "paused"]);
    else if (status !== "all") goalsQuery = goalsQuery.eq("status", status);

    const [goals, milestones, resources, tasks] = await Promise.all([
      goalsQuery,
      db.from("goal_milestones").select("*").order("sort_order").order("created_at"),
      db.from("learning_resources").select("*").not("goal_id", "is", null).order("created_at"),
      db.from("tasks").select("goal_id").in("status", ["todo", "in_progress"]).not("goal_id", "is", null).limit(10_000),
    ]);
    const byGoal = <T extends { goal_id: string | null }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const r of rows) if (r.goal_id) map.set(r.goal_id, [...(map.get(r.goal_id) ?? []), r]);
      return map;
    };
    const ms = byGoal(unwrap<GoalMilestone[]>(milestones));
    const rs = byGoal(unwrap<LearningResource[]>(resources));
    const ts = byGoal(unwrap<{ goal_id: string }[]>(tasks));
    const items: GoalWithDetails[] = unwrap<Goal[]>(goals).map((g) => ({
      ...g,
      milestones: ms.get(g.id) ?? [],
      resources: rs.get(g.id) ?? [],
      open_task_count: ts.get(g.id)?.length ?? 0,
    }));
    return c.json({ items });
  })
  .post("/analysis", rateLimit({ name: "ai-goal-analysis", capacity: 6, windowMs: 60_000 }), async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const [ai, tz] = await Promise.all([resolveAI(user.id), userTimezone(db, user.id)]);
    return c.json(await analyzeGoals(ai, db, tz));
  })
  .post("/", async (c) => {
    const body = await parseBody(c, goalCreateSchema);
    const row = unwrap<Goal>(await c.get("db").from("goals").insert({ ...definedOnly(body), user_id: c.get("user").id }).select("*").single());
    return c.json(row, 201);
  })
  .patch("/:id", async (c) => {
    const body = definedOnly(await parseBody(c, goalUpdateSchema));
    const patch: Record<string, unknown> = { ...body };
    if (body.status === "completed") patch.completed_at = new Date().toISOString();
    else if (body.status) patch.completed_at = null;
    return c.json(unwrap<Goal>(await c.get("db").from("goals").update(patch).eq("id", idParam(c)).select("*").single(), "Goal"));
  })
  .delete("/:id", async (c) => {
    unwrap(await c.get("db").from("goals").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  })
  // ── Milestones & lessons ──
  .post("/:id/milestones", async (c) => {
    const goalId = idParam(c);
    const body = await parseBody(c, milestoneCreateSchema);
    const row = unwrap<GoalMilestone>(
      await c.get("db").from("goal_milestones").insert({ ...definedOnly(body), goal_id: goalId, user_id: c.get("user").id }).select("*").single(),
    );
    return c.json(row, 201);
  })
  .patch("/milestones/:id", async (c) => {
    const { completed, ...rest } = await parseBody(c, milestoneUpdateSchema);
    const patch: Record<string, unknown> = definedOnly(rest);
    if (completed !== undefined) patch.completed_at = completed ? new Date().toISOString() : null;
    return c.json(unwrap<GoalMilestone>(await c.get("db").from("goal_milestones").update(patch).eq("id", idParam(c)).select("*").single(), "Milestone"));
  })
  .delete("/milestones/:id", async (c) => {
    unwrap(await c.get("db").from("goal_milestones").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  });

export const learningRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  // ── Learning resources ──
  .get("/resources", async (c) => {
    return c.json({ items: unwrap<LearningResource[]>(await c.get("db").from("learning_resources").select("*").order("status").order("created_at", { ascending: false })) });
  })
  .post("/resources", async (c) => {
    const body = await parseBody(c, learningResourceCreateSchema);
    const patch: Record<string, unknown> = { ...definedOnly(body), user_id: c.get("user").id };
    if (body.status === "done") patch.completed_at = new Date().toISOString();
    return c.json(unwrap<LearningResource>(await c.get("db").from("learning_resources").insert(patch).select("*").single()), 201);
  })
  .patch("/resources/:id", async (c) => {
    const body = definedOnly(await parseBody(c, learningResourceUpdateSchema));
    const patch: Record<string, unknown> = { ...body };
    if (body.status) patch.completed_at = body.status === "done" ? new Date().toISOString() : null;
    return c.json(unwrap<LearningResource>(await c.get("db").from("learning_resources").update(patch).eq("id", idParam(c)).select("*").single(), "Resource"));
  })
  .delete("/resources/:id", async (c) => {
    unwrap(await c.get("db").from("learning_resources").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  })
  // ── Skills ──
  .get("/skills", async (c) => {
    return c.json({ items: unwrap<Skill[]>(await c.get("db").from("skills").select("*").order("category").order("name")) });
  })
  .post("/skills", async (c) => {
    const body = await parseBody(c, skillCreateSchema);
    return c.json(unwrap<Skill>(await c.get("db").from("skills").insert({ ...definedOnly(body), user_id: c.get("user").id }).select("*").single()), 201);
  })
  .patch("/skills/:id", async (c) => {
    const { practiced, ...rest } = await parseBody(c, skillUpdateSchema);
    const patch: Record<string, unknown> = definedOnly(rest);
    if (practiced) patch.last_practiced_at = new Date().toISOString();
    return c.json(unwrap<Skill>(await c.get("db").from("skills").update(patch).eq("id", idParam(c)).select("*").single(), "Skill"));
  })
  .delete("/skills/:id", async (c) => {
    unwrap(await c.get("db").from("skills").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  });
