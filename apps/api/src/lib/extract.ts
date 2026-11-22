import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { safeFetchText } from "./http";

export interface ExtractedPage {
  url: string;
  title: string | null;
  byline: string | null;
  siteName: string | null;
  publishedAt: string | null;
  excerpt: string | null;
  text: string;
}

function meta(document: Document, ...names: string[]): string | null {
  for (const name of names) {
    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    const content = el?.getAttribute("content")?.trim();
    if (content) return content;
  }
  return null;
}

/** Readable text from an HTML document (Mozilla Readability over a lightweight DOM). */
export function extractFromHtml(html: string, url: string): ExtractedPage {
  const { document } = parseHTML(html);
  const published = meta(document, "article:published_time", "og:published_time", "datePublished", "date");
  const fallbackTitle = meta(document, "og:title", "twitter:title") ?? document.querySelector("title")?.textContent?.trim() ?? null;
  const description = meta(document, "og:description", "description", "twitter:description");

  let article: ReturnType<Readability["parse"]> = null;
  try {
    article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
  } catch {
    article = null;
  }
  const text = (article?.textContent ?? document.body?.textContent ?? "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();

  const publishedDate = published ? new Date(published) : null;
  return {
    url,
    title: article?.title?.trim() || fallbackTitle,
    byline: article?.byline?.trim() || null,
    siteName: article?.siteName?.trim() || meta(document, "og:site_name"),
    publishedAt: publishedDate && !Number.isNaN(publishedDate.getTime()) ? publishedDate.toISOString() : null,
    excerpt: article?.excerpt?.trim() || description,
    text,
  };
}

/** Fetches (SSRF-safe) and extracts a web page. */
export async function fetchAndExtract(url: string): Promise<ExtractedPage> {
  const res = await safeFetchText(url);
  if (!/html|xml/i.test(res.contentType) && res.contentType) {
    return { url: res.url, title: null, byline: null, siteName: null, publishedAt: null, excerpt: null, text: res.body.slice(0, 200_000) };
  }
  return extractFromHtml(res.body, res.url);
}
