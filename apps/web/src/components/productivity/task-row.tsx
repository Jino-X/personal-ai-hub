"use client";

import type { Task } from "@hub/shared";
import { AlarmClock, Ellipsis, Pencil, Repeat, Target, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDeleteTask, useUpdateTask } from "@/lib/api/hooks/productivity";
import { friendlyDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COLOR_DOT, PRIORITY_META, recurrenceLabel } from "./meta";

export function TaskRow({
  task,
  projectName,
  projectColor,
  onEdit,
  compact = false,
}: {
  task: Task;
  projectName?: string;
  projectColor?: string;
  onEdit?: (task: Task) => void;
  compact?: boolean;
}) {
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const done = task.status === "done";
  const overdue = !done && task.due_at && new Date(task.due_at) < new Date();
  const repeat = recurrenceLabel(task.recurrence);

  return (
    <div className={cn("group flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/30", done && "opacity-60")}>
      <Checkbox
        className="mt-0.5"
        checked={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        onCheckedChange={(checked) => update.mutate({ id: task.id, status: checked ? "done" : "todo" })}
      />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit?.(task)}>
        <p className={cn("truncate text-sm", done && "line-through")}>{task.title}</p>
        {!compact && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {task.due_at && <span className={cn(overdue && "font-medium text-destructive")}>{friendlyDate(task.due_at, true)}</span>}
            {projectName && (
              <span className="flex items-center gap-1">
                <span className={cn("size-2 rounded-full", COLOR_DOT[projectColor ?? "slate"])} />
                {projectName}
              </span>
            )}
            {repeat && (
              <span className="flex items-center gap-1">
                <Repeat className="size-3" /> {repeat}
              </span>
            )}
            {task.remind_at && !task.reminder_sent_at && (
              <span className="flex items-center gap-1">
                <AlarmClock className="size-3" /> {friendlyDate(task.remind_at, true)}
              </span>
            )}
            {task.goal_id && <Target className="size-3" aria-label="Linked to a goal" />}
            {task.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
        )}
      </button>
      <Badge variant="outline" className={cn("shrink-0", PRIORITY_META[task.priority].className)}>
        {PRIORITY_META[task.priority].label}
      </Badge>
      {onEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="opacity-60 group-hover:opacity-100" aria-label="Task actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(task)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate(task.id)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
