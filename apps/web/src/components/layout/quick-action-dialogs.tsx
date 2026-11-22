"use client";

import { useQuickActions } from "./quick-actions";

/**
 * Hosts the global create dialogs opened from the command palette, header and dashboard.
 * Feature modules plug their dialogs in here.
 */
export function QuickActionDialogs() {
  const { active } = useQuickActions();
  if (!active) return null;
  return null;
}
