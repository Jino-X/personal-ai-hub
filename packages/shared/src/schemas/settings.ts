import { z } from "zod";
import { AI_PROVIDERS, CATEGORY_SLUGS, DASHBOARD_WIDGET_IDS } from "../constants";
import { idSchema, timeOfDay, timezoneSchema } from "./common";

export const profileUpdateSchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional(),
  timezone: timezoneSchema.optional(),
  avatar_url: z.url({ protocol: /^https$/ }).max(2048).nullable().optional(),
});

export const dashboardWidgetsSchema = z
  .array(z.object({ id: z.enum(DASHBOARD_WIDGET_IDS), visible: z.boolean() }))
  .max(DASHBOARD_WIDGET_IDS.length)
  .refine((ws) => new Set(ws.map((w) => w.id)).size === ws.length, "Duplicate widget ids");

export const preferencesUpdateSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).optional(),
  dashboard_widgets: dashboardWidgetsSchema.optional(),
  interest_categories: z.array(z.enum(CATEGORY_SLUGS)).max(CATEGORY_SLUGS.length).optional(),
  interest_keywords: z.array(z.string().trim().min(2).max(60)).max(50).optional(),
  muted_source_ids: z.array(idSchema).max(200).optional(),
});

const modelName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][\w.:\-/]*$/, "Invalid model name");

export const aiSettingsUpdateSchema = z.object({
  provider: z.enum(AI_PROVIDERS).optional(),
  chat_model: modelName.optional(),
  embedding_model: modelName.optional(),
  context_length: z.number().int().min(2048).max(131_072).optional(),
  temperature: z.number().min(0).max(2).optional(),
  thinking: z.boolean().optional(),
  allow_cloud_fallback: z.boolean().optional(),
});
export type AISettingsUpdateInput = z.infer<typeof aiSettingsUpdateSchema>;

export const notificationPrefsUpdateSchema = z.object({
  daily_briefing_enabled: z.boolean().optional(),
  daily_briefing_time: timeOfDay.optional(),
  weekly_briefing_enabled: z.boolean().optional(),
  weekly_briefing_day: z.number().int().min(0).max(6).optional(),
  task_reminders_enabled: z.boolean().optional(),
  watchlist_alerts_enabled: z.boolean().optional(),
  min_alert_relevance: z.number().int().min(0).max(100).optional(),
});

export const deviceRenameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const devicePairSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z2-9]{4}-?[A-Z2-9]{4}$/, "Invalid pairing code"),
  name: z.string().trim().min(1).max(80),
  platform: z.string().trim().max(80).optional(),
  companion_version: z.string().trim().max(40).optional(),
});

export const deviceTokenSchema = z.object({
  device_id: idSchema,
  refresh_token: z.string().min(32).max(200),
});

export const accountDeleteSchema = z.object({
  confirm: z.literal("DELETE MY ACCOUNT"),
});
