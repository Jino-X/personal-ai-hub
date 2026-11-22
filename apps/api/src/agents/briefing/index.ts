import { addDays, format } from "date-fns";
import { z } from "zod";
import type { Briefing, BriefingContent, BriefingItemRef, BriefingKind, BriefingTaskRef, CategorySlug } from "@hub/shared";
import { dataBlock, GROUNDING_RULES } from "../../ai/prompts";
import { tryResolveAI } from "../../ai/service";
import { enqueueJob } from "../../jobs/queue";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { AIUnavailableError, errorMessage } from "../../lib/errors";
import { adminDb } from "../../lib/supabase";
import { dayBounds, localParts, safeTimezone, weekBounds, zonedMidnight } from "../../lib/time";
import { productivityStats } from "../productivity/stats";

/**
 * Briefing Agent — combines data the other agents maintain into daily and weekly
 * briefings. All sections are built from stored records; the optional AI narrative
 * is generated strictly from those sections.
 *
 * Runs with the service-role client, so every query is explicitly scoped to the user
 * (and private intelligence items are restricted to their owner).
 */

const taskRef = (t: Record<string, unknown>): BriefingTaskRef => ({
  id: String(t.id),
  title: String(t.title),
  priority: t.priority as BriefingTaskRef["priority"],
  due_at: (t.due_at as string | null) ?? null,
  status: t.status as BriefingTaskRef["status"],
});

async function topItems(userId: string, feeds: string[], sinceIso: string, interests: Set<string>, limit: number): Promise<BriefingItemRef[]> {
  const { data } = await adminDb
    .from("intelligence_items")
    .select("id, title, url, source_name, published_at, fetched_at, ai_summary, importance_score, intelligence_categories(slug, name)")
    .in("feed", feeds)
    .is("duplicate_of", null)
    .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
    .gte("fetched_at", sinceIso)
    .order("importance_score", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as unknown as {
    id: string;
    title: string;
    url: string;
    source_name: string;
    published_at: string | null;
    ai_summary: string | null;
    importance_score: number;
    intelligence_categories: { slug: CategorySlug; name: string } | null;
  }[];
  return rows
    .map((r) => ({ r, score: r.importance_score + (r.intelligence_categories && interests.has(r.intelligence_categories.slug) ? 15 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      source_name: r.source_name,
      published_at: r.published_at,
      category: r.intelligence_categories?.name ?? null,
      summary: r.ai_summary,
    }));
}

/** Builds the data sections of a briefing from the user's stored records. */
export async function buildBriefingContent(userId: string, kind: BriefingKind, date: string, timezone: string): Promise<{ content: BriefingContent; periodStart: string; periodEnd: string; title: string }> {
  const dayStart = zonedMidnight(date, timezone);
  const dayEnd = addDays(dayStart, 1);
  const week = weekBounds(timezone, dayStart);
  const periodStart = kind === "daily" ? date : week.startDate;
  const periodEnd = kind === "daily" ? date : week.endDate;
  const windowStart = kind === "daily" ? new Date(dayStart.getTime() - 36 * 3_600_000) : week.start;

  const { data: prefs } = await adminDb.from("user_preferences").select("interest_categories").eq("user_id", userId).maybeSingle();
  const interests = new Set<string>((prefs?.interest_categories as string[] | undefined) ?? []);
  const nowIso = new Date().toISOString();

  const [dueToday, overdue, unfinished, events, learningGoals, milestones, saved] = await Promise.all([
    adminDb.from("tasks").select("id, title, priority, due_at, status").eq("user_id", userId).in("status", ["todo", "in_progress"]).gte("due_at", dayStart.toISOString()).lt("due_at", dayEnd.toISOString()).order("priority_rank", { ascending: false }).limit(10),
    adminDb.from("tasks").select("id, title, priority, due_at, status").eq("user_id", userId).in("status", ["todo", "in_progress"]).lt("due_at", kind === "daily" ? dayStart.toISOString() : nowIso).order("due_at").limit(10),
    adminDb.from("tasks").select("id, title, priority, due_at, status").eq("user_id", userId).eq("status", "in_progress").order("updated_at", { ascending: false }).limit(5),
    adminDb.from("calendar_events").select("id, title, starts_at, ends_at, all_day, location").eq("user_id", userId).gte("starts_at", dayStart.toISOString()).lt("starts_at", (kind === "daily" ? dayEnd : addDays(dayStart, 7)).toISOString()).order("starts_at").limit(15),
    adminDb.from("goals").select("id, title").eq("user_id", userId).eq("status", "active").eq("type", "learning").limit(5),
    adminDb.from("goal_milestones").select("goal_id, title, completed_at, sort_order").eq("user_id", userId).is("completed_at", null).order("sort_order").limit(100),
    adminDb.from("knowledge_documents").select("id, title, url, type").eq("user_id", userId).gte("created_at", windowStart.toISOString()).order("created_at", { ascending: false }).limit(10),
  ]);

  // Daily priorities: due today, then urgent/high open tasks without a due date today.
  let priorities = (dueToday.data ?? []).map(taskRef);
  if (priorities.length < 5) {
    const { data: urgent } = await adminDb
      .from("tasks")
      .select("id, title, priority, due_at, status")
      .eq("user_id", userId)
      .in("status", ["todo", "in_progress"])
      .in("priority", ["urgent", "high"])
      .order("priority_rank", { ascending: false })
      .limit(10);
    const seen = new Set(priorities.map((p) => p.id));
    priorities = [...priorities, ...(urgent ?? []).map(taskRef).filter((t) => !seen.has(t.id))].slice(0, 7);
  }

  const nextSteps = new Map<string, string[]>();
  for (const m of milestones.data ?? []) {
    const list = nextSteps.get(m.goal_id as string) ?? [];
    if (list.length < 2) nextSteps.set(m.goal_id as string, [...list, String(m.title)]);
  }

  const content: BriefingContent = {
    priorities,
    overdue: (overdue.data ?? []).map(taskRef),
    unfinished: (unfinished.data ?? []).map(taskRef),
    events: (events.data ?? []) as BriefingContent["events"],
    ai_developments: await topItems(userId, ["ai_news", "models", "research", "products"], windowStart.toISOString(), interests, kind === "daily" ? 6 : 10),
    developer_updates: await topItems(userId, ["developer", "github_trending"], windowStart.toISOString(), interests, kind === "daily" ? 5 : 8),
    learning: (learningGoals.data ?? []).map((g) => ({ goal_id: g.id as string, goal_title: g.title as string, next_steps: nextSteps.get(g.id as string) ?? [] })),
    saved_research: (saved.data ?? []).map((d) => ({ id: d.id as string, title: d.title as string, url: (d.url as string | null) ?? null, type: d.type as string })),
    ai: null,
  };

  if (kind === "weekly") {
    const stats = await productivityStats(adminDb, timezone, "week", userId);
    const done = stats.completed_total;
    content.productivity = {
      completed: done,
      created: stats.created_total,
      completion_rate: stats.created_total > 0 ? Math.min(1, done / stats.created_total) : done > 0 ? 1 : 0,
      completed_per_day: stats.completed_per_day,
    };
    content.goals = stats.goals.map((g) => ({ ...g, progress_delta: null }));
  }

  const title =
    kind === "daily"
      ? `Daily briefing — ${format(dayStart, "EEEE d MMMM")}`
      : `Weekly briefing — week of ${format(zonedMidnight(periodStart, timezone), "d MMMM")}`;
  return { content, periodStart, periodEnd, title };
}

const narrativeSchema = z.object({
  headline: z.string().describe("One short sentence capturing the day/week"),
  summary: z.string().describe("3-5 sentences tying together priorities, schedule, progress and notable developments"),
  focus: z.array(z.string()).max(5).describe("The few things to focus on, referencing specific tasks or goals"),
  recommendations: z.array(z.string()).max(5).describe("Concrete suggestions, e.g. a learning activity or an item worth reading"),
});

/** Adds the AI narrative to a stored briefing. Throws AIUnavailableError when local AI is offline. */
async function enrichBriefing(briefingId: string) {
  const { data } = await adminDb.from("briefings").select("*").eq("id", briefingId).maybeSingle();
  const briefing = data as Briefing | null;
  if (!briefing) return { skipped: "deleted" };
  if (briefing.ai_status === "done") return { skipped: "already enriched" };

  const ai = await tryResolveAI(briefing.user_id);
  if (!ai) {
    if (Date.now() - new Date(briefing.created_at).getTime() > 20 * 3_600_000) {
      await adminDb.from("briefings").update({ ai_status: "skipped" }).eq("id", briefingId);
      return { skipped: "AI unavailable for too long" };
    }
    throw new AIUnavailableError();
  }

  await adminDb.from("briefings").update({ ai_status: "processing" }).eq("id", briefingId);
  try {
    const { content } = briefing;
    const { object, model } = await ai.generateObject(narrativeSchema, [
      {
        role: "system",
        content: `You are the Briefing Agent of a personal AI hub. Write a ${briefing.kind} briefing narrative for the user from the data provided.
Only mention tasks, events, goals and news items that appear in the data. Do not invent anything. Keep it warm, direct and practical.
${GROUNDING_RULES}`,
      },
      {
        role: "user",
        content: [
          `Briefing: ${briefing.title} (${briefing.period_start} → ${briefing.period_end})`,
          dataBlock("priorities", content.priorities),
          dataBlock("overdue_tasks", content.overdue),
          dataBlock("in_progress", content.unfinished),
          dataBlock("events", content.events),
          dataBlock("ai_developments", content.ai_developments.map(({ title, source_name, summary, category }) => ({ title, source_name, summary, category }))),
          dataBlock("developer_updates", content.developer_updates.map(({ title, source_name, summary }) => ({ title, source_name, summary }))),
          dataBlock("learning", content.learning),
          dataBlock("saved_research", content.saved_research),
          content.productivity ? dataBlock("productivity", content.productivity) : "",
          content.goals ? dataBlock("goals", content.goals) : "",
        ].join("\n\n"),
      },
    ]);
    await adminDb
      .from("briefings")
      .update({ content: { ...content, ai: object }, ai_status: "done", model, error: null })
      .eq("id", briefingId);
    return { enriched: true };
  } catch (err) {
    await adminDb.from("briefings").update({ ai_status: "failed", error: errorMessage(err).slice(0, 500) }).eq("id", briefingId);
    throw err;
  }
}

/** Generates (or regenerates) a briefing's data sections, then queues the AI narrative. */
export async function generateBriefing(userId: string, kind: BriefingKind, date: string | undefined, notify: boolean): Promise<Briefing> {
  const { data: user } = await adminDb.from("users").select("timezone").eq("id", userId).single();
  const timezone = safeTimezone(user?.timezone as string | undefined);
  const day = date ?? dayBounds(timezone).date;
  const { content, periodStart, periodEnd, title } = await buildBriefingContent(userId, kind, day, timezone);

  const { data, error } = await adminDb
    .from("briefings")
    .upsert(
      { user_id: userId, kind, period_start: periodStart, period_end: periodEnd, title, content, status: "ready", ai_status: "pending", generated_at: new Date().toISOString(), error: null },
      { onConflict: "user_id,kind,period_start" },
    )
    .select("*")
    .single();
  if (error) throw error;
  const briefing = data as Briefing;

  await enqueueJob({ agent: "briefing", kind: "briefing.enrich", payload: { briefing_id: briefing.id }, userId, dedupeKey: `briefing-enrich:${briefing.id}`, priority: 3 });
  if (notify) {
    await adminDb.from("notifications").insert({
      user_id: userId,
      kind: "briefing_ready",
      title: `Your ${kind} briefing is ready`,
      body: `${content.priorities.length} priorities · ${content.events.length} events · ${content.ai_developments.length} AI developments`,
      link: `/briefings?id=${briefing.id}`,
    });
  }
  return briefing;
}

export function registerBriefingAgent() {
  registerJobHandler("briefing.generate", async ({ job }) => {
    const kind = job.payload.kind as BriefingKind;
    const briefing = await generateBriefing(job.user_id!, kind, job.payload.date as string | undefined, Boolean(job.payload.notify));
    return { briefing_id: briefing.id };
  });

  registerJobHandler("briefing.enrich", async ({ job }) => enrichBriefing(String(job.payload.briefing_id)), { timeoutMs: 10 * 60_000 });

  // Every 15 minutes: enqueue briefings that are due in each user's local time.
  registerSchedule({
    name: "briefing.schedule-due",
    pattern: "*/15 * * * *",
    run: async () => {
      const { data } = await adminDb
        .from("notification_preferences")
        .select("user_id, daily_briefing_enabled, daily_briefing_time, weekly_briefing_enabled, weekly_briefing_day, users(timezone)")
        .or("daily_briefing_enabled.eq.true,weekly_briefing_enabled.eq.true");
      for (const p of (data ?? []) as unknown as {
        user_id: string;
        daily_briefing_enabled: boolean;
        daily_briefing_time: string;
        weekly_briefing_enabled: boolean;
        weekly_briefing_day: number;
        users: { timezone: string } | null;
      }[]) {
        const tz = safeTimezone(p.users?.timezone);
        const local = localParts(tz);
        const [h, m] = p.daily_briefing_time.split(":").map(Number) as [number, number];
        if (local.hour * 60 + local.minute < h * 60 + m) continue;

        if (p.daily_briefing_enabled) {
          const { count } = await adminDb.from("briefings").select("id", { count: "exact", head: true }).eq("user_id", p.user_id).eq("kind", "daily").eq("period_start", local.date);
          if (!count) {
            await enqueueJob({ agent: "briefing", kind: "briefing.generate", userId: p.user_id, payload: { kind: "daily", date: local.date, notify: true }, dedupeKey: `briefing:daily:${p.user_id}:${local.date}`, priority: 2 });
          }
        }
        if (p.weekly_briefing_enabled && local.weekday === p.weekly_briefing_day) {
          const weekStart = weekBounds(tz).startDate;
          const { count } = await adminDb.from("briefings").select("id", { count: "exact", head: true }).eq("user_id", p.user_id).eq("kind", "weekly").eq("period_start", weekStart);
          if (!count) {
            await enqueueJob({ agent: "briefing", kind: "briefing.generate", userId: p.user_id, payload: { kind: "weekly", date: local.date, notify: true }, dedupeKey: `briefing:weekly:${p.user_id}:${weekStart}`, priority: 2 });
          }
        }
      }
    },
  });
}
