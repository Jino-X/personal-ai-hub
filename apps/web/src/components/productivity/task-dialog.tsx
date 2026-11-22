"use client";

import { RECURRENCE_FREQS, TASK_PRIORITIES, TASK_STATUSES, type RecurrenceFreq, type Task, type TaskPriority, type TaskStatus } from "@hub/shared";
import { addDays, setHours, setMinutes, startOfDay } from "date-fns";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useCreateTask, useGoals, useProjects, useUpdateTask } from "@/lib/api/hooks/productivity";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { parseTags, PRIORITY_META, STATUS_LABEL } from "./meta";

const NONE = "__none__";

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  defaults?: Partial<Pick<Task, "project_id" | "goal_id" | "due_at" | "remind_at" | "category">>;
  mode?: "task" | "reminder";
}

function at(date: Date, hour: number) {
  return setMinutes(setHours(startOfDay(date), hour), 0).toISOString();
}

/** Create / edit a task. Also used for quick reminders (a task with a reminder time). */
export function TaskDialog({ open, onOpenChange, task, defaults, mode = "task" }: TaskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <TaskForm task={task} defaults={defaults} mode={mode} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({ task, defaults, mode, onDone }: Omit<TaskDialogProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const create = useCreateTask();
  const update = useUpdateTask();
  const { data: projects = [] } = useProjects();
  const { data: goals = [] } = useGoals();

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [due, setDue] = useState(toLocalInput(task?.due_at ?? defaults?.due_at));
  const [remind, setRemind] = useState(() =>
    toLocalInput(task?.remind_at ?? defaults?.remind_at ?? (mode === "reminder" ? new Date(Date.now() + 3_600_000).toISOString() : null)),
  );
  const [projectId, setProjectId] = useState(task?.project_id ?? defaults?.project_id ?? NONE);
  const [goalId, setGoalId] = useState(task?.goal_id ?? defaults?.goal_id ?? NONE);
  const [tags, setTags] = useState((task?.tags ?? []).join(", "));
  const [category, setCategory] = useState(task?.category ?? defaults?.category ?? "");
  const [freq, setFreq] = useState<RecurrenceFreq | typeof NONE>(task?.recurrence?.freq ?? NONE);
  const [interval, setInterval] = useState(task?.recurrence?.interval ?? 1);

  const pending = create.isPending || update.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      status,
      due_at: fromLocalInput(due),
      remind_at: fromLocalInput(remind),
      project_id: projectId === NONE ? null : projectId,
      goal_id: goalId === NONE ? null : goalId,
      tags: parseTags(tags),
      category: category.trim() || null,
      recurrence: freq === NONE ? null : { freq, interval: Math.max(1, interval) },
    };
    if (task) await update.mutateAsync({ id: task.id, ...body });
    else await create.mutateAsync(body);
    onDone();
  }

  const quickDue = (date: Date) => setDue(toLocalInput(at(date, 18)));

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{task ? "Edit task" : mode === "reminder" ? "New reminder" : "New task"}</DialogTitle>
        <DialogDescription>{mode === "reminder" ? "You'll get a notification at the reminder time." : "Capture it now, organise it later."}</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="task-title">Title</Label>
        <Input id="task-title" autoFocus required maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="task-desc">Notes</Label>
        <Textarea id="task-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Priority</Label>
          <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...TASK_PRIORITIES].reverse().map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_META[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="task-due">Due</Label>
          <Input id="task-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          <div className="flex gap-1">
            <Button type="button" size="xs" variant="outline" onClick={() => quickDue(new Date())}>
              Today
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={() => quickDue(addDays(new Date(), 1))}>
              Tomorrow
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setDue("")}>
              Clear
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-remind">Reminder</Label>
          <Input id="task-remind" type="datetime-local" value={remind} onChange={(e) => setRemind(e.target.value)} />
          {remind && (
            <Button type="button" size="xs" variant="ghost" onClick={() => setRemind("")}>
              Remove reminder
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Repeat</Label>
          <Select value={freq} onValueChange={(v) => setFreq(v as RecurrenceFreq | typeof NONE)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Doesn&apos;t repeat</SelectItem>
              {RECURRENCE_FREQS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f === "weekdays" ? "Every weekday" : f[0]!.toUpperCase() + f.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-interval">Every</Label>
          <Input
            id="task-interval"
            type="number"
            min={1}
            max={365}
            disabled={freq === NONE || freq === "weekdays"}
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value) || 1)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Inbox (no project)</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Goal</Label>
          <Select value={goalId} onValueChange={setGoalId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No goal</SelectItem>
              {goals.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="task-tags">Tags</Label>
          <Input id="task-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="interview, ai" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-cat">Category</Label>
          <Input id="task-cat" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="learning" />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !title.trim()}>
          {pending && <Spinner />}
          {task ? "Save changes" : mode === "reminder" ? "Set reminder" : "Create task"}
        </Button>
      </DialogFooter>
    </form>
  );
}
