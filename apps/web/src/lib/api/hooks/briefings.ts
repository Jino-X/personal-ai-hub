"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Briefing, BriefingKind } from "@hub/shared";
import { api } from "@/lib/api/client";

export const briefingKeys = {
  all: ["briefings"] as const,
  list: (kind?: BriefingKind) => ["briefings", "list", kind ?? "all"] as const,
  one: (id: string) => ["briefings", "one", id] as const,
};

const isEnriching = (b?: Briefing | null) => b?.ai_status === "pending" || b?.ai_status === "processing";

export function useBriefings(kind?: BriefingKind) {
  return useQuery({
    queryKey: briefingKeys.list(kind),
    queryFn: () => api<{ items: Briefing[] }>("/v1/briefings", { query: { kind, limit: 30 } }),
    select: (d) => d.items,
  });
}

export function useBriefing(id: string | null) {
  return useQuery({
    queryKey: briefingKeys.one(id ?? ""),
    queryFn: () => api<Briefing>(`/v1/briefings/${id}`),
    enabled: Boolean(id),
    // Poll while the AI narrative is being generated in the background.
    refetchInterval: (q) => (isEnriching(q.state.data) ? 5_000 : false),
  });
}

export function useGenerateBriefing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: BriefingKind) => api<Briefing>("/v1/briefings/generate", { body: { kind } }),
    onSuccess: (b) => {
      qc.setQueryData(briefingKeys.one(b.id), b);
      void qc.invalidateQueries({ queryKey: briefingKeys.all });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteBriefing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/v1/briefings/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: briefingKeys.all }),
  });
}
