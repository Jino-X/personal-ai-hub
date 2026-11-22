"use client";

import { COLORS, GOAL_TYPES, type Goal, type GoalType } from "@hub/shared";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useGoalMutations } from "@/lib/api/hooks/productivity";
import { cn } from "@/lib/utils";
import { COLOR_DOT, GOAL_TYPE_LABEL } from "./meta";

export function GoalDialog({
  open,
  onOpenChange,
  goal,
  defaultType = "personal",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: Goal | null;
  defaultType?: GoalType;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open && <GoalForm goal={goal} defaultType={defaultType} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function GoalForm({ goal, defaultType, onDone }: { goal?: Goal | null; defaultType: GoalType; onDone: () => void }) {
  const { create, update } = useGoalMutations();
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [type, setType] = useState<GoalType>(goal?.type ?? defaultType);
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? "");
  const [color, setColor] = useState(goal?.color ?? "violet");
  const pending = create.isPending || update.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { title: title.trim(), description: description.trim() || null, type, target_date: targetDate || null, color };
    if (goal) await update.mutateAsync({ id: goal.id, ...body });
    else await create.mutateAsync(body);
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{goal ? "Edit goal" : type === "learning" ? "New learning path" : "New goal"}</DialogTitle>
        <DialogDescription>Break it into measurable milestones once it&apos;s created.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="goal-title">Title</Label>
        <Input
          id="goal-title"
          autoFocus
          required
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={type === "learning" ? "AI engineering fundamentals" : "Ace technical interviews"}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="goal-desc">Why it matters</Label>
        <Textarea id="goal-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as GoalType)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GOAL_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {GOAL_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-date">Target date</Label>
          <Input id="goal-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cn("size-6 rounded-full ring-offset-2 ring-offset-background", COLOR_DOT[c], color === c && "ring-2 ring-ring")}
            />
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !title.trim()}>
          {pending && <Spinner />}
          {goal ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
