import type { Context } from "hono";
import { adminDb } from "./supabase";
import { logger } from "./logger";
import { clientIp } from "./rate-limit";

export interface AuditEntry {
  userId: string | null;
  actor: "user" | "assistant" | "system" | "device";
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  c?: Context;
}

/**
 * Records a sensitive action in the append-only audit log.
 * Never throws — auditing failures are logged but must not break the request.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  const { error } = await adminDb.from("audit_logs").insert({
    user_id: entry.userId,
    actor: entry.actor,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
    ip_address: entry.c ? clientIp(entry.c) : null,
    user_agent: entry.c?.req.header("user-agent")?.slice(0, 300) ?? null,
  });
  if (error) logger.error({ err: error, action: entry.action }, "failed to write audit log");
}
