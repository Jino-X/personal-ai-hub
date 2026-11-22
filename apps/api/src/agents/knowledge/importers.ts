import type { KnowledgeDocType } from "@hub/shared";
import { config } from "../../config";
import { ExternalServiceError } from "../../lib/errors";
import { fetchAndExtract } from "../../lib/extract";
import { fetchWithRetry } from "../../lib/http";
import { stripHtml } from "../research/text";
import Parser from "rss-parser";

export interface ImportedDocument {
  type: KnowledgeDocType;
  title: string;
  url: string;
  content: string;
  excerpt: string | null;
  metadata: Record<string, unknown>;
}

const MAX_CONTENT = 400_000;

async function importGitHubRepo(repo: string, url: string): Promise<ImportedDocument> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    ...(config.sources.githubToken ? { authorization: `Bearer ${config.sources.githubToken}` } : {}),
  };
  const res = await fetchWithRetry(`https://api.github.com/repos/${repo}`, { service: "github", headers, retries: 1 });
  const info = (await res.json()) as { full_name: string; description: string | null; stargazers_count: number; language: string | null; topics?: string[]; homepage?: string | null; license?: { spdx_id?: string } | null };
  let readme = "";
  try {
    const r = await fetchWithRetry(`https://api.github.com/repos/${repo}/readme`, { service: "github", headers: { ...headers, accept: "application/vnd.github.raw+json" }, retries: 0 });
    readme = (await r.text()).slice(0, MAX_CONTENT);
  } catch {
    /* repository without README */
  }
  return {
    type: "repository",
    title: info.full_name,
    url,
    content: [info.description, readme].filter(Boolean).join("\n\n"),
    excerpt: info.description,
    metadata: {
      repo: info.full_name,
      stars: info.stargazers_count,
      language: info.language,
      topics: info.topics ?? [],
      homepage: info.homepage ?? null,
      license: info.license?.spdx_id ?? null,
      metrics_fetched_at: new Date().toISOString(),
    },
  };
}

const atom = new Parser();

async function importArxiv(arxivId: string, url: string): Promise<ImportedDocument> {
  const res = await fetchWithRetry(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`, { service: "arxiv" });
  const feed = await atom.parseString(await res.text());
  const entry = feed.items?.[0];
  if (!entry?.title) throw new ExternalServiceError("arxiv", "paper not found", 404, false);
  const abstract = stripHtml(entry.summary ?? entry.content ?? "");
  const authors = entry.creator ?? (entry as { author?: string }).author ?? null;
  return {
    type: "paper",
    title: entry.title.replace(/\s+/g, " ").trim(),
    url,
    content: [`Authors: ${authors ?? "unknown"}`, `arXiv: ${arxivId}`, "", abstract].join("\n"),
    excerpt: abstract.slice(0, 500),
    metadata: { arxiv_id: arxivId, authors, published_at: entry.isoDate ?? null, pdf_url: `https://arxiv.org/pdf/${arxivId}` },
  };
}

/** Fetches and normalises a URL into a knowledge document, with smart handling for repos and papers. */
export async function importUrl(rawUrl: string, typeOverride?: KnowledgeDocType): Promise<ImportedDocument> {
  const url = new URL(rawUrl);
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "github.com" && parts.length >= 2 && !["orgs", "topics", "trending", "sponsors"].includes(parts[0]!)) {
    const repo = `${parts[0]}/${parts[1]!.replace(/\.git$/, "")}`;
    return importGitHubRepo(repo, `https://github.com/${repo}`);
  }
  const arxivId =
    host === "arxiv.org" && (parts[0] === "abs" || parts[0] === "pdf")
      ? parts[1]?.replace(/\.pdf$/, "").replace(/v\d+$/, "")
      : host === "huggingface.co" && parts[0] === "papers"
        ? parts[1]
        : undefined;
  if (arxivId && /^\d{4}\.\d{4,5}$/.test(arxivId)) return importArxiv(arxivId, `https://arxiv.org/abs/${arxivId}`);

  const page = await fetchAndExtract(rawUrl);
  if (!page.text || page.text.length < 50) throw new ExternalServiceError("import", "No readable content was found at this URL", 422, false);
  return {
    type: typeOverride ?? "article",
    title: (page.title ?? url.hostname).slice(0, 300),
    url: page.url,
    content: page.text.slice(0, MAX_CONTENT),
    excerpt: page.excerpt?.slice(0, 500) ?? null,
    metadata: { site_name: page.siteName, byline: page.byline, published_at: page.publishedAt },
  };
}
