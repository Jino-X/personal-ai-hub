import type { AgentJob, AgentName } from "@hub/shared";
import { errorMessage } from "../lib/errors";
import { logger } from "../lib/logger";
import { adminDb } from "../lib/supabase";

export interface EnqueueOptions {
  agent: AgentName;
  kind: string;
  payload?: Record<string, unknown>;
  userId?: string | null;
  runAt?: Date;
  /** Lower runs first. */
  priority?: number;
  maxAttempts?: number;
  /** Only one queued/running job may exist per dedupe key. */
  dedupeKey?: string;
}

let wakeListener: (() => void) | null = null;
export function onJobEnqueued(listener: () => void) {
  wakeListener = listener;
}

/** Adds a job to the durable queue. Returns the job id (existing id when deduplicated). */
export async function enqueueJob(opts: EnqueueOptions): Promise<string | null> {
  const { data, error } = await adminDb.rpc("enqueue_agent_job", {
    p_agent: opts.agent,
    p_kind: opts.kind,
    p_payload: opts.payload ?? {},
    p_user_id: opts.userId ?? null,
    p_run_at: (opts.runAt ?? new Date()).toISOString(),
    p_priority: opts.priority ?? 5,
    p_max_attempts: opts.maxAttempts ?? 5,
    p_dedupe_key: opts.dedupeKey ?? null,
  });
  if (error) throw new Error(`enqueue failed: ${error.message}`);
  if (!opts.runAt || opts.runAt.getTime() <= Date.now()) wakeListener?.();
  return (data as string | null) ?? null;
}

export async function claimJobs(workerId: string, limit: number, kinds: string[]): Promise<AgentJob[]> {
  const { data, error } = await adminDb.rpc("claim_agent_jobs", { p_worker: workerId, p_limit: limit, p_kinds: kinds });
  if (error) throw new Error(`claim failed: ${error.message}`);
  return (data ?? []) as AgentJob[];
}

export async function completeJob(job: AgentJob, result: Record<string, unknown>) {
  const { error } = await adminDb
    .from("agent_jobs")
    .update({ status: "succeeded", result, finished_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null })
    .eq("id", job.id);
  if (error) logger.error({ err: error, jobId: job.id }, "failed to mark job complete");
}

/** Exponential backoff: 30s, 1m, 2m, 4m ... capped at 1h. */
function backoffMs(attempts: number) {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

export async function failJob(job: AgentJob, err: unknown, retryable: boolean) {
  const canRetry = retryable && job.attempts < job.max_attempts;
  const message = errorMessage(err).slice(0, 2000);
  const { error } = await adminDb
    .from("agent_jobs")
    .update(
      canRetry
        ? { status: "queued", run_at: new Date(Date.now() + backoffMs(job.attempts)).toISOString(), last_error: message, locked_at: null, locked_by: null }
        : { status: "failed", finished_at: new Date().toISOString(), last_error: message, locked_at: null, locked_by: null },
    )
    .eq("id", job.id);
  if (error) logger.error({ err: error, jobId: job.id }, "failed to record job failure");
  return canRetry;
}

/** Puts a job back in the queue without consuming an attempt (e.g. waiting for local AI). */
export async function rescheduleJob(job: AgentJob, delayMs: number, reason: string) {
  const { error } = await adminDb
    .from("agent_jobs")
    .update({
      status: "queued",
      attempts: Math.max(0, job.attempts - 1),
      run_at: new Date(Date.now() + delayMs).toISOString(),
      last_error: reason.slice(0, 2000),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", job.id);
  if (error) logger.error({ err: error, jobId: job.id }, "failed to reschedule job");
}

export async function recoverStaleJobs(): Promise<number> {
  const { data, error } = await adminDb.rpc("recover_stale_agent_jobs", { p_timeout: "15 minutes" });
  if (error) throw new Error(`recover failed: ${error.message}`);
  return (data as number) ?? 0;
}

export async function deleteFinishedJobs(olderThanDays: number) {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const { error, count } = await adminDb
    .from("agent_jobs")
    .delete({ count: "exact" })
    .in("status", ["succeeded", "failed", "cancelled"])
    .lt("finished_at", cutoff);
  if (error) throw new Error(`cleanup failed: ${error.message}`);
  return count ?? 0;
}
