"use client";

import { NoteDialog } from "@/components/knowledge/add-dialogs";
import { TaskDialog } from "@/components/productivity/task-dialog";
import { useQuickActions } from "./quick-actions";

/**
 * Hosts the global create dialogs opened from the command palette, header and dashboard.
 * Feature modules plug their dialogs in here.
 */
export function QuickActionDialogs() {
  const { active, close } = useQuickActions();
  return (
    <>
      <TaskDialog
        open={active === "task" || active === "reminder"}
        mode={active === "reminder" ? "reminder" : "task"}
        onOpenChange={(open) => !open && close()}
      />
      <NoteDialog open={active === "note"} onOpenChange={(open) => !open && close()} />
    </>
  );
}
