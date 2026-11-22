import type { AgentJob } from "@hub/shared";
import type { Logger } from "../lib/logger";

export interface JobContext {
  job: AgentJob;
  log: Logger;
  signal: AbortSignal;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown> | void>;

interface RegisteredHandler {
  handler: JobHandler;
  timeoutMs: number;
}

/** Thrown by a handler to re-run the job later without consuming an attempt. */
export class JobDeferError extends Error {
  constructor(
    message: string,
    public readonly delayMs: number,
  ) {
    super(message);
    this.name = "JobDeferError";
  }
}

const handlers = new Map<string, RegisteredHandler>();

export function registerJobHandler(kind: string, handler: JobHandler, options: { timeoutMs?: number } = {}) {
  if (handlers.has(kind)) throw new Error(`Job handler already registered for ${kind}`);
  handlers.set(kind, { handler, timeoutMs: options.timeoutMs ?? 10 * 60_000 });
}

export function getJobHandler(kind: string) {
  return handlers.get(kind);
}

export function registeredJobKinds() {
  return [...handlers.keys()];
}

// ── Scheduled (cron) tasks ──────────────────────────────────────────────────

export interface ScheduledTask {
  name: string;
  /** Cron pattern (croner syntax, seconds optional). */
  pattern: string;
  run: () => Promise<void>;
}

const schedules: ScheduledTask[] = [];

export function registerSchedule(task: ScheduledTask) {
  schedules.push(task);
}

export function registeredSchedules() {
  return [...schedules];
}
