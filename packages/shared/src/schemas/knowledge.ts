import { z } from "zod";
import { COLORS, KNOWLEDGE_DOC_TYPES } from "../constants";
import { httpUrl, idSchema, paginationQuery, tagsSchema } from "./common";

export const knowledgeCreateSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("url"),
    url: httpUrl,
    type: z.enum(KNOWLEDGE_DOC_TYPES).optional(),
    folder_id: idSchema.nullable().optional(),
    tags: tagsSchema.optional(),
  }),
  z.object({
    mode: z.literal("note"),
    title: z.string().trim().min(1).max(300),
    content: z.string().min(1).max(200_000),
    type: z.enum(["note", "documentation", "ai_summary"]).optional(),
    url: httpUrl.nullable().optional(),
    folder_id: idSchema.nullable().optional(),
    tags: tagsSchema.optional(),
  }),
  z.object({
    mode: z.literal("intelligence_item"),
    item_id: idSchema,
    folder_id: idSchema.nullable().optional(),
    tags: tagsSchema.optional(),
  }),
]);
export type KnowledgeCreateInput = z.infer<typeof knowledgeCreateSchema>;

export const knowledgeUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  content: z.string().min(1).max(200_000).optional(),
  type: z.enum(KNOWLEDGE_DOC_TYPES).optional(),
  folder_id: idSchema.nullable().optional(),
  tags: tagsSchema.optional(),
});

export const knowledgeListQuery = paginationQuery.extend({
  folder_id: idSchema.optional(),
  type: z.enum(KNOWLEDGE_DOC_TYPES).optional(),
  tag: z.string().max(40).optional(),
  q: z.string().trim().max(300).optional(),
});

export const knowledgeSearchSchema = z.object({
  q: z.string().trim().min(1).max(500),
  mode: z.enum(["hybrid", "fulltext", "semantic"]).default("hybrid"),
  folder_id: idSchema.nullable().optional(),
  limit: z.number().int().min(1).max(30).default(10),
});

export const knowledgeAskSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  folder_id: idSchema.nullable().optional(),
});

export const folderCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parent_id: idSchema.nullable().optional(),
  color: z.enum(COLORS).nullable().optional(),
});
export const folderUpdateSchema = folderCreateSchema.partial();
