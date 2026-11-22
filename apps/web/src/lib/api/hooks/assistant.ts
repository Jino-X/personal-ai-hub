"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssistantAction, Conversation, Message } from "@hub/shared";
import { api } from "@/lib/api/client";

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  actions: AssistantAction[];
}

export const assistantKeys = {
  conversations: ["assistant", "conversations"] as const,
  conversation: (id: string) => ["assistant", "conversation", id] as const,
};

export function useConversations() {
  return useQuery({
    queryKey: assistantKeys.conversations,
    queryFn: () => api<{ items: Conversation[] }>("/v1/assistant/conversations"),
    select: (d) => d.items,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: assistantKeys.conversation(id ?? ""),
    queryFn: () => api<ConversationDetail>(`/v1/assistant/conversations/${id}`),
    enabled: Boolean(id),
  });
}

export function useConversationMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: assistantKeys.conversations });
  return {
    create: useMutation({ mutationFn: () => api<Conversation>("/v1/assistant/conversations", { body: {} }), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; title?: string; pinned?: boolean }) => api<Conversation>(`/v1/assistant/conversations/${id}`, { method: "PATCH", body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/v1/assistant/conversations/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}

export function useDecideAction(conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "confirm" | "reject" }) =>
      api<AssistantAction>(`/v1/assistant/actions/${id}/decision`, { body: { decision } }),
    onSuccess: (action) => {
      if (conversationId) {
        qc.setQueryData<ConversationDetail>(assistantKeys.conversation(conversationId), (prev) =>
          prev ? { ...prev, actions: prev.actions.map((a) => (a.id === action.id ? action : a)) } : prev,
        );
      }
      if (action.status === "executed") {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["knowledge"] });
        void qc.invalidateQueries({ queryKey: ["dashboard"] });
      }
    },
  });
}
