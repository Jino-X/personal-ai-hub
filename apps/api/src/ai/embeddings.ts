import { EMBEDDING_DIMENSIONS } from "@hub/shared";
import { ExternalServiceError } from "../lib/errors";

interface EmbeddingFormat {
  query: (text: string) => string;
  document: (text: string) => string;
}

/**
 * Many modern embedding models are trained with task prefixes; using them noticeably
 * improves retrieval quality. Unknown models get raw text.
 */
export function embeddingFormat(model: string): EmbeddingFormat {
  const m = model.toLowerCase();
  if (m.includes("qwen3-embedding")) {
    return {
      query: (q) => `Instruct: Given a question, retrieve passages from the user's saved knowledge that answer it\nQuery: ${q}`,
      document: (d) => d,
    };
  }
  if (m.includes("embeddinggemma")) {
    return { query: (q) => `task: search result | query: ${q}`, document: (d) => `title: none | text: ${d}` };
  }
  if (m.includes("nomic-embed")) {
    return { query: (q) => `search_query: ${q}`, document: (d) => `search_document: ${d}` };
  }
  if (m.includes("mxbai-embed") || m.includes("bge-")) {
    return { query: (q) => `Represent this sentence for searching relevant passages: ${q}`, document: (d) => d };
  }
  return { query: (q) => q, document: (d) => d };
}

/**
 * Coerces an embedding to the database vector dimension.
 * Larger vectors are truncated and re-normalised (valid for Matryoshka-trained models
 * such as Qwen3-Embedding); smaller vectors cannot be used.
 */
export function fitEmbedding(vector: number[], model: string): number[] {
  if (vector.length === EMBEDDING_DIMENSIONS) return vector;
  if (vector.length < EMBEDDING_DIMENSIONS) {
    throw new ExternalServiceError(
      "embeddings",
      `Embedding model "${model}" returns ${vector.length} dimensions but the knowledge vault uses ${EMBEDDING_DIMENSIONS}. ` +
        `Choose a ${EMBEDDING_DIMENSIONS}+ dimension model (e.g. qwen3-embedding:0.6b) in Settings → AI.`,
    );
  }
  const truncated = vector.slice(0, EMBEDDING_DIMENSIONS);
  const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0)) || 1;
  return truncated.map((v) => v / norm);
}

export function toPgVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
