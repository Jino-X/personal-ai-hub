import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import type { AgentJob } from "@hub/shared";
import { AIUnavailableError, errorMessage, ExternalServiceError } from "../lib/errors";
import { logger } from "../lib/logger";
import { claimJobs, completeJob, failJob, onJobEnqueued, rescheduleJob } from "./queue";
import { getJobHandler, JobDeferError, registeredJobKinds, registeredSchedules } from "./registry";

const AI_RETRY_DELAY_MS = 10 * 60_000;
const MAX_JOB_AGE_MS = 24 * 60 * 60_000;

function isRetryable(err: unknown): boolean {
  if (err instanceof ExternalServiceError) return err.retryable;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return true;
  // Unknown errors get retried; validation-style failures should throw non-retryable ExternalServiceError.
  return true;
}

/**
 * Polls the durable agent_jobs queue and executes registered handlers with
 * bounded concurrency, per-job timeouts and retry/backoff semantics.
 */
export class JobWorker {
  readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private running = new Set<Promise<void>>();
  private stopped = true;
  private wakeUp: (() => void) | null = null;

  constructor(private readonly opts: { concurrency: number; pollIntervalMs: number }) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    onJobEnqueued(() => this.wake());
    void this.loop();
    logger.info({ workerId: this.workerId, kinds: registeredJobKinds().length }, "job worker started");
  }

  wake() {
    this.wakeUp?.();
  }

  async stop(graceMs = 20_000) {
    this.stopped = true;
    this.wake();
    await Promise.race([Promise.allSettled([...this.running]), new Promise((r) => setTimeout(r, graceMs))]);
  }

  private async loop() {
    while (!this.stopped) {
      let claimed = 0;
      const free = this.opts.concurrency - this.running.size;
      if (free > 0) {
        try {
          const jobs = await claimJobs(this.workerId, free, registeredJobKinds());
          claimed = jobs.length;
          for (const job of jobs) this.track(this.execute(job));
        } catch (err) {
          logger.error({ err: errorMessage(err) }, "job claim failed");
        }
      }
      if (claimed > 0 && claimed === free) continue;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.opts.pollIntervalMs);
        this.wakeUp = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wakeUp = null;
    }
  }

  private track(promise: Promise<void>) {
    this.running.add(promise);
    void promise.finally(() => {
      this.running.delete(promise);
      this.wake();
    });
  }

  private async execute(job: AgentJob) {
    const log = logger.child({ jobId: job.id, kind: job.kind, attempt: job.attempts });
    const entry = getJobHandler(job.kind);
    if (!entry) {
      await failJob(job, new Error(`No handler registered for ${job.kind}`), false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Job exceeded ${entry.timeoutMs}ms`)), entry.timeoutMs);
    const started = Date.now();
    try {
      const result = await Promise.race([
        entry.handler({ job, log, signal: controller.signal }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }),
        ),
      ]);
      await completeJob(job, (result ?? {}) as Record<string, unknown>);
      log.info({ ms: Date.now() - started }, "job succeeded");
    } catch (err) {
      const tooOld = Date.now() - new Date(job.created_at).getTime() > MAX_JOB_AGE_MS;
      if (err instanceof JobDeferError && !tooOld) {
        await rescheduleJob(job, err.delayMs, err.message);
        log.info({ delayMs: err.delayMs, reason: err.message }, "job deferred");
      } else if (err instanceof AIUnavailableError && !tooOld) {
        await rescheduleJob(job, AI_RETRY_DELAY_MS, "Waiting for local AI to become available");
        log.info("job deferred until local AI is available");
      } else {
        const retrying = await failJob(job, err, isRetryable(err));
        log.warn({ err: errorMessage(err), retrying, ms: Date.now() - started }, "job failed");
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Starts all registered cron schedules. Each run is protected against overlap. */
export function startScheduler(): Cron[] {
  return registeredSchedules().map(
    (task) =>
      new Cron(task.pattern, { name: task.name, protect: true, catch: (err) => logger.error({ err: errorMessage(err), task: task.name }, "scheduled task failed") }, async () => {
        await task.run();
      }),
  );
}
