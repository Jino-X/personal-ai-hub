"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AISettings, AuditLog, IntegrationStatus, LocalAIDevice, OllamaModelInfo, PairingCode } from "@hub/shared";
import { api } from "@/lib/api/client";
import { getSupabase } from "@/lib/supabase/client";
import { env } from "@/lib/env";
import { systemKeys } from "./system";

export interface AISettingsResponse {
  settings: AISettings;
  server: { ollama_direct: boolean; cloud: boolean; cloud_chat_model: string | null; embedding_dimensions: number; request_timeout_ms: number };
}

export const settingsKeys = {
  ai: ["settings", "ai"] as const,
  devices: ["settings", "devices"] as const,
  models: ["settings", "models"] as const,
  integrations: ["settings", "integrations"] as const,
  audit: ["settings", "audit"] as const,
};

export function useAISettings() {
  return useQuery({ queryKey: settingsKeys.ai, queryFn: () => api<AISettingsResponse>("/v1/ai/settings") });
}

export function useUpdateAISettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AISettings>) => api<{ settings: AISettings }>("/v1/ai/settings", { method: "PATCH", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.ai });
      void qc.invalidateQueries({ queryKey: systemKeys.aiStatus });
    },
    meta: { successMessage: "AI settings saved" },
  });
}

export function useAvailableModels() {
  return useQuery({
    queryKey: settingsKeys.models,
    queryFn: () => api<{ provider: string | null; models: OllamaModelInfo[]; reason?: string }>("/v1/ai/models"),
    staleTime: 60_000,
  });
}

export function useTestAI() {
  return useMutation({
    mutationFn: () =>
      api<{ ok: boolean; provider: string; model: string; reply: string; latency_ms: number; embedding: { ok: boolean; dimensions?: number; latency_ms?: number; error?: string } }>(
        "/v1/ai/test",
        { method: "POST" },
      ),
  });
}

export function useDevices() {
  return useQuery({
    queryKey: settingsKeys.devices,
    queryFn: () => api<{ items: LocalAIDevice[] }>("/v1/devices"),
    select: (d) => d.items,
    refetchInterval: 15_000,
  });
}

export function useDeviceMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: settingsKeys.devices });
    void qc.invalidateQueries({ queryKey: systemKeys.aiStatus });
  };
  return {
    pairingCode: useMutation({ mutationFn: () => api<PairingCode>("/v1/devices/pairing-codes", { method: "POST" }) }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) => api(`/v1/devices/${id}`, { method: "PATCH", body: { name } }),
      onSuccess: invalidate,
    }),
    revoke: useMutation({
      mutationFn: (id: string) => api(`/v1/devices/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
      meta: { successMessage: "Device revoked" },
    }),
  };
}

export function useIntegrations() {
  return useQuery({ queryKey: settingsKeys.integrations, queryFn: () => api<{ items: IntegrationStatus[] }>("/v1/integrations"), select: (d) => d.items });
}

export function useGoogleCalendar() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: settingsKeys.integrations });
  return {
    connect: useMutation({
      mutationFn: () => api<{ url: string }>("/v1/integrations/google/connect", { method: "POST" }),
      onSuccess: ({ url }) => {
        window.location.href = url;
      },
    }),
    sync: useMutation({
      mutationFn: () => api("/v1/integrations/google/sync", { method: "POST" }),
      onSuccess: () => setTimeout(() => void invalidate(), 5000),
      meta: { successMessage: "Sync started" },
    }),
    disconnect: useMutation({
      mutationFn: () => api("/v1/integrations/google", { method: "DELETE" }),
      onSuccess: () => {
        void invalidate();
        void qc.invalidateQueries({ queryKey: ["calendar"] });
      },
      meta: { successMessage: "Google Calendar disconnected" },
    }),
  };
}

export function useAuditLogs() {
  return useQuery({ queryKey: settingsKeys.audit, queryFn: () => api<{ items: AuditLog[] }>("/v1/account/audit-logs", { query: { limit: 50 } }), select: (d) => d.items });
}

/** Downloads the full data export as a JSON file. */
export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await getSupabase().auth.getSession();
      const res = await fetch(`${env.apiUrl}/v1/account/export`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `personal-ai-hub-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    meta: { successMessage: "Export downloaded" },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      await api("/v1/account", { method: "DELETE", body: { confirm: "DELETE MY ACCOUNT" } });
      await getSupabase().auth.signOut();
    },
  });
}
