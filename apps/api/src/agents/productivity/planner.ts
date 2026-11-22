import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, Goal, GoalMilestone, Task } from "@hub/shared";
import { dataBlock, GROUNDING_RULES, todayLine } from "../../ai/prompts";
import type { AIService } from "../../ai/service";
import { unwrap } from "../../lib/errors";
import { dayBounds } from "../../lib/time";

const planSchema = z.object({
  summary: z.string().describe("Two or three sentences on how to approach today."),
  focus: z
    .array(z.object({ task_id: z.string(), reason: z.string().describe("Why this task matters today, max 20 words") }))
    .max(7)
    .describe("Tasks to do today, in recommended order."),
  defer: z.array(z.object({ task_id: z.string(), reason: z.string() })).max(10).describe("Tasks that can safely wait."),
  tips: z.array(z.string()).max(3),
});

export interface DayPlan {
  summary: string;
  focus: { task_id: string; title: string; reason: string }[];
  defer: { task_id: string; title: string; reason: string }[];
  tips: string[];
  model: string;
  generated_at: string;
}

const slimTask = (t: Task) => ({
  id: t.id,
  title: t.title,
  priority: t.priority,
  status: t.status,
  due_at: t.due_at,
  tags: t.tags,
  goal_id: t.goal_id,
});

/** Personal Productivity Agent: suggests a plan for today from real tasks, events and goals. */
export async function planDay(ai: AIService, db: SupabaseClient, timezone: string): Promise<DayPlan> {
  const { start, end } = dayBounds(timezone);
  const [tasks, events, goals] = await Promise.all([
    db
      .from("tasks")
      .select("*")
      .in("status", ["todo", "in_progress"])
      .order("priority_rank", { ascending: false })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(40),
    db.from("calendar_events").select("title, starts_at, ends_at, all_day").gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString()).order("starts_at"),
    db.from("goals").select("id, title, type, target_date, progress").eq("status", "active").limit(10),
  ]);
  const taskRows = unwrap<Task[]>(tasks);
  if (taskRows.length === 0) {
    return { summary: "You have no open tasks. Enjoy the free time or add something you want to make progress on.", focus: [], defer: [], tips: [], model: "", generated_at: new Date().toISOString() };
  }

  const { object, model } = await ai.generateObject(planSchema, [
    {
      role: "system",
      content: `You are the Personal Productivity Agent. Build a realistic plan for today from the user's open tasks, calendar and goals.
Prefer overdue and urgent work, respect calendar commitments, and keep the focus list achievable (3-7 tasks).
Only reference task ids that appear in the data.
${GROUNDING_RULES}`,
    },
    {
      role: "user",
      content: [
        todayLine(timezone),
        dataBlock("open_tasks", taskRows.map(slimTask)),
        dataBlock("today_events", unwrap<Pick<CalendarEvent, "title" | "starts_at" | "ends_at" | "all_day">[]>(events)),
        dataBlock("active_goals", unwrap<Pick<Goal, "id" | "title" | "type" | "target_date" | "progress">[]>(goals)),
      ].join("\n\n"),
    },
  ]);

  const byId = new Map(taskRows.map((t) => [t.id, t]));
  const resolve = (items: { task_id: string; reason: string }[]) =>
    items.filter((i) => byId.has(i.task_id)).map((i) => ({ task_id: i.task_id, title: byId.get(i.task_id)!.title, reason: i.reason }));

  return {
    summary: object.summary,
    focus: resolve(object.focus),
    defer: resolve(object.defer),
    tips: object.tips,
    model,
    generated_at: new Date().toISOString(),
  };
}

const analysisSchema = z.object({
  summary: z.string().describe("Three to four sentences summarising progress this week."),
  wins: z.array(z.string()).max(5),
  risks: z.array(z.string()).max(5).describe("Goals or milestones at risk, with the reason."),
  next_steps: z.array(z.string()).max(5).describe("Concrete next actions for the coming week."),
});

export type GoalAnalysis = z.infer<typeof analysisSchema> & { model: string; generated_at: string };

/** Weekly progress analysis across goals, milestones, learning and completed work. */
export async function analyzeGoals(ai: AIService, db: SupabaseClient, timezone: string): Promise<GoalAnalysis> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [goals, milestones, completed, resources, skills] = await Promise.all([
    db.from("goals").select("id, title, type, status, target_date, progress").in("status", ["active", "paused"]).limit(20),
    db.from("goal_milestones").select("goal_id, title, kind, target_value, current_value, unit, due_date, completed_at").limit(200),
    db.from("tasks").select("title, goal_id, completed_at").eq("status", "done").gte("completed_at", since).limit(100),
    db.from("learning_resources").select("title, goal_id, status, completed_at").limit(100),
    db.from("skills").select("name, level, target_level, last_practiced_at").limit(50),
  ]);

  const { object, model } = await ai.generateObject(analysisSchema, [
    {
      role: "system",
      content: `You are the Goals and Learning coach inside Personal AI Hub. Analyse the user's progress over the last 7 days.
Be specific (name goals and milestones), encouraging but honest.
${GROUNDING_RULES}`,
    },
    {
      role: "user",
      content: [
        todayLine(timezone),
        dataBlock("goals", unwrap<Goal[]>(goals)),
        dataBlock("milestones", unwrap<GoalMilestone[]>(milestones)),
        dataBlock("tasks_completed_last_7_days", unwrap(completed)),
        dataBlock("learning_resources", unwrap(resources)),
        dataBlock("skills", unwrap(skills)),
      ].join("\n\n"),
    },
  ]);
  return { ...object, model, generated_at: new Date().toISOString() };
}
