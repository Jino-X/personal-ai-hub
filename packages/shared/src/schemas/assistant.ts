import { z } from "zod";
import { BRIEFING_KINDS } from "../constants";
import { isoDate } from "./common";

export const conversationCreateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export const conversationUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  pinned: z.boolean().optional(),
});

export const chatMessageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  think: z.boolean().optional(),
});
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const actionDecisionSchema = z.object({
  decision: z.enum(["confirm", "reject"]),
});

export const briefingGenerateSchema = z.object({
  kind: z.enum(BRIEFING_KINDS),
  date: isoDate.optional(),
});

export const briefingListQuery = z.object({
  kind: z.enum(BRIEFING_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(20),
});
