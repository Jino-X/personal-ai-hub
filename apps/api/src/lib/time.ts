import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfDay, startOfWeek } from "date-fns";

export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Start and end (exclusive) of "today" in the given time zone, as UTC Date objects. */
export function dayBounds(tz: string, at: Date = new Date()): { start: Date; end: Date; date: string } {
  const zoned = new TZDate(at, safeTimezone(tz));
  const start = startOfDay(zoned);
  const end = addDays(start, 1);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()), date: format(start, "yyyy-MM-dd") };
}

/** Monday-based week bounds in the given time zone. */
export function weekBounds(tz: string, at: Date = new Date()): { start: Date; end: Date; startDate: string; endDate: string } {
  const zoned = new TZDate(at, safeTimezone(tz));
  const start = startOfWeek(zoned, { weekStartsOn: 1 });
  const end = addDays(start, 7);
  return {
    start: new Date(start.getTime()),
    end: new Date(end.getTime()),
    startDate: format(start, "yyyy-MM-dd"),
    endDate: format(addDays(start, 6), "yyyy-MM-dd"),
  };
}

/** Local date string (YYYY-MM-DD) for an instant in a time zone. */
export function localDate(tz: string, at: Date = new Date()): string {
  return format(new TZDate(at, safeTimezone(tz)), "yyyy-MM-dd");
}

/** Local wall-clock components for an instant in a time zone. */
export function localParts(tz: string, at: Date = new Date()): { hour: number; minute: number; weekday: number; date: string } {
  const zoned = new TZDate(at, safeTimezone(tz));
  return { hour: zoned.getHours(), minute: zoned.getMinutes(), weekday: zoned.getDay(), date: format(zoned, "yyyy-MM-dd") };
}

/** Converts a local calendar date (YYYY-MM-DD) in a time zone to the UTC instant of its midnight. */
export function zonedMidnight(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(new TZDate(y, m - 1, d, 0, 0, 0, safeTimezone(tz)).getTime());
}
