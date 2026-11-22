import type { NewsSource } from "@hub/shared";
import { enqueueJob } from "../../jobs/queue";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { ExternalServiceError } from "../../lib/errors";
import { adminDb } from "../../lib/supabase";
import { ingestSource } from "./ingest";

/**
 * Research Agent — collects items from configured sources, preserving original URLs
 * and source timestamps. Each source is fetched by its own durable job.
 */
export function registerResearchAgent() {
  registerJobHandler(
    "research.ingest_source",
    async ({ job, log, signal }) => {
      const sourceId = String(job.payload.source_id ?? "");
      const { data: source } = await adminDb.from("news_sources").select("*").eq("id", sourceId).maybeSingle();
      if (!source) throw new ExternalServiceError("research", "source no longer exists", 404, false);
      if (!source.enabled) return { skipped: "source disabled" };
      const result = await ingestSource(source as NewsSource, log, signal);
      log.info({ source: source.name, ...result, insertedIds: undefined }, "source ingested");

      if (result.inserted > 0) {
        // Hand new items to the AI News Agent and the watchlist matcher right away.
        await enqueueJob({ agent: "ai_news", kind: "ai_news.process_pending", dedupeKey: "ai_news.process_pending", priority: 6 });
        await enqueueJob({ agent: "watchlist", kind: "watchlist.match_recent", dedupeKey: "watchlist.match_recent", priority: 6 });
      }
      return { ...result, insertedIds: undefined };
    },
    { timeoutMs: 5 * 60_000 },
  );

  registerSchedule({
    name: "research.schedule-due-sources",
    pattern: "*/10 * * * *",
    run: async () => {
      await enqueueDueSources();
    },
  });
}

/** Enqueues an ingestion job for every enabled source whose interval has elapsed (with failure backoff). */
export async function enqueueDueSources(opts: { feed?: string; force?: boolean; userId?: string } = {}) {
  let query = adminDb.from("news_sources").select("id, fetch_interval_minutes, last_fetched_at, consecutive_failures, user_id, feed").eq("enabled", true);
  if (opts.feed) query = query.eq("feed", opts.feed);
  if (opts.userId) query = query.or(`user_id.is.null,user_id.eq.${opts.userId}`);
  const { data, error } = await query;
  if (error) throw error;

  const now = Date.now();
  let enqueued = 0;
  for (const s of data ?? []) {
    const backoff = 2 ** Math.min(s.consecutive_failures ?? 0, 5);
    const dueAt = s.last_fetched_at ? new Date(s.last_fetched_at).getTime() + s.fetch_interval_minutes * 60_000 * backoff : 0;
    if (!opts.force && dueAt > now) continue;
    await enqueueJob({
      agent: "research",
      kind: "research.ingest_source",
      payload: { source_id: s.id },
      userId: s.user_id,
      dedupeKey: `ingest:${s.id}`,
      priority: 5,
      maxAttempts: 3,
    });
    enqueued++;
  }
  return enqueued;
}
