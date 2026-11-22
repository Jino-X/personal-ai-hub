import type { CategorySlug, IntelligenceFeed, NewsSource } from "@hub/shared";

/**
 * A normalised item as reported by a source. Every field here comes from the
 * source itself — nothing is inferred or fabricated at this stage.
 */
export interface RawItem {
  externalId?: string | null;
  url: string;
  title: string;
  author?: string | null;
  /** ISO timestamp exactly as provided by the source, or null when the source has none. */
  publishedAt?: string | null;
  /** Verbatim (HTML-stripped, trimmed) source text used for summarisation. */
  excerpt?: string | null;
  /** Source-reported metrics. `popularity` is the metric used for "popular" sorting. */
  metadata?: Record<string, unknown> & { popularity?: number };
  categoryHint?: CategorySlug | null;
  /** Feeds that refresh metrics on repeat sightings (trending repos/models). */
  refreshable?: boolean;
  feed?: IntelligenceFeed;
}

export type Connector = (source: NewsSource, signal: AbortSignal) => Promise<RawItem[]>;

/** The source can't run because it isn't configured (e.g. missing API token). Not a failure. */
export class SourceNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceNotConfiguredError";
  }
}
