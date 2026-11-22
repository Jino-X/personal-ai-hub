import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, addWeeks, addYears, isWeekend } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Recurrence, Task } from "@hub/shared";
import { safeTimezone, zonedMidnight } from "../../lib/time";

/** Next occurrence after `from`, computed in the user's time zone (DST-safe). */
export function nextOccurrence(from: Date, rule: Recurrence, timezone: string): Date {
  const zoned = new TZDate(from, safeTimezone(timezone));
  const n = Math.max(1, rule.interval || 1);
  let next: TZDate;
  switch (rule.freq) {
    case "daily":
      next = addDays(zoned, n);
      break;
    case "weekdays":
      next = addDays(zoned, 1);
      while (isWeekend(next)) next = addDays(next, 1);
      break;
    case "weekly":
      next = addWeeks(zoned, n);
      break;
    case "monthly":
      next = addMonths(zoned, n);
      break;
    case "yearly":
      next = addYears(zoned, n);
      break;
  }
  return new Date(next.getTime());
}

/**
 * When a recurring task is completed, schedule its next occurrence (always in the
 * future, respecting `until`). Returns the new task, or null when the series ended.
 */
export async function createNextOccurrence(db: SupabaseClient, task: Task, timezone: string): Promise<Task | null> {
  if (!task.recurrence) return null;
  const now = new Date();
  const base = task.due_at ? new Date(task.due_at) : now;
  let due = nextOccurrence(base, task.recurrence, timezone);
  for (let i = 0; i < 1000 && due <= now; i++) due = nextOccurrence(due, task.recurrence, timezone);

  if (task.recurrence.until) {
    const until = zonedMidnight(task.recurrence.until, timezone);
    if (due.getTime() >= until.getTime() + 86_400_000) return null;
  }

  const reminderOffset = task.remind_at && task.due_at ? new Date(task.due_at).getTime() - new Date(task.remind_at).getTime() : null;
  const { data, error } = await db
    .from("tasks")
    .insert({
      user_id: task.user_id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      category: task.category,
      tags: task.tags,
      project_id: task.project_id,
      goal_id: task.goal_id,
      recurrence: task.recurrence,
      recurrence_parent_id: task.recurrence_parent_id ?? task.id,
      due_at: due.toISOString(),
      remind_at: reminderOffset !== null ? new Date(due.getTime() - reminderOffset).toISOString() : null,
      source: "recurrence",
      status: "todo",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Task;
}
