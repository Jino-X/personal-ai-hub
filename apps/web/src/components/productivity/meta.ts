import type { GoalType, Recurrence, TaskPriority, TaskStatus } from "@hub/shared";

export const PRIORITY_META: Record<TaskPriority, { label: string; className: string; dot: string }> = {
  urgent: { label: "Urgent", className: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  high: { label: "High", className: "border-warning/40 bg-warning/10 text-warning", dot: "bg-warning" },
  medium: { label: "Medium", className: "border-primary/30 bg-primary/10 text-primary", dot: "bg-primary" },
  low: { label: "Low", className: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  personal: "Personal",
  career: "Career",
  learning: "Learning",
  health: "Health",
  project: "Project",
};

/** Tailwind classes per stored color name (projects, goals, watchlists, folders). */
export const COLOR_DOT: Record<string, string> = {
  slate: "bg-slate-400",
  red: "bg-red-400",
  orange: "bg-orange-400",
  amber: "bg-amber-400",
  green: "bg-green-400",
  teal: "bg-teal-400",
  sky: "bg-sky-400",
  blue: "bg-blue-400",
  violet: "bg-violet-400",
  pink: "bg-pink-400",
};

export function recurrenceLabel(r: Recurrence | null | undefined): string | null {
  if (!r) return null;
  const every = r.interval > 1 ? `Every ${r.interval} ` : "Every ";
  switch (r.freq) {
    case "daily":
      return r.interval > 1 ? `${every}days` : "Daily";
    case "weekdays":
      return "Weekdays";
    case "weekly":
      return r.interval > 1 ? `${every}weeks` : "Weekly";
    case "monthly":
      return r.interval > 1 ? `${every}months` : "Monthly";
    case "yearly":
      return r.interval > 1 ? `${every}years` : "Yearly";
  }
}

export function parseTags(input: string): string[] {
  return [...new Set(input.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}
