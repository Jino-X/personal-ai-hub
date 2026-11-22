import type { CategorySlug, IntelligenceFeed, NewsSource } from "@hub/shared";
import { sha256 } from "../../lib/crypto";
import { errorMessage } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { fetchAndExtract } from "../../lib/extract";
import { adminDb } from "../../lib/supabase";
import { CONNECTORS, fetchModelCard, fetchRepoReadme, POPULARITY_SCALE } from "./connectors";
import { baseImportance, canonicalizeUrl, categorize, detectTechnologies, detectTopics } from "./text";
import { SourceNotConfiguredError, type RawItem } from "./types";

interface CategoryRow {
  id: string;
  slug: string;
  keywords: string[];
}

let categoryCache: { rows: CategoryRow[]; at: number } | null = null;
async function categories(): Promise<CategoryRow[]> {
  if (categoryCache && Date.now() - categoryCache.at < 10 * 60_000) return categoryCache.rows;
  const { data, error } = await adminDb.from("intelligence_categories").select("id, slug, keywords");
  if (error) throw error;
  categoryCache = { rows: data as CategoryRow[], at: Date.now() };
  return categoryCache.rows;
}

/** Feeds where the same story is often covered by several outlets → title similarity dedupe. */
const NEAR_DUP_FEEDS = new Set<IntelligenceFeed>(["ai_news", "products", "developer"]);

export interface IngestContext {
  feed: IntelligenceFeed;
  sourceId: string | null;
  sourceName: string;
  weight: number;
  defaultCategory: CategorySlug | null;
  /** Set for items from a user's private source/watchlist — then only that user sees them. */
  ownerUserId: string | null;
  enrich?: boolean;
}

export interface IngestResult {
  fetched: number;
  inserted: number;
  refreshed: number;
  duplicates: number;
  insertedIds: string[];
}

/** Normalises, deduplicates, categorises and stores raw items. */
export async function storeItems(items: RawItem[], ctx: IngestContext, log: Logger): Promise<IngestResult> {
  const cats = await categories();
  const categoryIdBySlug = new Map(cats.map((c) => [c.slug, c.id]));
  const result: IngestResult = { fetched: items.length, inserted: 0, refreshed: 0, duplicates: 0, insertedIds: [] };
  const enrichBudget = { articles: 10 };

  for (const item of items.slice(0, 100)) {
    const feed = item.feed ?? ctx.feed;
    const canonical = canonicalizeUrl(item.url);
    const urlHash = sha256(canonical);
    const popularity = typeof item.metadata?.popularity === "number" ? item.metadata.popularity : undefined;
    const importance = baseImportance(ctx.weight, popularity, POPULARITY_SCALE[feed] ?? 0);

    const { data: existing } = await adminDb.from("intelligence_items").select("id, owner_user_id").eq("url_hash", urlHash).maybeSingle();
    if (existing) {
      if (item.refreshable) {
        // Repeat sighting on a trending list: refresh source metrics and resurface it.
        await adminDb
          .from("intelligence_items")
          .update({ metadata: item.metadata ?? {}, importance_score: importance, fetched_at: new Date().toISOString() })
          .eq("id", existing.id);
        result.refreshed++;
      } else {
        result.duplicates++;
      }
      // A public source also covering a private item makes it public.
      if (existing.owner_user_id && !ctx.ownerUserId) {
        await adminDb.from("intelligence_items").update({ owner_user_id: null }).eq("id", existing.id);
      }
      continue;
    }

    let duplicateOf: string | null = null;
    if (NEAR_DUP_FEEDS.has(feed) && !ctx.ownerUserId) {
      const { data } = await adminDb.rpc("find_similar_intelligence_item", {
        p_title: item.title,
        p_published_at: item.publishedAt ?? null,
        p_feed: feed,
      });
      duplicateOf = (data as string | null) ?? null;
    }

    let excerpt = item.excerpt ?? null;
    if (ctx.enrich && !duplicateOf) {
      if ((excerpt?.length ?? 0) < 200 && enrichBudget.articles > 0 && /^https?:/.test(item.url) && feed !== "github_trending" && feed !== "models") {
        // Feeds without body text (e.g. some blogs) — read the article itself so the summary is grounded.
        enrichBudget.articles--;
        try {
          const page = await fetchAndExtract(item.url);
          if (page.text.length > (excerpt?.length ?? 0)) excerpt = page.text.slice(0, 4000);
          item.publishedAt ??= page.publishedAt;
        } catch (err) {
          log.debug({ url: item.url, err: errorMessage(err) }, "article enrichment failed");
        }
      } else if (feed === "github_trending" && item.metadata?.repo) {
        const readme = await fetchRepoReadme(String(item.metadata.repo));
        if (readme) excerpt = [item.excerpt, readme].filter(Boolean).join("\n\n");
      } else if (feed === "models" && item.metadata?.model_id) {
        const card = await fetchModelCard(String(item.metadata.model_id));
        if (card) excerpt = [item.excerpt, card].filter(Boolean).join("\n\n");
      }
    }

    const text = `${item.title}\n${excerpt ?? ""}`;
    const category = categorize(text, cats, item.categoryHint ?? ctx.defaultCategory);
    const { data: inserted, error } = await adminDb
      .from("intelligence_items")
      .insert({
        source_id: ctx.sourceId,
        owner_user_id: ctx.ownerUserId,
        feed,
        external_id: item.externalId ?? null,
        url: item.url,
        canonical_url: canonical,
        url_hash: urlHash,
        title: item.title.slice(0, 1000),
        source_name: ctx.sourceName,
        author: item.author ?? null,
        published_at: item.publishedAt ?? null,
        category_id: category ? (categoryIdBySlug.get(category) ?? null) : null,
        source_excerpt: excerpt,
        metadata: item.metadata ?? {},
        technologies: detectTechnologies(text),
        topics: detectTopics(text),
        importance_score: importance,
        duplicate_of: duplicateOf,
        ai_status: duplicateOf || !excerpt || excerpt.length < 40 ? "skipped" : "pending",
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        result.duplicates++;
        continue;
      }
      log.warn({ err: error.message, url: item.url }, "failed to store item");
      continue;
    }
    if (duplicateOf) result.duplicates++;
    else {
      result.inserted++;
      result.insertedIds.push(inserted.id as string);
    }
  }
  return result;
}

/** Research Agent: fetch one configured source and store its items. */
export async function ingestSource(source: NewsSource, log: Logger, signal: AbortSignal): Promise<IngestResult & { skipped?: string }> {
  const now = new Date().toISOString();
  const cats = await categories();
  const defaultSlug = (cats.find((c) => c.id === (source as NewsSource & { default_category_id?: string }).default_category_id)?.slug ?? null) as CategorySlug | null;

  try {
    const raw = await CONNECTORS[source.kind](source, signal);
    const result = await storeItems(
      raw,
      {
        feed: source.feed,
        sourceId: source.id,
        sourceName: source.name.replace(/ releases$/i, "").replace(/^GitHub Trending.*/, "GitHub Trending"),
        weight: source.weight,
        defaultCategory: defaultSlug,
        ownerUserId: source.user_id,
        enrich: true,
      },
      log,
    );
    await adminDb
      .from("news_sources")
      .update({ last_fetched_at: now, last_success_at: now, last_error: null, consecutive_failures: 0 })
      .eq("id", source.id);
    return result;
  } catch (err) {
    if (err instanceof SourceNotConfiguredError) {
      await adminDb.from("news_sources").update({ last_fetched_at: now, last_error: err.message }).eq("id", source.id);
      return { fetched: 0, inserted: 0, refreshed: 0, duplicates: 0, insertedIds: [], skipped: err.message };
    }
    await adminDb
      .from("news_sources")
      .update({ last_fetched_at: now, last_error: errorMessage(err).slice(0, 500), consecutive_failures: source.consecutive_failures + 1 })
      .eq("id", source.id);
    throw err;
  }
}
