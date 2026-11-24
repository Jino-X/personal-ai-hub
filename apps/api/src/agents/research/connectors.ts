import * as cheerio from "cheerio";
import Parser from "rss-parser";
import type { NewsSource, SourceKind } from "@hub/shared";
import { config } from "../../config";
import { ExternalServiceError } from "../../lib/errors";
import { fetchWithRetry, safeFetchText, USER_AGENT } from "../../lib/http";
import { clip, stripHtml, validIso } from "./text";
import { SourceNotConfiguredError, type Connector, type RawItem } from "./types";

const rss = new Parser({ timeout: 20_000, customFields: { item: [["dc:creator", "dcCreator"]] } });

function githubHeaders(): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(config.sources.githubToken ? { authorization: `Bearer ${config.sources.githubToken}` } : {}),
  };
}

/**
 * An author as text. Feeds disagree on the shape: rss-parser hands back a string, a list of names (several
 * `dc:creator` tags), or an object such as `{ name }` or `{ _: "name" }` for Atom authors and attributed tags.
 */
function authorText(value: unknown): string | null {
  if (typeof value === "string") return value.trim().slice(0, 200) || null;
  if (Array.isArray(value)) {
    const names = value.map(authorText).filter((n): n is string => !!n);
    return names.length ? names.join(", ").slice(0, 200) : null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return authorText(obj.name ?? obj._ ?? obj["#text"] ?? null);
  }
  return null;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

// ── RSS / Atom ──────────────────────────────────────────────────────────────

const rssConnector: Connector = async (source) => {
  if (!source.url) throw new ExternalServiceError("rss", "source has no URL");
  // Feeds may be user-supplied URLs, so always use the SSRF-safe fetcher.
  const res = await safeFetchText(source.url, { accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5" });
  const feed = await rss.parseString(res.body);
  return (feed.items ?? []).slice(0, 40).flatMap((item): RawItem[] => {
    const link = item.link ?? (item.guid?.startsWith("http") ? item.guid : undefined);
    if (!link || !item.title) return [];
    const text = item.contentSnippet || stripHtml(item.content ?? item.summary ?? "");
    return [
      {
        externalId: item.guid ?? null,
        url: new URL(link, source.url!).toString(),
        title: stripHtml(item.title).slice(0, 500),
        author: authorText(item.creator ?? (item as { dcCreator?: unknown }).dcCreator),
        publishedAt: validIso(item.isoDate ?? item.pubDate),
        excerpt: clip(text, 3000),
        metadata: { categories: (item.categories ?? []).slice(0, 8) },
      },
    ];
  });
};

// ── arXiv (Atom API) ────────────────────────────────────────────────────────

const arxivConnector: Connector = async (source) => {
  const query = String(source.config.query ?? "cat:cs.AI");
  const max = Math.min(Number(source.config.max_results ?? 40), 100);
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=${max}`;
  const res = await fetchWithRetry(url, { service: "arxiv", timeoutMs: 30_000 });
  const feed = await rss.parseString(await res.text());
  return (feed.items ?? []).flatMap((item): RawItem[] => {
    const id = (item as { id?: string }).id ?? item.guid ?? item.link ?? "";
    const arxivId = /abs\/([^v\s]+)/.exec(id)?.[1];
    if (!arxivId || !item.title) return [];
    return [
      {
        externalId: `arxiv:${arxivId}`,
        url: `https://arxiv.org/abs/${arxivId}`,
        title: stripHtml(item.title).replace(/\s+/g, " "),
        author: authorText(item.creator ?? (item as { author?: unknown }).author),
        publishedAt: validIso(item.isoDate ?? item.pubDate),
        excerpt: clip(stripHtml(item.summary ?? item.content ?? item.contentSnippet ?? ""), 3000),
        metadata: { arxiv_id: arxivId, popularity: 0 },
        categoryHint: "ai-research",
      },
    ];
  });
};

// ── Hugging Face ────────────────────────────────────────────────────────────

function hfHeaders(): Record<string, string> {
  return config.sources.hfToken ? { authorization: `Bearer ${config.sources.hfToken}` } : {};
}

interface HFModel {
  id: string;
  likes?: number;
  downloads?: number;
  trendingScore?: number;
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
  createdAt?: string;
}

const hfModelsConnector: Connector = async (source) => {
  const limit = Math.min(Number(source.config.limit ?? 30), 100);
  const res = await fetchWithRetry(`https://huggingface.co/api/models?sort=trendingScore&limit=${limit}`, { service: "huggingface", headers: hfHeaders() });
  const models = (await res.json()) as HFModel[];
  return models.map((m) => {
    const license = m.tags?.find((t) => t.startsWith("license:"))?.slice(8);
    const facts = [
      m.pipeline_tag && `Task: ${m.pipeline_tag}`,
      m.library_name && `Library: ${m.library_name}`,
      license && `License: ${license}`,
      m.tags?.length && `Tags: ${m.tags.filter((t) => !t.includes(":")).slice(0, 10).join(", ")}`,
    ].filter(Boolean);
    return {
      externalId: `hf:${m.id}`,
      url: `https://huggingface.co/${m.id}`,
      title: m.id,
      author: m.id.split("/")[0] ?? null,
      publishedAt: validIso(m.createdAt),
      excerpt: facts.join(" · ") || null,
      metadata: {
        model_id: m.id,
        likes: m.likes,
        downloads: m.downloads,
        trending_score: m.trendingScore,
        pipeline_tag: m.pipeline_tag,
        library: m.library_name,
        license,
        popularity: m.trendingScore ?? 0,
      },
      categoryHint: m.pipeline_tag?.includes("image") || m.pipeline_tag?.includes("video") ? "image-video" : m.pipeline_tag?.includes("speech") || m.pipeline_tag?.includes("audio") ? "speech-audio" : "open-source-ai",
      refreshable: true,
    } satisfies RawItem;
  });
};

/** Fetches the beginning of a model card (README) to give the summariser real content. */
export async function fetchModelCard(modelId: string): Promise<string | null> {
  try {
    const res = await fetchWithRetry(`https://huggingface.co/${modelId}/raw/main/README.md`, { service: "huggingface", headers: hfHeaders(), retries: 0, timeoutMs: 10_000 });
    const text = (await res.text()).replace(/^---[\s\S]*?---\s*/, "");
    return clip(text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<[^>]+>/g, " "), 3500);
  } catch {
    return null;
  }
}

interface HFDailyPaper {
  paper: { id: string; title: string; summary?: string; publishedAt?: string; upvotes?: number; authors?: { name: string }[]; githubRepo?: string; githubStars?: number };
  numComments?: number;
}

const hfPapersConnector: Connector = async () => {
  const res = await fetchWithRetry("https://huggingface.co/api/daily_papers?limit=50", { service: "huggingface", headers: hfHeaders() });
  const papers = (await res.json()) as HFDailyPaper[];
  return papers
    .filter((p) => p.paper?.id && p.paper.title)
    .map((p) => ({
      externalId: `arxiv:${p.paper.id}`,
      url: `https://huggingface.co/papers/${p.paper.id}`,
      title: p.paper.title.replace(/\s+/g, " ").trim(),
      author: p.paper.authors?.slice(0, 3).map((a) => a.name).join(", ") || null,
      publishedAt: validIso(p.paper.publishedAt),
      excerpt: clip(p.paper.summary ?? null, 3000),
      metadata: {
        arxiv_id: p.paper.id,
        arxiv_url: `https://arxiv.org/abs/${p.paper.id}`,
        upvotes: p.paper.upvotes,
        comments: p.numComments,
        authors: p.paper.authors?.slice(0, 8).map((a) => a.name),
        github_repo: p.paper.githubRepo,
        github_stars: p.paper.githubStars,
        popularity: p.paper.upvotes ?? 0,
      },
      categoryHint: "ai-research" as const,
      refreshable: true,
    }));
};

// ── GitHub ──────────────────────────────────────────────────────────────────

/** github.com/trending has no official API; the page markup is parsed defensively. */
const githubTrendingConnector: Connector = async (source) => {
  const since = String(source.config.since ?? "daily");
  const language = source.config.language ? `/${encodeURIComponent(String(source.config.language))}` : "";
  const res = await fetchWithRetry(`https://github.com/trending${language}?since=${encodeURIComponent(since)}`, {
    service: "github-trending",
    headers: { accept: "text/html", "user-agent": USER_AGENT },
  });
  const $ = cheerio.load(await res.text());
  const items: RawItem[] = [];
  $("article.Box-row").each((_, el) => {
    const row = $(el);
    const href = row.find("h2 a").attr("href")?.trim();
    const repo = href?.replace(/^\//, "");
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return;
    const description = row.find("p").first().text().trim();
    const starsToday = num(row.find("span.float-sm-right").text());
    items.push({
      externalId: `gh:${repo.toLowerCase()}`,
      url: `https://github.com/${repo}`,
      title: repo,
      author: repo.split("/")[0] ?? null,
      publishedAt: null, // trending lists have no publication date
      excerpt: description || null,
      metadata: {
        repo,
        language: row.find('[itemprop="programmingLanguage"]').text().trim() || null,
        stars: num(row.find('a[href$="/stargazers"]').text()),
        forks: num(row.find('a[href$="/forks"]').text()),
        stars_today: starsToday,
        trending_since: since,
        popularity: starsToday ?? 0,
      },
      refreshable: true,
    });
  });
  if (items.length === 0) throw new ExternalServiceError("github-trending", "no repositories parsed (page layout may have changed)");
  return items;
};

/** Fetches a repository README (first part) via the GitHub API. Requires GITHUB_TOKEN to avoid rate limits. */
export async function fetchRepoReadme(repo: string): Promise<string | null> {
  if (!config.sources.githubToken) return null;
  try {
    const res = await fetchWithRetry(`https://api.github.com/repos/${repo}/readme`, {
      service: "github",
      headers: { ...githubHeaders(), accept: "application/vnd.github.raw+json" },
      retries: 0,
      timeoutMs: 10_000,
    });
    return clip(stripHtml((await res.text()).replace(/!\[[^\]]*\]\([^)]*\)/g, "")), 3500);
  } catch {
    return null;
  }
}

interface GitHubRelease {
  html_url: string;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  author?: { login: string };
}

export async function fetchReleases(repo: string, opts: { max?: number; skipPrereleases?: boolean } = {}): Promise<RawItem[]> {
  const res = await fetchWithRetry(`https://api.github.com/repos/${repo}/releases?per_page=10`, { service: "github", headers: githubHeaders() });
  const releases = (await res.json()) as GitHubRelease[];
  return releases
    .filter((r) => !r.draft && !(opts.skipPrereleases && r.prerelease))
    .slice(0, opts.max ?? 3)
    .map((r) => ({
      externalId: `gh-release:${repo.toLowerCase()}:${r.tag_name}`,
      url: r.html_url,
      title: `${repo} ${r.name && r.name !== r.tag_name ? `${r.tag_name} — ${r.name}` : r.tag_name}`,
      author: r.author?.login ?? null,
      publishedAt: validIso(r.published_at),
      excerpt: clip(r.body?.replace(/<!--[\s\S]*?-->/g, "") ?? null, 4000),
      metadata: { repo, tag: r.tag_name, prerelease: r.prerelease, popularity: 0 },
    }));
}

const githubReleasesConnector: Connector = async (source) => {
  const repo = String(source.config.repo ?? "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ExternalServiceError("github", "invalid repository", 400, false);
  return fetchReleases(repo, { max: Number(source.config.max_per_fetch ?? 3), skipPrereleases: Boolean(source.config.skip_prereleases) });
};

// ── Product Hunt (GraphQL API v2) ───────────────────────────────────────────

const productHuntConnector: Connector = async (source) => {
  if (!config.sources.productHuntToken) throw new SourceNotConfiguredError("Set PRODUCT_HUNT_TOKEN on the API to enable Product Hunt.");
  const topic = String(source.config.topic ?? "artificial-intelligence");
  const first = Math.min(Number(source.config.limit ?? 20), 50);
  const query = `query($topic:String!,$first:Int!){posts(first:$first,topic:$topic,order:NEWEST){edges{node{id name tagline description url website votesCount commentsCount createdAt}}}}`;
  const res = await fetchWithRetry("https://api.producthunt.com/v2/api/graphql", {
    service: "producthunt",
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.sources.productHuntToken}` },
    body: JSON.stringify({ query, variables: { topic, first } }),
  });
  const json = (await res.json()) as {
    data?: { posts?: { edges?: { node: { id: string; name: string; tagline: string; description?: string; url: string; website?: string; votesCount?: number; commentsCount?: number; createdAt?: string } }[] } };
    errors?: { message: string }[];
  };
  if (json.errors?.length) throw new ExternalServiceError("producthunt", json.errors[0]!.message);
  return (json.data?.posts?.edges ?? []).map(({ node }) => ({
    externalId: `ph:${node.id}`,
    url: node.url,
    title: `${node.name} — ${node.tagline}`,
    publishedAt: validIso(node.createdAt),
    excerpt: clip([node.tagline, node.description].filter(Boolean).join("\n"), 2000),
    metadata: { votes: node.votesCount, comments: node.commentsCount, website: node.website, popularity: node.votesCount ?? 0 },
    categoryHint: "ai-startups" as const,
    refreshable: true,
  }));
};

export const CONNECTORS: Record<SourceKind, Connector> = {
  rss: rssConnector,
  arxiv: arxivConnector,
  huggingface_models: hfModelsConnector,
  huggingface_papers: hfPapersConnector,
  github_trending: githubTrendingConnector,
  github_releases: githubReleasesConnector,
  product_hunt: productHuntConnector,
};

/** Log-scale factor applied to each feed's popularity metric for importance. */
export const POPULARITY_SCALE: Record<string, number> = {
  github_trending: 9,
  models: 8,
  research: 12,
  products: 9,
  ai_news: 0,
  developer: 0,
};

export type { NewsSource };
