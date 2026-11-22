import { CATEGORY_SLUGS, TECH_TOPICS, type CategorySlug } from "@hub/shared";

const TRACKING_PARAMS = /^(utm_|ref$|ref_src$|source$|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|si$|cmpid$|ocid$)/i;

/** Canonical form of a URL for deduplication. */
export function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (["github.com", "huggingface.co", "arxiv.org"].includes(url.hostname)) url.protocol = "https:";
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    if (url.hostname === "arxiv.org") url.pathname = url.pathname.replace(/^\/(abs|pdf)\/([^/]+?)(v\d+)?(\.pdf)?$/, "/abs/$2");
    let out = url.toString();
    if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return raw.trim();
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Strips HTML tags/entities and collapses whitespace. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1)) || 32) : m))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t || null;
}

export function validIso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Reject obviously wrong dates (far future) rather than storing them.
  if (d.getTime() > Date.now() + 2 * 86_400_000) return null;
  return d.toISOString();
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word match; keywords ending in "-" (e.g. "phi-") or "fine-tun" match as prefixes. */
function containsTerm(haystack: string, term: string) {
  const t = term.toLowerCase();
  const prefix = t.endsWith("-") || t === "fine-tun";
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(t)}${prefix ? "" : "($|[^a-z0-9])"}`, "i").test(haystack);
}

/** Tie-break order: more specific categories win over broad ones. */
const SPECIFICITY = ["mcp", "speech-audio", "image-video", "ai-agents", "open-source-ai", "ai-research", "llm", "ai-dev-tools", "ai-startups"];

/** Rule-based category from keyword hits; falls back to the source's default category. */
export function categorize(
  text: string,
  categories: { slug: string; keywords: string[] }[],
  fallback: CategorySlug | null,
): CategorySlug | null {
  const lower = text.toLowerCase();
  let best: { slug: string; score: number } | null = null;
  for (const c of categories) {
    let score = 0;
    for (const k of c.keywords) if (containsTerm(lower, k)) score += k.includes(" ") ? 2 : 1;
    const better =
      !best || score > best.score || (score === best.score && SPECIFICITY.indexOf(c.slug) < SPECIFICITY.indexOf(best.slug));
    if (score > 0 && better) best = { slug: c.slug, score };
  }
  const slug = best && best.score >= 2 ? best.slug : (fallback ?? best?.slug ?? null);
  return slug && (CATEGORY_SLUGS as readonly string[]).includes(slug) ? (slug as CategorySlug) : null;
}

/** Developer tech-topic slugs mentioned in the text. */
export function detectTopics(text: string): string[] {
  const lower = text.toLowerCase();
  return TECH_TOPICS.filter((t) => t.keywords.some((k) => containsTerm(lower, k))).map((t) => t.slug);
}

/** Technology names explicitly mentioned in the text (used before/without AI extraction). */
export function detectTechnologies(text: string): string[] {
  const lower = text.toLowerCase();
  return TECH_TOPICS.filter((t) => t.keywords.some((k) => containsTerm(lower, k))).map((t) => t.name);
}

/** Keeps only technologies that literally appear in the source text (guards against AI fabrication). */
export function groundedTechnologies(candidates: string[], sourceText: string): string[] {
  const lower = sourceText.toLowerCase();
  const out = new Set<string>();
  for (const c of candidates) {
    const name = c.trim();
    if (name.length >= 2 && name.length <= 60 && lower.includes(name.toLowerCase())) out.add(name);
  }
  return [...out].slice(0, 8);
}

/**
 * Non-personal importance (0-100) at ingestion time: source weight plus a log-scaled
 * popularity signal reported by the source.
 */
export function baseImportance(weight: number, popularity: number | undefined, scale: number): number {
  const pop = popularity && popularity > 0 ? Math.min(30, scale * Math.log10(1 + popularity)) : 0;
  return Math.max(0, Math.min(100, Math.round(42 * weight + pop)));
}
