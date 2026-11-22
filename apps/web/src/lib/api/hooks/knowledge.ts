"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  KnowledgeAnswer,
  KnowledgeCreateInput,
  KnowledgeDocType,
  KnowledgeDocument,
  KnowledgeDocumentSummary,
  KnowledgeFolder,
  KnowledgeMatch,
  Paginated,
} from "@hub/shared";
import { api } from "@/lib/api/client";

export type FolderWithCount = KnowledgeFolder & { document_count: number };

export const knowledgeKeys = {
  all: ["knowledge"] as const,
  folders: ["knowledge", "folders"] as const,
  docs: (filters: Record<string, unknown>) => ["knowledge", "documents", filters] as const,
  doc: (id: string) => ["knowledge", "document", id] as const,
  tags: ["knowledge", "tags"] as const,
};

export function useFolders() {
  return useQuery({
    queryKey: knowledgeKeys.folders,
    queryFn: () => api<{ items: FolderWithCount[]; unfiled_count: number; total: number }>("/v1/knowledge/folders"),
  });
}

export function useDocuments(filters: { folder_id?: string; type?: KnowledgeDocType; tag?: string; q?: string }) {
  return useInfiniteQuery({
    queryKey: knowledgeKeys.docs(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api<Paginated<KnowledgeDocumentSummary>>("/v1/knowledge/documents", { query: { ...filters, limit: 30, offset: pageParam }, signal }),
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    // Poll while anything is still being indexed so status badges update.
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.items.some((d) => d.index_status === "pending" || d.index_status === "processing")) ? 8_000 : false,
  });
}

export function useDocument(id: string | null) {
  return useQuery({ queryKey: knowledgeKeys.doc(id ?? ""), queryFn: () => api<KnowledgeDocument>(`/v1/knowledge/documents/${id}`), enabled: Boolean(id) });
}

export function useKnowledgeTags() {
  return useQuery({ queryKey: knowledgeKeys.tags, queryFn: () => api<{ items: { tag: string; count: number }[] }>("/v1/knowledge/tags"), select: (d) => d.items });
}

export function useKnowledgeMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: knowledgeKeys.all });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  return {
    create: useMutation({
      mutationFn: (body: KnowledgeCreateInput) => api<KnowledgeDocumentSummary>("/v1/knowledge/documents", { body }),
      onSuccess: invalidate,
      meta: { successMessage: "Saved to your knowledge vault — indexing in the background" },
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; title?: string; content?: string; folder_id?: string | null; tags?: string[] }) =>
        api<KnowledgeDocumentSummary>(`/v1/knowledge/documents/${id}`, { method: "PATCH", body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/v1/knowledge/documents/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
      meta: { successMessage: "Document deleted" },
    }),
    reindex: useMutation({
      mutationFn: (id: string) => api(`/v1/knowledge/documents/${id}/reindex`, { method: "POST" }),
      onSuccess: invalidate,
      meta: { successMessage: "Re-indexing queued" },
    }),
    createFolder: useMutation({
      mutationFn: (body: { name: string; parent_id?: string | null }) => api<KnowledgeFolder>("/v1/knowledge/folders", { body }),
      onSuccess: invalidate,
    }),
    removeFolder: useMutation({ mutationFn: (id: string) => api(`/v1/knowledge/folders/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}

export function useKnowledgeSearch() {
  return useMutation({
    mutationFn: (body: { q: string; mode: "hybrid" | "fulltext" | "semantic"; folder_id?: string | null }) =>
      api<{ items: KnowledgeMatch[]; mode_used: string; note: string | null }>("/v1/knowledge/search", { body: { ...body, limit: 15 } }),
  });
}

export function useAskKnowledge() {
  return useMutation({ mutationFn: (body: { question: string; folder_id?: string | null }) => api<KnowledgeAnswer>("/v1/knowledge/ask", { body }) });
}
