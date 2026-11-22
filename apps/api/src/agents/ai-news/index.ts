import { z } from "zod";
import { CATEGORY_SLUGS, type IntelligenceFeed } from "@hub/shared";
import { documentBlock, GROUNDING_RULES } from "../../ai/prompts";
import { resolveSystemAI, tryResolveAI, type AIService } from "../../ai/service";
import { enqueueJob } from "../../jobs/queue";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { errorMessage } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { adminDb } from "../../lib/supabase";
import { groundedTechnologies } from "../research/text";

const BATCH_SIZE = 12;
const MAX_ATTEMPTS = 3;

/** Feed-specific framing for the summariser. */
const FEED_FOCUS: Record<IntelligenceFeed, string> = {
  ai_news: "Summarise the announcement or article: who did what, and what is new.",
  models: "Describe what this model is, its task/modality and notable properties stated in the model card.",
  products: "Describe what the product does and who it is for.",
  developer:
    "Explain what changed in this release or update: new features, breaking changes, deprecations and upgrade notes. Write for a developer deciding whether to upgrade.",
  github_trending: "Describe what this repository does and the problem it solves.",
  research: "Explain the paper's main contribution and result in plain language.",
};

const summarySchema = z.object({
  summary: z.string().describe("1-2 sentence factual summary written in your own words, based only on the source"),
  why_it_matters: z
    .string()
    .describe("One sentence on why this matters to a developer following AI. Use 'Not enough information in the source.' if unclear."),
  category: z.enum(CATEGORY_SLUGS).describe("The single best-fitting category"),
  technologies: z.array(z.string()).max(8).describe("Models, frameworks, tools or companies explicitly named in the source"),
  importance: z.number().int().min(1).max(5).describe("1 = minor/niche, 3 = notable, 5 = major industry-level development"),
});

interface PendingItem {
  id: string;
  feed: IntelligenceFeed;
  title: string;
  source_name: string;
  published_at: string | null;
  source_excerpt: string | null;
  importance_score: number;
  technologies: string[];
  ai_attempts: number;
  owner_user_id: string | null;
}

async function summarise(ai: AIService, item: PendingItem, categoryIds: Map<string, string>) {
  const { object, model } = await ai.generateObject(
    summarySchema,
    [
      {
        role: "system",
        content: `You are the AI News Agent in a personal AI intelligence hub. ${FEED_FOCUS[item.feed]}
Keep the summary faithful to the source: preserve its meaning, do not speculate, and never add numbers, dates, versions, benchmarks or claims that the source does not contain.
${GROUNDING_RULES}`,
      },
      {
        role: "user",
        content: documentBlock({ title: item.title, source: item.source_name, published: item.published_at ?? "unknown" }, item.source_excerpt ?? "", 6000),
      },
    ],
    { maxTokens: 600 },
  );

  const sourceText = `${item.title}\n${item.source_excerpt ?? ""}`;
  const technologies = [...new Set([...item.technologies, ...groundedTechnologies(object.technologies, sourceText)])].slice(0, 10);
  const importance = Math.max(0, Math.min(100, Math.round(item.importance_score * 0.5 + object.importance * 10)));

  await adminDb
    .from("intelligence_items")
    .update({
      ai_summary: object.summary.trim().slice(0, 1200),
      ai_why_it_matters: object.why_it_matters.trim().slice(0, 600),
      category_id: categoryIds.get(object.category) ?? null,
      technologies,
      importance_score: importance,
      ai_status: "done",
      ai_model: model,
      ai_processed_at: new Date().toISOString(),
      ai_error: null,
    })
    .eq("id", item.id);
}

/** AI News Agent: categorises and summarises pending items with local AI. */
export async function processPendingItems(log: Logger, signal: AbortSignal) {
  const { data, error } = await adminDb
    .from("intelligence_items")
    .select("id, feed, title, source_name, published_at, source_excerpt, importance_score, technologies, ai_attempts, owner_user_id")
    .eq("ai_status", "pending")
    .is("duplicate_of", null)
    .lt("ai_attempts", MAX_ATTEMPTS)
    .order("importance_score", { ascending: false })
    .order("fetched_at", { ascending: false })
    .limit(BATCH_SIZE);
  if (error) throw error;
  const items = (data ?? []) as PendingItem[];
  if (items.length === 0) return { processed: 0, remaining: 0 };

  const { data: cats } = await adminDb.from("intelligence_categories").select("id, slug");
  const categoryIds = new Map((cats ?? []).map((c) => [c.slug as string, c.id as string]));

  // Public items use any available local AI; private items only their owner's AI.
  const systemAI = await resolveSystemAI();
  const ownerAI = new Map<string, AIService | null>();
  let processed = 0;
  let failed = 0;
  let waiting = 0;

  for (const item of items) {
    if (signal.aborted) break;
    let ai: AIService | null = systemAI;
    if (item.owner_user_id) {
      if (!ownerAI.has(item.owner_user_id)) ownerAI.set(item.owner_user_id, await tryResolveAI(item.owner_user_id));
      ai = ownerAI.get(item.owner_user_id) ?? null;
    }
    if (!ai) {
      waiting++;
      continue;
    }

    await adminDb.from("intelligence_items").update({ ai_status: "processing", ai_attempts: item.ai_attempts + 1 }).eq("id", item.id);
    try {
      await summarise(ai, item, categoryIds);
      processed++;
    } catch (err) {
      failed++;
      const exhausted = item.ai_attempts + 1 >= MAX_ATTEMPTS;
      await adminDb
        .from("intelligence_items")
        .update({ ai_status: exhausted ? "failed" : "pending", ai_error: errorMessage(err).slice(0, 500) })
        .eq("id", item.id);
      log.warn({ itemId: item.id, err: errorMessage(err) }, "summarisation failed");
    }
  }
  return { processed, failed, waiting_for_ai: waiting };
}

export function registerAINewsAgent() {
  registerJobHandler(
    "ai_news.process_pending",
    async ({ log, signal }) => {
      const result = await processPendingItems(log, signal);
      // Keep draining the backlog while AI is available.
      if (result.processed > 0 && result.processed >= BATCH_SIZE - 2) {
        await enqueueJob({ agent: "ai_news", kind: "ai_news.process_pending", dedupeKey: "ai_news.process_pending:next", priority: 7, runAt: new Date(Date.now() + 5_000) });
      }
      return result;
    },
    { timeoutMs: 20 * 60_000 },
  );

  registerSchedule({
    name: "ai_news.process-pending",
    pattern: "*/5 * * * *",
    run: async () => {
      await enqueueJob({ agent: "ai_news", kind: "ai_news.process_pending", dedupeKey: "ai_news.process_pending", priority: 7, maxAttempts: 2 });
    },
  });
}

const explainSchema = z.object({ explanation: z.string().describe("Markdown explanation, 120-250 words") });

/** On-demand deeper explanation of an item (e.g. technical changes in a release). */
export async function explainItem(ai: AIService, item: { feed: IntelligenceFeed; title: string; source_name: string; source_excerpt: string | null; url: string }) {
  const focus =
    item.feed === "developer"
      ? "Explain the technical changes in detail: what changed, why it matters, migration or upgrade considerations, and who is affected."
      : item.feed === "research"
        ? "Explain the research for a software engineer: the problem, the approach, the key result, and practical implications."
        : "Explain this in more depth for a software engineer interested in AI: context, what is new, and practical implications.";
  const { object, model } = await ai.generateObject(explainSchema, [
    {
      role: "system",
      content: `You explain AI and developer news inside a personal intelligence hub. ${focus}
Use short markdown sections or bullet points. Clearly say when the source does not contain enough detail.
${GROUNDING_RULES}`,
    },
    { role: "user", content: documentBlock({ title: item.title, source: item.source_name, url: item.url }, item.source_excerpt ?? "(no source text available)", 8000) },
  ]);
  return { explanation: object.explanation, model };
}
