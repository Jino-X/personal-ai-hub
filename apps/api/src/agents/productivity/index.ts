import { enqueueJob } from "../../jobs/queue";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { adminDb } from "../../lib/supabase";

/**
 * Personal Productivity Agent — background responsibilities:
 *  - deliver due task reminders as notifications (respecting preferences)
 * Interactive responsibilities (planning, stats, progress analysis) live in planner.ts / stats.ts.
 */
export function registerProductivityAgent() {
  registerJobHandler(
    "productivity.send_reminders",
    async ({ log }) => {
      const now = new Date().toISOString();
      const { data: due, error } = await adminDb
        .from("tasks")
        .select("id, user_id, title, due_at, priority")
        .lte("remind_at", now)
        .is("reminder_sent_at", null)
        .in("status", ["todo", "in_progress"])
        .order("remind_at")
        .limit(200);
      if (error) throw error;
      if (!due?.length) return { sent: 0 };

      const userIds = [...new Set(due.map((t) => t.user_id as string))];
      const { data: prefs } = await adminDb
        .from("notification_preferences")
        .select("user_id, task_reminders_enabled")
        .in("user_id", userIds);
      const disabled = new Set((prefs ?? []).filter((p) => !p.task_reminders_enabled).map((p) => p.user_id as string));

      const notifications = due
        .filter((t) => !disabled.has(t.user_id as string))
        .map((t) => ({
          user_id: t.user_id,
          kind: "task_reminder",
          title: `Reminder: ${t.title}`,
          body: t.due_at ? `Due ${new Date(t.due_at as string).toUTCString()}` : null,
          link: `/productivity/tasks?task=${t.id}`,
          metadata: { task_id: t.id, priority: t.priority },
        }));
      if (notifications.length) {
        const { error: insertError } = await adminDb.from("notifications").insert(notifications);
        if (insertError) throw insertError;
      }
      // Mark all (including muted users') as handled so they aren't re-processed.
      const { error: updateError } = await adminDb
        .from("tasks")
        .update({ reminder_sent_at: now })
        .in(
          "id",
          due.map((t) => t.id),
        );
      if (updateError) throw updateError;
      log.info({ sent: notifications.length }, "task reminders delivered");
      return { sent: notifications.length };
    },
    { timeoutMs: 60_000 },
  );

  registerSchedule({
    name: "productivity.reminders",
    pattern: "* * * * *",
    run: async () => {
      await enqueueJob({ agent: "productivity", kind: "productivity.send_reminders", dedupeKey: "productivity.reminders", priority: 1, maxAttempts: 3 });
    },
  });
}
