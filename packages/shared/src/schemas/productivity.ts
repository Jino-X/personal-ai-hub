import { z } from "zod";
import {
  COLORS,
  GOAL_STATUSES,
  GOAL_TYPES,
  LEARNING_RESOURCE_KINDS,
  LEARNING_RESOURCE_STATUSES,
  MILESTONE_KINDS,
  PROJECT_STATUSES,
  RECURRENCE_FREQS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "../constants";
import { httpUrl, idSchema, isoDate, isoDateTime, paginationQuery, tagsSchema } from "./common";

// NOTE: create schemas intentionally carry no `.default()`s — the database owns defaults,
// and zod 4 applies defaults inside `.partial()` which would clobber fields on update.

export const recurrenceSchema = z.object({
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.number().int().min(1).max(365),
  until: isoDate.nullable().optional(),
});

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  category: z.string().trim().max(60).nullable().optional(),
  tags: tagsSchema.optional(),
  due_at: isoDateTime.nullable().optional(),
  remind_at: isoDateTime.nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  project_id: idSchema.nullable().optional(),
  goal_id: idSchema.nullable().optional(),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = taskCreateSchema.partial().extend({
  sort_order: z.number().finite().optional(),
});
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

export const taskListQuery = paginationQuery.extend({
  status: z.enum([...TASK_STATUSES, "open", "all"]).default("open"),
  priority: z.enum(TASK_PRIORITIES).optional(),
  project_id: idSchema.optional(),
  goal_id: idSchema.optional(),
  tag: z.string().max(40).optional(),
  category: z.string().max(60).optional(),
  due: z.enum(["today", "overdue", "week", "none", "upcoming"]).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(["due", "priority", "created", "manual"]).default("due"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type TaskListQuery = z.infer<typeof taskListQuery>;

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  color: z.enum(COLORS).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  goal_id: idSchema.nullable().optional(),
});
export const projectUpdateSchema = projectCreateSchema.partial();

export const goalCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10_000).nullable().optional(),
  type: z.enum(GOAL_TYPES).optional(),
  status: z.enum(GOAL_STATUSES).optional(),
  target_date: isoDate.nullable().optional(),
  color: z.enum(COLORS).nullable().optional(),
});
export const goalUpdateSchema = goalCreateSchema.partial();

export const milestoneCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  kind: z.enum(MILESTONE_KINDS).optional(),
  target_value: z.number().finite().positive().nullable().optional(),
  current_value: z.number().finite().min(0).optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  due_date: isoDate.nullable().optional(),
  sort_order: z.number().int().optional(),
});
export const milestoneUpdateSchema = milestoneCreateSchema.partial().extend({
  completed: z.boolean().optional(),
});

export const skillCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().max(60).nullable().optional(),
  level: z.number().int().min(0).max(5).optional(),
  target_level: z.number().int().min(0).max(5).optional(),
  notes: z.string().max(5000).nullable().optional(),
});
export const skillUpdateSchema = skillCreateSchema.partial().extend({
  practiced: z.boolean().optional(),
});

export const learningResourceCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: httpUrl.nullable().optional(),
  kind: z.enum(LEARNING_RESOURCE_KINDS).optional(),
  status: z.enum(LEARNING_RESOURCE_STATUSES).optional(),
  notes: z.string().max(5000).nullable().optional(),
  goal_id: idSchema.nullable().optional(),
});
export const learningResourceUpdateSchema = learningResourceCreateSchema.partial();

export const calendarEventCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(10_000).nullable().optional(),
    location: z.string().max(300).nullable().optional(),
    url: httpUrl.nullable().optional(),
    starts_at: isoDateTime,
    ends_at: isoDateTime.nullable().optional(),
    all_day: z.boolean().optional(),
  })
  .refine((e) => !e.ends_at || new Date(e.ends_at) >= new Date(e.starts_at), {
    message: "End time must be after the start time",
    path: ["ends_at"],
  });
export const calendarEventUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(10_000).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  url: httpUrl.nullable().optional(),
  starts_at: isoDateTime.optional(),
  ends_at: isoDateTime.nullable().optional(),
  all_day: z.boolean().optional(),
});

export const calendarRangeQuery = z.object({
  from: isoDateTime,
  to: isoDateTime,
});

export const statsQuery = z.object({
  range: z.enum(["week", "month"]).default("week"),
});
