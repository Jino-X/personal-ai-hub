"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CalendarEvent,
  GoalWithDetails,
  LearningResource,
  Paginated,
  ProductivityStats,
  Project,
  Skill,
  Task,
  TaskCreateInput,
  TaskListQuery,
  TaskUpdateInput,
} from "@hub/shared";
import { api } from "@/lib/api/client";

export type ProjectWithCount = Project & { open_task_count: number };

export interface DayPlan {
  summary: string;
  focus: { task_id: string; title: string; reason: string }[];
  defer: { task_id: string; title: string; reason: string }[];
  tips: string[];
  model: string;
  generated_at: string;
}

export interface GoalAnalysis {
  summary: string;
  wins: string[];
  risks: string[];
  next_steps: string[];
  model: string;
  generated_at: string;
}

export const productivityKeys = {
  tasks: ["tasks"] as const,
  taskList: (filters: Partial<TaskListQuery>) => ["tasks", "list", filters] as const,
  stats: (range: string) => ["tasks", "stats", range] as const,
  projects: ["projects"] as const,
  goals: ["goals"] as const,
  resources: ["learning", "resources"] as const,
  skills: ["learning", "skills"] as const,
  events: ["calendar"] as const,
  eventRange: (from: string, to: string) => ["calendar", from, to] as const,
};

type Filters = Partial<Omit<TaskListQuery, "limit" | "offset">> & { limit?: number };

export function useTasks(filters: Filters, enabled = true) {
  return useQuery({
    queryKey: productivityKeys.taskList(filters),
    queryFn: ({ signal }) => api<Paginated<Task>>("/v1/tasks", { query: filters as Record<string, string>, signal }),
    enabled,
  });
}

function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: productivityKeys.tasks });
    void qc.invalidateQueries({ queryKey: productivityKeys.projects });
    void qc.invalidateQueries({ queryKey: productivityKeys.goals });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

export function useCreateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (body: TaskCreateInput) => api<Task>("/v1/tasks", { body }),
    onSuccess: invalidate,
    meta: { successMessage: "Task created" },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ id, ...body }: TaskUpdateInput & { id: string }) =>
      api<{ task: Task; next_occurrence: Task | null }>(`/v1/tasks/${id}`, { method: "PATCH", body }),
    // Optimistically reflect status changes (checkbox toggles) in every cached list.
    onMutate: async ({ id, ...body }) => {
      await qc.cancelQueries({ queryKey: productivityKeys.tasks });
      const snapshots = qc.getQueriesData<Paginated<Task>>({ queryKey: ["tasks", "list"] });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<Paginated<Task>>(key, {
          ...data,
          items: data.items.map((t) => (t.id === id ? ({ ...t, ...body } as Task) : t)),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (id: string) => api(`/v1/tasks/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    meta: { successMessage: "Task deleted" },
  });
}

export function useTaskStats(range: "week" | "month" = "week") {
  return useQuery({ queryKey: productivityKeys.stats(range), queryFn: () => api<ProductivityStats>("/v1/tasks/stats", { query: { range } }) });
}

export function usePlanDay() {
  return useMutation({ mutationFn: () => api<DayPlan>("/v1/tasks/plan", { method: "POST" }) });
}

// ── Projects ──
export function useProjects() {
  return useQuery({ queryKey: productivityKeys.projects, queryFn: () => api<{ items: ProjectWithCount[] }>("/v1/projects"), select: (d) => d.items });
}

export function useProjectMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: productivityKeys.projects });
  return {
    create: useMutation({ mutationFn: (body: Partial<Project>) => api<ProjectWithCount>("/v1/projects", { body }), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Partial<Project> & { id: string }) => api<Project>(`/v1/projects/${id}`, { method: "PATCH", body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/v1/projects/${id}`, { method: "DELETE" }),
      onSuccess: () => {
        void invalidate();
        void qc.invalidateQueries({ queryKey: productivityKeys.tasks });
      },
    }),
  };
}

// ── Goals ──
export function useGoals(status: "current" | "all" | "completed" | "archived" = "current") {
  return useQuery({
    queryKey: [...productivityKeys.goals, status],
    queryFn: () => api<{ items: GoalWithDetails[] }>("/v1/goals", { query: { status } }),
    select: (d) => d.items,
  });
}

export function useGoalMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: productivityKeys.goals });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  return {
    create: useMutation({ mutationFn: (body: Record<string, unknown>) => api("/v1/goals", { body }), onSuccess: invalidate, meta: { successMessage: "Goal created" } }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Record<string, unknown> & { id: string }) => api(`/v1/goals/${id}`, { method: "PATCH", body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/v1/goals/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
    addMilestone: useMutation({
      mutationFn: ({ goalId, ...body }: Record<string, unknown> & { goalId: string }) => api(`/v1/goals/${goalId}/milestones`, { body }),
      onSuccess: invalidate,
    }),
    updateMilestone: useMutation({
      mutationFn: ({ id, ...body }: Record<string, unknown> & { id: string }) => api(`/v1/goals/milestones/${id}`, { method: "PATCH", body }),
      onSuccess: invalidate,
    }),
    removeMilestone: useMutation({ mutationFn: (id: string) => api(`/v1/goals/milestones/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}

export function useGoalAnalysis() {
  return useMutation({ mutationFn: () => api<GoalAnalysis>("/v1/goals/analysis", { method: "POST" }) });
}

// ── Learning ──
export function useLearningResources() {
  return useQuery({
    queryKey: productivityKeys.resources,
    queryFn: () => api<{ items: LearningResource[] }>("/v1/learning/resources"),
    select: (d) => d.items,
  });
}

export function useResourceMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: productivityKeys.resources });
    void qc.invalidateQueries({ queryKey: productivityKeys.goals });
  };
  return {
    create: useMutation({ mutationFn: (body: Record<string, unknown>) => api("/v1/learning/resources", { body }), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Record<string, unknown> & { id: string }) => api(`/v1/learning/resources/${id}`, { method: "PATCH", body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/v1/learning/resources/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}

export function useSkills() {
  return useQuery({ queryKey: productivityKeys.skills, queryFn: () => api<{ items: Skill[] }>("/v1/learning/skills"), select: (d) => d.items });
}

export function useSkillMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: productivityKeys.skills });
  return {
    create: useMutation({ mutationFn: (body: Record<string, unknown>) => api("/v1/learning/skills", { body }), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Record<string, unknown> & { id: string }) => api(`/v1/learning/skills/${id}`, { method: "PATCH", body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/v1/learning/skills/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}

// ── Calendar ──
export function useCalendarEvents(from: string, to: string) {
  return useQuery({
    queryKey: productivityKeys.eventRange(from, to),
    queryFn: ({ signal }) => api<{ items: CalendarEvent[] }>("/v1/calendar/events", { query: { from, to }, signal }),
    select: (d) => d.items,
  });
}

export function useEventMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: productivityKeys.events });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  return {
    create: useMutation({ mutationFn: (body: Record<string, unknown>) => api("/v1/calendar/events", { body }), onSuccess: invalidate, meta: { successMessage: "Event added" } }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Record<string, unknown> & { id: string }) => api(`/v1/calendar/events/${id}`, { method: "PATCH", body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/v1/calendar/events/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}
