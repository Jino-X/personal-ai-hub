"use client";

import { createContext, use, useState, type ReactNode } from "react";

export type QuickActionKind = "task" | "reminder" | "note";

interface QuickActionsValue {
  active: QuickActionKind | null;
  open: (kind: QuickActionKind) => void;
  close: () => void;
}

const QuickActionsContext = createContext<QuickActionsValue | null>(null);

/** Global "create" dialogs reachable from the command palette, header and dashboard. */
export function QuickActionsProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<QuickActionKind | null>(null);
  return (
    <QuickActionsContext value={{ active, open: setActive, close: () => setActive(null) }}>{children}</QuickActionsContext>
  );
}

export function useQuickActions() {
  const ctx = use(QuickActionsContext);
  if (!ctx) throw new Error("useQuickActions must be used within QuickActionsProvider");
  return ctx;
}
