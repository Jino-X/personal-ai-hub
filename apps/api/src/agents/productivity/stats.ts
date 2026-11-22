import { addDays, format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TASK_PRIORITIES, type Goal, type ProductivityStats, type TaskPriority } from "@hub/shared";
import { unwrap } from "../../lib/errors";
import { dayBounds, localDate, weekBounds } from "../../lib/time";

/**
 * Productivity report data for the last week or month, in the user's time zone.
 * Pass `userId` when `db` is the service-role client (background jobs) so every query is scoped.
 */
export async function productivityStats(db: SupabaseClient, timezone: string, range: "week" | "month", userId?: string): Promise<ProductivityStats> {
  const today = dayBounds(timezone);
  const days = range === "week" ? 7 : 30;
  const start = range === "week" ? weekBounds(timezone).start : addDays(today.start, -(days - 1));
  const startIso = start.toISOString();
  const nowIso = new Date().toISOString();

  const scope: Record<string, string> = userId ? { user_id: userId } : {};
  const [completed, created, overdue, open, goals] = await Promise.all([
    db.from("tasks").select("completed_at").match(scope).eq("status", "done").gte("completed_at", startIso).limit(5000),
    db.from("tasks").select("id", { count: "exact", head: true }).match(scope).gte("created_at", startIso),
    db.from("tasks").select("id", { count: "exact", head: true }).match(scope).in("status", ["todo", "in_progress"]).lt("due_at", nowIso),
    db.from("tasks").select("priority").match(scope).in("status", ["todo", "in_progress"]).limit(5000),
    db.from("goals").select("id, title, progress, status").match(scope).in("status", ["active", "paused"]).order("updated_at", { ascending: false }).limit(20),
  ]);

  const perDay = new Map<string, number>();
  const dayCount = range === "week" ? 7 : days;
  for (let i = 0; i < dayCount; i++) {
    perDay.set(format(addDays(new TZDate(start, timezone), i), "yyyy-MM-dd"), 0);
  }
  const completedRows = unwrap<{ completed_at: string }[]>(completed);
  for (const row of completedRows) {
    const key = localDate(timezone, new Date(row.completed_at));
    if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const byPriority = Object.fromEntries(TASK_PRIORITIES.map((p) => [p, 0])) as Record<TaskPriority, number>;
  for (const row of unwrap<{ priority: TaskPriority }[]>(open)) byPriority[row.priority]++;

  return {
    range: { start: format(new TZDate(start, timezone), "yyyy-MM-dd"), end: today.date },
    completed_per_day: [...perDay.entries()].map(([date, count]) => ({ date, count })),
    completed_total: completedRows.length,
    created_total: created.count ?? 0,
    overdue_open: overdue.count ?? 0,
    open_by_priority: byPriority,
    goals: unwrap<Pick<Goal, "id" | "title" | "progress" | "status">[]>(goals),
  };
}
