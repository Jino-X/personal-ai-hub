"use client";

import type { GoalMilestone, GoalStatus, GoalWithDetails } from "@hub/shared";
import { CalendarClock, Ellipsis, ListPlus, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useGoalMutations } from "@/lib/api/hooks/productivity";
import { friendlyDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COLOR_DOT, GOAL_TYPE_LABEL } from "./meta";

export function GoalCard({ goal, onEdit, onAddTask }: { goal: GoalWithDetails; onEdit: () => void; onAddTask: () => void }) {
  const { update, remove } = useGoalMutations();
  const [adding, setAdding] = useState(false);
  const milestones = goal.milestones.filter((m) => goal.type !== "learning" || m.kind === "milestone");

  return (
    <Card id={`goal-${goal.id}`} className={cn("lift", goal.status !== "active" && "opacity-75")}>
      <CardHeader className="space-y-3">
        <div className="flex items-start gap-3">
          <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", COLOR_DOT[goal.color ?? "violet"])} />
          <div className="min-w-0 flex-1">
            <h3 className="font-medium leading-snug">{goal.title}</h3>
            {goal.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{goal.description}</p>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Goal actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onAddTask}>
                <ListPlus /> Add task
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={goal.status} onValueChange={(v) => update.mutate({ id: goal.id, status: v as GoalStatus })}>
                <DropdownMenuRadioItem value="active">Active</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="paused">Paused</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="completed">Completed</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="archived">Archived</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => confirm(`Delete "${goal.title}"?`) && remove.mutate(goal.id)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{GOAL_TYPE_LABEL[goal.type]}</Badge>
          {goal.status !== "active" && <Badge variant="outline">{goal.status}</Badge>}
          {goal.target_date && (
            <span className="flex items-center gap-1">
              <CalendarClock className="size-3" /> {friendlyDate(goal.target_date)}
            </span>
          )}
          {goal.open_task_count > 0 && <span>{goal.open_task_count} open tasks</span>}
        </div>
        <div className="flex items-center gap-3">
          <Progress value={goal.progress} className="h-1.5" aria-label={`${goal.title} progress`} />
          <span className="w-9 text-right text-xs font-medium tabular-nums">{goal.progress}%</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {milestones.map((m) => (
          <MilestoneRow key={m.id} milestone={m} />
        ))}
        {adding ? (
          <AddMilestoneForm goalId={goal.id} kind="milestone" onDone={() => setAdding(false)} />
        ) : (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setAdding(true)}>
            <Plus /> Add milestone
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function MilestoneRow({ milestone: m }: { milestone: GoalMilestone }) {
  const { updateMilestone, removeMilestone } = useGoalMutations();
  const measurable = m.target_value !== null && m.target_value > 0;
  const step = (delta: number) =>
    updateMilestone.mutate({ id: m.id, current_value: Math.max(0, Number(m.current_value) + delta), ...(measurable && Number(m.current_value) + delta >= Number(m.target_value) ? { completed: true } : {}) });

  return (
    <div className="group flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent/40">
      <Checkbox
        checked={Boolean(m.completed_at)}
        aria-label={`Complete ${m.title}`}
        onCheckedChange={(checked) => updateMilestone.mutate({ id: m.id, completed: Boolean(checked) })}
      />
      <span className={cn("flex-1 truncate", m.completed_at && "text-muted-foreground line-through")}>{m.title}</span>
      {measurable && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <Button size="icon-xs" variant="ghost" aria-label="Decrease" onClick={() => step(-1)}>
            <Minus />
          </Button>
          {Number(m.current_value)}/{Number(m.target_value)} {m.unit}
          <Button size="icon-xs" variant="ghost" aria-label="Increase" onClick={() => step(1)}>
            <Plus />
          </Button>
        </span>
      )}
      {m.due_date && !m.completed_at && <span className="text-xs text-muted-foreground">{friendlyDate(m.due_date)}</span>}
      <Button
        size="icon-xs"
        variant="ghost"
        className="opacity-0 group-hover:opacity-100"
        aria-label={`Delete ${m.title}`}
        onClick={() => removeMilestone.mutate(m.id)}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

export function AddMilestoneForm({ goalId, kind, onDone }: { goalId: string; kind: "milestone" | "lesson"; onDone: () => void }) {
  const { addMilestone } = useGoalMutations();
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await addMilestone.mutateAsync({
      goalId,
      title: title.trim(),
      kind,
      ...(target ? { target_value: Number(target), unit: unit.trim() || null } : {}),
    });
    setTitle("");
    setTarget("");
    setUnit("");
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <Input
        autoFocus
        className="h-8 min-w-40 flex-1"
        placeholder={kind === "lesson" ? "Lesson title" : "Milestone"}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
      />
      {kind === "milestone" && (
        <>
          <Input className="h-8 w-20" type="number" min={1} placeholder="Target" value={target} onChange={(e) => setTarget(e.target.value)} />
          <Input className="h-8 w-24" placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </>
      )}
      <Button size="sm" type="submit" disabled={!title.trim() || addMilestone.isPending}>
        Add
      </Button>
    </form>
  );
}
