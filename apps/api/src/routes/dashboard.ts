import { Hono } from "hono";
import {
  normalizeDashboardWidgets,
  type Briefing,
  type CalendarEvent,
  type DashboardSummary,
  type DashboardWidgetConfig,
  type FeedItem,
  type Goal,
  type KnowledgeDocumentSummary,
  type Task,
  type WatchlistMatch,
} from "@hub/shared";
import { unwrap } from "../lib/errors";
import { dayBounds, safeTimezone } from "../lib/time";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const OPEN = ["todo", "in_progress"];

/**
 * Dashboard aggregate. Reads stored data only — it never waits on AI inference,
 * so it stays fast even when the local model is offline or busy.
 */
export const dashboardRoutes = new Hono<AppEnv>().use("*", requireAuth).get("/", async (c) => {
  const db = c.get("db");
  const [profileRes, prefsRes] = await Promise.all([
    db.from("users").select("display_name, timezone").single(),
    db.from("user_preferences").select("dashboard_widgets").single(),
  ]);
  const profile = unwrap<{ display_name: string | null; timezone: string }>(profileRes, "Profile");
  const tz = safeTimezone(profile.timezone);
  const { start, end } = dayBounds(tz);
  const now = new Date();
  const recentSince = new Date(now.getTime() - 3 * 86_400_000).toISOString();

  const [today, overdue, completedToday, openTotal, events, goals, intelligence, developer, knowledge, matches, briefing, notifications] = await Promise.all([
    db.from("tasks").select("*").in("status", OPEN).gte("due_at", start.toISOString()).lt("due_at", end.toISOString()).order("priority_rank", { ascending: false }).limit(10),
    db.from("tasks").select("*").in("status", OPEN).lt("due_at", start.toISOString()).order("due_at").limit(10),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("status", "done").gte("completed_at", start.toISOString()),
    db.from("tasks").select("id", { count: "exact", head: true }).in("status", OPEN),
    db.from("calendar_events").select("*").gte("starts_at", start.toISOString()).lt("starts_at", new Date(start.getTime() + 3 * 86_400_000).toISOString()).order("starts_at").limit(8),
    db.from("goals").select("id, title, progress, status, type, target_date").eq("status", "active").order("target_date", { ascending: true, nullsFirst: false }).limit(6),
    db.rpc("intelligence_feed", { p_sort: "relevance", p_since: recentSince, p_limit: 20, p_offset: 0 }),
    db.rpc("intelligence_feed", { p_feed: "developer", p_sort: "newest", p_since: new Date(now.getTime() - 7 * 86_400_000).toISOString(), p_limit: 5, p_offset: 0 }),
    db
      .from("knowledge_documents")
      .select("id, user_id, folder_id, type, title, url, source_item_id, excerpt, ai_summary, auto_category, tags, metadata, index_status, index_error, indexed_at, embedding_model, chunk_count, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("watchlist_matches")
      .select("*, item:intelligence_items(id, title, url, source_name, published_at, feed, ai_summary), watchlist_item:watchlist_items(id, kind, value, watchlist_id)")
      .is("seen_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
    db.from("briefings").select("*").eq("kind", "daily").order("period_start", { ascending: false }).limit(1).maybeSingle(),
    db.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);

  const strip = (rows: (FeedItem & { total_count?: number })[]) => rows.map(({ total_count: _t, ...rest }) => rest as FeedItem);
  const aiFeeds = new Set(["ai_news", "models", "research", "products"]);
  const latestBriefing = unwrap<Briefing | null>(briefing);

  const summary: DashboardSummary = {
    profile: { display_name: profile.display_name, timezone: tz },
    now: now.toISOString(),
    widgets: normalizeDashboardWidgets(unwrap<{ dashboard_widgets: DashboardWidgetConfig[] }>(prefsRes, "Preferences").dashboard_widgets),
    tasks: {
      today: unwrap<Task[]>(today),
      overdue: unwrap<Task[]>(overdue),
      completed_today: completedToday.count ?? 0,
      open_total: openTotal.count ?? 0,
    },
    events: unwrap<CalendarEvent[]>(events),
    goals: unwrap<Pick<Goal, "id" | "title" | "progress" | "status" | "type" | "target_date">[]>(goals),
    intelligence: strip(unwrap<FeedItem[]>(intelligence))
      .filter((i) => aiFeeds.has(i.feed))
      .slice(0, 6),
    developer: strip(unwrap<FeedItem[]>(developer)),
    knowledge: unwrap<KnowledgeDocumentSummary[]>(knowledge),
    watchlist_matches: unwrap<WatchlistMatch[]>(matches),
    briefing: latestBriefing,
    unread_notifications: notifications.count ?? 0,
  };
  return c.json(summary);
});
