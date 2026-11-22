import { DASHBOARD_WIDGETS, type DashboardWidgetId } from "./constants";
import type { DashboardWidgetConfig } from "./types";

/** Merge stored widget config with the catalogue so new widgets appear and removed ones disappear. */
export function normalizeDashboardWidgets(stored: DashboardWidgetConfig[] | null | undefined): DashboardWidgetConfig[] {
  const known = new Set<string>(DASHBOARD_WIDGETS.map((w) => w.id));
  const seen = new Set<string>();
  const result: DashboardWidgetConfig[] = [];
  for (const w of stored ?? []) {
    if (known.has(w.id) && !seen.has(w.id)) {
      seen.add(w.id);
      result.push({ id: w.id, visible: Boolean(w.visible) });
    }
  }
  for (const w of DASHBOARD_WIDGETS) {
    if (!seen.has(w.id)) result.push({ id: w.id as DashboardWidgetId, visible: true });
  }
  return result;
}

/** Formats a pairing code as XXXX-XXXX. */
export function formatPairingCode(code: string): string {
  const clean = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
