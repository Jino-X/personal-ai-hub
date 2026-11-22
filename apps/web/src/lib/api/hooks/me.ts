"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationPreferences, UserPreferences, UserProfile } from "@hub/shared";
import { api } from "@/lib/api/client";

export interface MeResponse {
  profile: UserProfile;
  preferences: UserPreferences;
  notifications: NotificationPreferences;
}

export const meKeys = { all: ["me"] as const };

export function useMe() {
  return useQuery({ queryKey: meKeys.all, queryFn: () => api<MeResponse>("/v1/me"), staleTime: 5 * 60_000 });
}

function useMePatch<TBody, TResult>(path: string, merge: (me: MeResponse, result: TResult) => MeResponse) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => api<TResult>(path, { method: "PATCH", body }),
    onSuccess: (result) => {
      qc.setQueryData<MeResponse>(meKeys.all, (prev) => (prev ? merge(prev, result) : prev));
    },
  });
}

export function useUpdateProfile() {
  return useMePatch<Partial<Pick<UserProfile, "display_name" | "timezone" | "avatar_url">>, UserProfile>(
    "/v1/me/profile",
    (me, profile) => ({ ...me, profile }),
  );
}

export function useUpdatePreferences() {
  return useMePatch<Partial<Omit<UserPreferences, "user_id" | "created_at" | "updated_at" | "ai_settings">>, UserPreferences>(
    "/v1/me/preferences",
    (me, preferences) => ({ ...me, preferences }),
  );
}

export function useUpdateNotificationPrefs() {
  return useMePatch<Partial<NotificationPreferences>, NotificationPreferences>("/v1/me/notifications", (me, notifications) => ({
    ...me,
    notifications,
  }));
}
