import { z } from "zod";
import { CATEGORY_SLUGS, COLORS, INTELLIGENCE_FEEDS, USER_SOURCE_KINDS, WATCH_KINDS } from "../constants";
import { httpUrl, idSchema, paginationQuery, queryBool } from "./common";

export const feedQuerySchema = paginationQuery.extend({
  feed: z.enum(INTELLIGENCE_FEEDS).optional(),
  category: z.enum(CATEGORY_SLUGS).optional(),
  technology: z.string().trim().max(60).optional(),
  q: z.string().trim().max(200).optional(),
  unread: queryBool.optional(),
  bookmarked: queryBool.optional(),
  watchlist_id: idSchema.optional(),
  since_days: z.coerce.number().int().min(1).max(365).optional(),
  sort: z.enum(["relevance", "newest", "popular"]).default("relevance"),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const itemStateSchema = z
  .object({
    read: z.boolean().optional(),
    hidden: z.boolean().optional(),
    feedback: z.union([z.literal(-1), z.literal(1), z.null()]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const markAllReadSchema = z.object({
  feed: z.enum(INTELLIGENCE_FEEDS).optional(),
  item_ids: z.array(idSchema).max(500).optional(),
});

export const bookmarkCreateSchema = z.object({
  item_id: idSchema,
  note: z.string().max(2000).nullable().optional(),
});

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const newsSourceCreateSchema = z
  .object({
    kind: z.enum(USER_SOURCE_KINDS),
    name: z.string().trim().min(1).max(120),
    url: httpUrl.nullable().optional(),
    feed: z.enum(INTELLIGENCE_FEEDS),
    repo: z.string().trim().regex(repoPattern, "Use the owner/repository format").optional(),
    query: z.string().trim().min(1).max(300).optional(),
    fetch_interval_minutes: z.number().int().min(15).max(10_080).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "rss" && !v.url) ctx.addIssue({ code: "custom", path: ["url"], message: "RSS sources need a feed URL" });
    if (v.kind === "github_releases" && !v.repo)
      ctx.addIssue({ code: "custom", path: ["repo"], message: "GitHub release sources need an owner/repository" });
    if (v.kind === "arxiv" && !v.query)
      ctx.addIssue({ code: "custom", path: ["query"], message: "arXiv sources need a search query" });
  });
export type NewsSourceCreateInput = z.infer<typeof newsSourceCreateSchema>;

export const newsSourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  fetch_interval_minutes: z.number().int().min(15).max(10_080).optional(),
});

export const watchlistCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  color: z.enum(COLORS).nullable().optional(),
  notify: z.boolean().optional(),
});
export const watchlistUpdateSchema = watchlistCreateSchema.partial();

export const watchlistItemCreateSchema = z
  .object({
    kind: z.enum(WATCH_KINDS),
    value: z.string().trim().min(2).max(200),
    match_terms: z.array(z.string().trim().min(2).max(100)).max(10).optional(),
  })
  .refine((v) => v.kind !== "repository" || repoPattern.test(v.value), {
    message: "Repositories must use the owner/repository format",
    path: ["value"],
  });
export const watchlistItemUpdateSchema = z.object({
  match_terms: z.array(z.string().trim().min(2).max(100)).max(10),
});
