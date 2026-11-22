import { enqueueJob } from "../../jobs/queue";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { errorMessage } from "../../lib/errors";
import { adminDb } from "../../lib/supabase";
import { fetchReleases } from "../research/connectors";
import { storeItems } from "../research/ingest";

const MAX_REPOS_PER_RUN = 30;

/**
 * Developer Intelligence Agent — monitors repositories users follow on their
 * watchlists (built-in framework repos are covered by github_releases sources)
 * and records new releases as private developer intelligence items.
 */
export function registerDeveloperAgent() {
  registerJobHandler(
    "developer.check_watched_repos",
    async ({ log, signal }) => {
      const [{ data: watched, error }, { data: builtIn }] = await Promise.all([
        adminDb
          .from("watchlist_items")
          .select("id, user_id, value, last_checked_at")
          .eq("kind", "repository")
          .order("last_checked_at", { ascending: true, nullsFirst: true })
          .limit(MAX_REPOS_PER_RUN),
        adminDb.from("news_sources").select("config").eq("kind", "github_releases").is("user_id", null),
      ]);
      if (error) throw error;
      const covered = new Set((builtIn ?? []).map((s) => String((s.config as { repo?: string }).repo ?? "").toLowerCase()));

      let inserted = 0;
      let checked = 0;
      for (const w of watched ?? []) {
        if (signal.aborted) break;
        const repo = String(w.value);
        const patch: Record<string, unknown> = { last_checked_at: new Date().toISOString() };
        if (!covered.has(repo.toLowerCase())) {
          try {
            const releases = await fetchReleases(repo, { max: 2 });
            const result = await storeItems(
              releases,
              { feed: "developer", sourceId: null, sourceName: repo, weight: 1.15, defaultCategory: "ai-dev-tools", ownerUserId: w.user_id as string },
              log,
            );
            inserted += result.inserted;
            if (releases[0]?.metadata?.tag) patch.last_seen_release = String(releases[0].metadata.tag);
          } catch (err) {
            log.warn({ repo, err: errorMessage(err) }, "release check failed");
          }
        }
        checked++;
        await adminDb.from("watchlist_items").update(patch).eq("id", w.id);
      }
      if (inserted > 0) {
        await enqueueJob({ agent: "ai_news", kind: "ai_news.process_pending", dedupeKey: "ai_news.process_pending", priority: 6 });
        await enqueueJob({ agent: "watchlist", kind: "watchlist.match_recent", dedupeKey: "watchlist.match_recent", priority: 6 });
      }
      return { checked, inserted };
    },
    { timeoutMs: 10 * 60_000 },
  );

  registerSchedule({
    name: "developer.check-watched-repos",
    pattern: "15 */4 * * *",
    run: async () => {
      await enqueueJob({ agent: "developer", kind: "developer.check_watched_repos", dedupeKey: "developer.check_watched_repos", priority: 6 });
    },
  });
}
