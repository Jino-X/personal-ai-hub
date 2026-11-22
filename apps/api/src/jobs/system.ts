import { logger } from "../lib/logger";
import { adminDb } from "../lib/supabase";
import { deleteFinishedJobs, enqueueJob, recoverStaleJobs } from "./queue";
import { registerJobHandler, registerSchedule } from "./registry";

/** System housekeeping: stale-lock recovery and retention cleanup. */
export function registerSystemJobs() {
  registerJobHandler("system.cleanup", async ({ log }) => {
    const jobs = await deleteFinishedJobs(14);
    const now = new Date().toISOString();
    const { count: codes } = await adminDb.from("device_pairing_codes").delete({ count: "exact" }).lt("expires_at", now);
    const { count: actions } = await adminDb
      .from("assistant_actions")
      .update({ status: "expired" }, { count: "exact" })
      .eq("status", "proposed")
      .lt("expires_at", now);
    const readCutoff = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const { count: notifications } = await adminDb
      .from("notifications")
      .delete({ count: "exact" })
      .not("read_at", "is", null)
      .lt("created_at", readCutoff);
    log.info({ jobs, codes, actions, notifications }, "cleanup complete");
    return { jobs, codes: codes ?? 0, actions: actions ?? 0, notifications: notifications ?? 0 };
  });

  registerSchedule({
    name: "system.recover-stale-jobs",
    pattern: "*/2 * * * *",
    run: async () => {
      const recovered = await recoverStaleJobs();
      if (recovered > 0) logger.warn({ recovered }, "recovered stale jobs");
    },
  });

  registerSchedule({
    name: "system.cleanup",
    pattern: "30 3 * * *",
    run: async () => {
      await enqueueJob({ agent: "system", kind: "system.cleanup", dedupeKey: "system.cleanup", priority: 9 });
    },
  });
}
