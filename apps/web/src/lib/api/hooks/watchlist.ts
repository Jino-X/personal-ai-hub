"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WatchKind, WatchlistMatch, WatchlistWithItems } from "@hub/shared";
import { api } from "@/lib/api/client";

export const watchKeys = {
  lists: ["watchlists"] as const,
  matches: (watchlistId?: string) => ["watchlists", "matches", watchlistId ?? "all"] as const,
};

export function useWatchlists() {
  return useQuery({ queryKey: watchKeys.lists, queryFn: () => api<{ items: WatchlistWithItems[] }>("/v1/watchlists"), select: (d) => d.items });
}

export function useWatchMatches(watchlistId?: string, unseen = false) {
  return useQuery({
    queryKey: [...watchKeys.matches(watchlistId), unseen],
    queryFn: () => api<{ items: WatchlistMatch[] }>("/v1/watchlists/matches", { query: { watchlist_id: watchlistId, unseen: unseen || undefined, limit: 50 } }),
    select: (d) => d.items,
    refetchInterval: 120_000,
  });
}

export function useWatchlistMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: watchKeys.lists });
    void qc.invalidateQueries({ queryKey: ["intelligence", "feed"] });
  };
  return {
    create: useMutation({
      mutationFn: (body: { name: string; description?: string | null; color?: string | null; notify?: boolean }) =>
        api<WatchlistWithItems>("/v1/watchlists", { body }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; name?: string; notify?: boolean; description?: string | null }) =>
        api(`/v1/watchlists/${id}`, { method: "PATCH", body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/v1/watchlists/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
    addItem: useMutation({
      mutationFn: ({ watchlistId, ...body }: { watchlistId: string; kind: WatchKind; value: string; match_terms?: string[] }) =>
        api(`/v1/watchlists/${watchlistId}/items`, { body }),
      onSuccess: () => {
        invalidate();
        setTimeout(() => void qc.invalidateQueries({ queryKey: ["watchlists"] }), 4000);
      },
    }),
    removeItem: useMutation({ mutationFn: (id: string) => api(`/v1/watchlists/items/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
    markSeen: useMutation({
      mutationFn: (body: { ids?: string[]; watchlist_id?: string }) => api("/v1/watchlists/matches/seen", { body }),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ["watchlists"] });
        void qc.invalidateQueries({ queryKey: ["dashboard"] });
      },
      meta: { silent: true },
    }),
  };
}
