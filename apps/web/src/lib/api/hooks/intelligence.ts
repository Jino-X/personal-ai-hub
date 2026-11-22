"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { FeedItem, FeedQuery, IntelligenceCategory, IntelligenceFeed, NewsSource, Paginated } from "@hub/shared";
import { api } from "@/lib/api/client";

export type FeedFilters = Partial<Omit<FeedQuery, "limit" | "offset">>;
export type SourceWithState = NewsSource & { muted: boolean; built_in: boolean };

export const intelKeys = {
  all: ["intelligence"] as const,
  feed: (filters: FeedFilters) => ["intelligence", "feed", filters] as const,
  categories: ["intelligence", "categories"] as const,
  status: ["intelligence", "status"] as const,
  sources: ["intelligence", "sources"] as const,
};

const PAGE = 20;

export function useFeed(filters: FeedFilters) {
  return useInfiniteQuery({
    queryKey: intelKeys.feed(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api<Paginated<FeedItem>>("/v1/intelligence/feed", { query: { ...(filters as Record<string, string>), limit: PAGE, offset: pageParam }, signal }),
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    staleTime: 60_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: intelKeys.categories,
    queryFn: () => api<{ items: IntelligenceCategory[] }>("/v1/intelligence/categories"),
    select: (d) => d.items,
    staleTime: 60 * 60_000,
  });
}

export function useIntelStatus() {
  return useQuery({
    queryKey: intelKeys.status,
    queryFn: () => api<{ pending_ai: number; last_updated: Partial<Record<IntelligenceFeed, string | null>> }>("/v1/intelligence/status"),
    refetchInterval: 60_000,
  });
}

/** Applies a patch to an item across every cached feed page (optimistic UI). */
function usePatchCachedItem() {
  const qc = useQueryClient();
  return (id: string, patch: Partial<FeedItem>) => {
    qc.setQueriesData<InfiniteData<Paginated<FeedItem>>>({ queryKey: ["intelligence", "feed"] }, (data) =>
      data
        ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })) }
        : data,
    );
  };
}

export function useItemState() {
  const patch = usePatchCachedItem();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; read?: boolean; hidden?: boolean; feedback?: -1 | 1 | null }) =>
      api(`/v1/intelligence/items/${id}/state`, { body }),
    onMutate: ({ id, read }) => {
      if (read !== undefined) patch(id, { is_read: read });
    },
    meta: { silent: true },
  });
}

export function useHideItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/v1/intelligence/items/${id}/state`, { body: { hidden: true } }),
    onSuccess: (_d, id) => {
      qc.setQueriesData<InfiniteData<Paginated<FeedItem>>>({ queryKey: ["intelligence", "feed"] }, (data) =>
        data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) })) } : data,
      );
    },
    meta: { successMessage: "Hidden from your feed" },
  });
}

export function useBookmark() {
  const patch = usePatchCachedItem();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, bookmarked }: { id: string; bookmarked: boolean }) =>
      api(`/v1/intelligence/items/${id}/bookmark`, bookmarked ? { body: {} } : { method: "DELETE" }),
    onMutate: ({ id, bookmarked }) => patch(id, { is_bookmarked: bookmarked }),
    onError: (_e, { id, bookmarked }) => patch(id, { is_bookmarked: !bookmarked }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feed?: IntelligenceFeed) => api<{ updated: number }>("/v1/intelligence/mark-read", { body: { feed } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: intelKeys.all }),
    meta: { successMessage: "Marked as read" },
  });
}

export function useRefreshFeeds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feed?: IntelligenceFeed) => api<{ enqueued: number }>("/v1/intelligence/refresh", { body: { feed } }),
    onSuccess: () => setTimeout(() => void qc.invalidateQueries({ queryKey: intelKeys.all }), 15_000),
    meta: { successMessage: "Fetching the latest updates in the background" },
  });
}

export function useExplainItem() {
  return useMutation({ mutationFn: (id: string) => api<{ explanation: string; model: string }>(`/v1/intelligence/items/${id}/explain`, { method: "POST" }) });
}

export function useSources() {
  return useQuery({ queryKey: intelKeys.sources, queryFn: () => api<{ items: SourceWithState[] }>("/v1/intelligence/sources"), select: (d) => d.items });
}

export function useSourceMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: intelKeys.sources });
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => api("/v1/intelligence/sources", { body }),
      onSuccess: invalidate,
      meta: { successMessage: "Source added — fetching now" },
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; enabled?: boolean; name?: string }) => api(`/v1/intelligence/sources/${id}`, { method: "PATCH", body }),
      onSuccess: invalidate,
    }),
    mute: useMutation({
      mutationFn: ({ id, muted }: { id: string; muted: boolean }) => api(`/v1/intelligence/sources/${id}/mute`, { body: { muted } }),
      onSuccess: () => {
        void invalidate();
        void qc.invalidateQueries({ queryKey: intelKeys.all });
      },
    }),
    refresh: useMutation({
      mutationFn: (id: string) => api(`/v1/intelligence/sources/${id}/refresh`, { method: "POST" }),
      meta: { successMessage: "Refresh queued" },
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/v1/intelligence/sources/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}
