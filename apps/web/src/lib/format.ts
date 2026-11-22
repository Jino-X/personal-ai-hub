import { format, formatDistanceToNowStrict, isThisYear, isToday, isTomorrow, isYesterday } from "date-fns";

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

/** "Today 14:30", "Tomorrow", "Mon 3 Mar", "3 Mar 2025". */
export function friendlyDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  const time = withTime ? ` ${format(date, "HH:mm")}` : "";
  if (isToday(date)) return `Today${time}`;
  if (isTomorrow(date)) return `Tomorrow${time}`;
  if (isYesterday(date)) return `Yesterday${time}`;
  return format(date, isThisYear(date) ? "EEE d MMM" : "d MMM yyyy") + time;
}

export function compactNumber(value: unknown): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Converts an ISO timestamp to the value of a <input type="datetime-local">. */
export function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts a datetime-local input value (local time) to an ISO timestamp with offset. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
