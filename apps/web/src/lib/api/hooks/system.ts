"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentJob, AIRuntimeStatus, Notification } from "@hub/shared";
import { api } from "@/lib/api/client";

export const systemKeys = {
  aiStatus: ["ai", "status"] as const,
  notifications: ["notifications"] as const,
  jobs: ["jobs"] as const,
};

/** Local AI availability — polled so the header indicator stays live. */
export function useAIStatus() {
  return useQuery({
    queryKey: systemKeys.aiStatus,
    queryFn: () => api<AIRuntimeStatus>("/v1/ai/status"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: systemKeys.notifications,
    queryFn: () => api<{ items: Notification[]; unread: number }>("/v1/notifications", { query: { limit: 30 } }),
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/v1/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: systemKeys.notifications }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/v1/notifications/read-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: systemKeys.notifications }),
  });
}

export function useJobs(enabled = true) {
  return useQuery({
    queryKey: systemKeys.jobs,
    queryFn: () => api<{ items: AgentJob[] }>("/v1/jobs", { query: { limit: 30 } }),
    enabled,
    refetchInterval: 15_000,
  });
}
