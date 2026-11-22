import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CATEGORY_SLUGS, type Citation, type KnowledgeAnswer, type KnowledgeMatch } from "@hub/shared";
import { toPgVector } from "../../ai/embeddings";
import { documentBlock, GROUNDING_RULES } from "../../ai/prompts";
import { resolveAI, tryResolveAI, type AIService } from "../../ai/service";
import { enqueueJob } from "../../jobs/queue";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { AIUnavailableError, errorMessage, ExternalServiceError } from "../../lib/errors";
import { adminDb } from "../../lib/supabase";
import { chunkText, estimateTokens } from "./chunk";

const MAX_INDEX_ATTEMPTS = 3;

const enrichSchema = z.object({
  summary: z.string().describe("2-3 sentence summary of the document"),
  category: z.enum(CATEGORY_SLUGS).nullable().describe("Best-fitting category, or null if none fits"),
  tags: z.array(z.string()).max(6).describe("Short lowercase topic tags present in the document"),
});

export async function enqueueIndex(documentId: string, userId: string, priority = 5) {
  await enqueueJob({
    agent: "knowledge",
    kind: "knowledge.index_document",
    payload: { document_id: documentId },
    userId,
    dedupeKey: `index:${documentId}`,
    priority,
    maxAttempts: MAX_INDEX_ATTEMPTS,
  });
}

/**
 * Knowledge Agent — indexing: chunk → embed (local embedding model) → store in pgvector,
 * plus an AI summary, automatic category and suggested tags.
 */
async function indexDocument(documentId: string, userId: string, signal: AbortSignal) {
  const { data: doc, error } = await adminDb
    .from("knowledge_documents")
    .select("id, user_id, title, content, type, metadata")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!doc) return { skipped: "document deleted" };

  const content = String(doc.content ?? "").trim();
  if (!content) {
    await adminDb.from("knowledge_documents").update({ index_status: "indexed", chunk_count: 0, indexed_at: new Date().toISOString() }).eq("id", documentId);
    return { chunks: 0 };
  }

  const ai = await resolveAI(userId, { requireEmbeddings: true }); // throws AIUnavailableError → job deferred
  await adminDb.from("knowledge_documents").update({ index_status: "processing", index_error: null }).eq("id", documentId);

  const chunks = chunkText(content);
  const vectors = await ai.embedDocuments(
    chunks.map((c) => `${doc.title}\n\n${c}`),
    signal,
  );

  await adminDb.from("knowledge_chunks").delete().eq("document_id", documentId);
  for (let i = 0; i < chunks.length; i += 50) {
    const rows = chunks.slice(i, i + 50).map((text, j) => ({
      document_id: documentId,
      user_id: userId,
      chunk_index: i + j,
      content: text,
      token_estimate: estimateTokens(text),
      embedding: toPgVector(vectors[i + j]!),
      embedding_model: ai.embeddingModel,
    }));
    const { error: insertError } = await adminDb.from("knowledge_chunks").insert(rows);
    if (insertError) throw insertError;
  }

  // Summary + automatic categorisation (best effort — needs the chat model).
  const patch: Record<string, unknown> = {
    index_status: "indexed",
    index_error: null,
    indexed_at: new Date().toISOString(),
    embedding_model: ai.embeddingModel,
    chunk_count: chunks.length,
  };
  const chatAI = await tryResolveAI(userId);
  if (chatAI && doc.type !== "ai_summary") {
    try {
      const { object, model } = await chatAI.generateObject(enrichSchema, [
        { role: "system", content: `You organise a personal knowledge base. Summarise the document and suggest a category and tags.\n${GROUNDING_RULES}` },
        { role: "user", content: documentBlock({ title: doc.title, type: doc.type }, content, 6000) },
      ]);
      patch.ai_summary = object.summary.slice(0, 1500);
      patch.auto_category = object.category;
      patch.metadata = {
        ...(doc.metadata as Record<string, unknown>),
        suggested_tags: [...new Set(object.tags.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 2 && t.length <= 40))],
        summary_model: model,
      };
    } catch (err) {
      patch.metadata = { ...(doc.metadata as Record<string, unknown>), enrich_error: errorMessage(err).slice(0, 300) };
    }
  }
  await adminDb.from("knowledge_documents").update(patch).eq("id", documentId);
  return { chunks: chunks.length };
}

export function registerKnowledgeAgent() {
  registerJobHandler(
    "knowledge.index_document",
    async ({ job, signal }) => {
      const documentId = String(job.payload.document_id);
      try {
        return await indexDocument(documentId, job.user_id!, signal);
      } catch (err) {
        if (err instanceof AIUnavailableError) {
          await adminDb.from("knowledge_documents").update({ index_status: "pending" }).eq("id", documentId);
          throw err;
        }
        const final = job.attempts >= job.max_attempts || (err instanceof ExternalServiceError && !err.retryable);
        await adminDb
          .from("knowledge_documents")
          .update({ index_status: final ? "failed" : "pending", index_error: errorMessage(err).slice(0, 500) })
          .eq("id", documentId);
        throw err;
      }
    },
    { timeoutMs: 15 * 60_000 },
  );

  registerJobHandler("knowledge.reindex_all", async ({ job }) => {
    const userId = job.user_id!;
    const { data } = await adminDb.from("knowledge_documents").update({ index_status: "pending" }).eq("user_id", userId).select("id");
    for (const d of data ?? []) await enqueueIndex(d.id as string, userId, 8);
    return { queued: data?.length ?? 0 };
  });

  // Safety net: pick up documents that are still pending (e.g. created while AI was offline).
  registerSchedule({
    name: "knowledge.index-pending",
    pattern: "*/10 * * * *",
    run: async () => {
      const { data } = await adminDb
        .from("knowledge_documents")
        .select("id, user_id")
        .eq("index_status", "pending")
        .lt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString())
        .limit(50);
      for (const d of data ?? []) await enqueueIndex(d.id as string, d.user_id as string, 8);
    },
  });
}

// ── Retrieval & question answering ──────────────────────────────────────────

export interface RetrievalResult {
  matches: KnowledgeMatch[];
  mode: "hybrid" | "fulltext" | "semantic";
}

/**
 * Hybrid retrieval over the user's own chunks (RLS client). Falls back to full-text
 * search when the embedding model is unavailable.
 */
export async function retrieveKnowledge(
  db: SupabaseClient,
  ai: AIService | null,
  query: string,
  opts: { limit?: number; folderId?: string | null; mode?: "hybrid" | "fulltext" | "semantic" } = {},
): Promise<RetrievalResult> {
  const wanted = opts.mode ?? "hybrid";
  let embedding: number[] | null = null;
  if (wanted !== "fulltext" && ai) {
    try {
      embedding = await ai.embedQuery(query);
    } catch {
      embedding = null;
    }
  }
  const mode = embedding ? wanted : "fulltext";
  const { data, error } = await db.rpc("match_knowledge", {
    p_query_text: query,
    p_query_embedding: embedding ? toPgVector(embedding) : null,
    p_match_count: opts.limit ?? 8,
    p_full_text_weight: mode === "semantic" ? 0 : 1,
    p_semantic_weight: mode === "fulltext" ? 0 : 1,
    p_folder_id: opts.folderId ?? null,
  });
  if (error) throw error;
  return { matches: (data ?? []) as KnowledgeMatch[], mode };
}

export function citationsFromMatches(matches: KnowledgeMatch[]): Citation[] {
  return matches.map((m, i) => ({
    ref: i + 1,
    kind: "knowledge",
    id: m.document_id,
    title: m.title,
    url: m.url,
    snippet: m.content.slice(0, 280),
  }));
}

export function knowledgeContext(matches: KnowledgeMatch[]): string {
  return matches.map((m, i) => documentBlock({ ref: i + 1, title: m.title, type: m.doc_type, url: m.url }, m.content, 2400)).join("\n\n");
}

/** Keeps only citations the answer actually references ([n]); falls back to all if none are marked. */
export function usedCitations(answer: string, citations: Citation[]): Citation[] {
  const used = new Set([...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  const filtered = citations.filter((c) => used.has(c.ref));
  return filtered.length ? filtered : citations;
}

/** Knowledge Agent — answers a question from the user's saved documents, with citations. */
export async function answerFromKnowledge(db: SupabaseClient, ai: AIService, question: string, folderId?: string | null): Promise<KnowledgeAnswer> {
  const { matches } = await retrieveKnowledge(db, ai, question, { limit: 8, folderId });
  if (matches.length === 0) {
    return { answer: "I couldn't find anything in your knowledge vault about that. Try saving related articles or notes first.", citations: [], model: null };
  }
  const citations = citationsFromMatches(matches);
  const result = await ai.chat(
    [
      {
        role: "system",
        content: `You answer questions using the user's personal knowledge vault.
Cite sources inline with their ref number in square brackets, e.g. [1] or [2][3]. Every factual claim needs a citation.
If the documents don't contain the answer, say so plainly instead of guessing.
${GROUNDING_RULES}`,
      },
      { role: "user", content: `${knowledgeContext(matches)}\n\nQuestion: ${question}` },
    ],
    { temperature: 0.2, think: false, maxTokens: 900 },
  );
  return { answer: result.content.trim(), citations: usedCitations(result.content, citations), model: result.model };
}
