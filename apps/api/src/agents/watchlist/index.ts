import type { WatchKind } from "@hub/shared";
import { enqueueJob } from "../../jobs/queue";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { adminDb } from "../../lib/supabase";

interface WatchRow {
  id: string;
  user_id: string;
  watchlist_id: string;
  kind: WatchKind;
  value: string;
  match_terms: string[];
  watchlists: { name: string; notify: boolean } | null;
}

interface ItemRow {
  id: string;
  title: string;
  url: string;
  owner_user_id: string | null;
  source_excerpt: string | null;
  ai_summary: string | null;
  technologies: string[];
  metadata: Record<string, unknown>;
  importance_score: number;
  feed: string;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordMatch(haystack: string, term: string) {
  const t = term.trim();
  if (t.length < 2) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(t)}($|[^\\p{L}\\p{N}])`, "iu").test(haystack);
}

/** Which of a watch entry's terms an item matches (empty = no match). */
export function matchItem(watch: Pick<WatchRow, "kind" | "value" | "match_terms">, item: ItemRow): string[] {
  if (watch.kind === "repository") {
    const repo = watch.value.toLowerCase();
    const itemRepo = String(item.metadata.repo ?? "").toLowerCase();
    if (itemRepo === repo || item.url.toLowerCase().includes(`github.com/${repo}`)) return [watch.value];
  }
  const haystack = [item.title, item.ai_summary ?? "", (item.source_excerpt ?? "").slice(0, 2500), item.technologies.join(" ")].join("\n");
  const terms = [watch.kind === "repository" ? (watch.value.split("/")[1] ?? watch.value) : watch.value, ...watch.match_terms];
  return terms.filter((t) => wordMatch(haystack, t));
}

/** Matches items against every watch entry and records new matches + alerts. */
async function matchItems(items: ItemRow[], watches: WatchRow[]) {
  if (items.length === 0 || watches.length === 0) return { matches: 0, notified: 0 };

  const rows: { user_id: string; watchlist_item_id: string; item_id: string; matched_terms: string[] }[] = [];
  for (const item of items) {
    for (const w of watches) {
      if (item.owner_user_id && item.owner_user_id !== w.user_id) continue;
      const terms = matchItem(w, item);
      if (terms.length) rows.push({ user_id: w.user_id, watchlist_item_id: w.id, item_id: item.id, matched_terms: terms });
    }
  }
  if (rows.length === 0) return { matches: 0, notified: 0 };

  const { data: inserted, error } = await adminDb
    .from("watchlist_matches")
    .upsert(rows, { onConflict: "watchlist_item_id,item_id", ignoreDuplicates: true })
    .select("user_id, watchlist_item_id, item_id");
  if (error) throw error;
  const fresh = inserted ?? [];
  if (fresh.length === 0) return { matches: 0, notified: 0 };

  // Alerts: one notification per user per run, respecting preferences and watchlist settings.
  const userIds = [...new Set(fresh.map((m) => m.user_id as string))];
  const { data: prefs } = await adminDb
    .from("notification_preferences")
    .select("user_id, watchlist_alerts_enabled, min_alert_relevance")
    .in("user_id", userIds);
  const prefByUser = new Map((prefs ?? []).map((p) => [p.user_id as string, p]));
  const watchById = new Map(watches.map((w) => [w.id, w]));
  const itemById = new Map(items.map((i) => [i.id, i]));

  const notifications = [];
  for (const userId of userIds) {
    const pref = prefByUser.get(userId);
    if (pref && !pref.watchlist_alerts_enabled) continue;
    const threshold = Math.max(0, Number(pref?.min_alert_relevance ?? 50) - 20);
    const alertable = fresh.filter((m) => {
      const w = watchById.get(m.watchlist_item_id as string);
      const item = itemById.get(m.item_id as string);
      return m.user_id === userId && w?.watchlists?.notify !== false && item && (item.importance_score >= threshold || w?.kind === "repository");
    });
    if (alertable.length === 0) continue;
    const first = itemById.get(alertable[0]!.item_id as string)!;
    const watch = watchById.get(alertable[0]!.watchlist_item_id as string)!;
    notifications.push({
      user_id: userId,
      kind: "watchlist_match",
      title: alertable.length === 1 ? `${watch.value}: ${first.title}` : `${alertable.length} new updates on your watchlists`,
      body: alertable.length === 1 ? (first.ai_summary ?? null) : alertable.slice(0, 3).map((m) => itemById.get(m.item_id as string)?.title).join(" · "),
      link: `/watchlist?watchlist=${watch.watchlist_id}`,
      metadata: { item_ids: alertable.map((m) => m.item_id) },
    });
  }
  if (notifications.length) await adminDb.from("notifications").insert(notifications);
  return { matches: fresh.length, notified: notifications.length };
}

const ITEM_COLUMNS = "id, title, url, owner_user_id, source_excerpt, ai_summary, technologies, metadata, importance_score, feed";
const WATCH_COLUMNS = "id, user_id, watchlist_id, kind, value, match_terms, watchlists(name, notify)";

/** Watchlist Agent — detects relevant changes for the things users follow. */
export function registerWatchlistAgent() {
  registerJobHandler("watchlist.match_recent", async () => {
    const since = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const [{ data: items, error: itemsError }, { data: watches, error: watchError }] = await Promise.all([
      adminDb.from("intelligence_items").select(ITEM_COLUMNS).is("duplicate_of", null).gte("created_at", since).limit(1000),
      adminDb.from("watchlist_items").select(WATCH_COLUMNS).limit(5000),
    ]);
    if (itemsError) throw itemsError;
    if (watchError) throw watchError;
    return matchItems((items ?? []) as ItemRow[], (watches ?? []) as unknown as WatchRow[]);
  });

  /** When a user adds something to a watchlist, find matches from the last 30 days (no alerts for the backlog). */
  registerJobHandler("watchlist.backfill_item", async ({ job }) => {
    const { data: watch } = await adminDb.from("watchlist_items").select(WATCH_COLUMNS).eq("id", String(job.payload.watchlist_item_id)).maybeSingle();
    if (!watch) return { skipped: "watch item deleted" };
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: items, error } = await adminDb
      .from("intelligence_items")
      .select(ITEM_COLUMNS)
      .is("duplicate_of", null)
      .gte("created_at", since)
      .or(`owner_user_id.is.null,owner_user_id.eq.${(watch as unknown as WatchRow).user_id}`)
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) throw error;
    const w = watch as unknown as WatchRow;
    const rows = ((items ?? []) as ItemRow[])
      .map((item) => ({ item, terms: matchItem(w, item) }))
      .filter((m) => m.terms.length > 0)
      .map(({ item, terms }) => ({ user_id: w.user_id, watchlist_item_id: w.id, item_id: item.id, matched_terms: terms, seen_at: new Date().toISOString() }));
    if (rows.length) await adminDb.from("watchlist_matches").upsert(rows, { onConflict: "watchlist_item_id,item_id", ignoreDuplicates: true });
    return { matches: rows.length };
  });

  registerSchedule({
    name: "watchlist.match-recent",
    pattern: "*/15 * * * *",
    run: async () => {
      await enqueueJob({ agent: "watchlist", kind: "watchlist.match_recent", dedupeKey: "watchlist.match_recent", priority: 6 });
    },
  });
}
