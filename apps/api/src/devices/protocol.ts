import { z } from "zod";

/**
 * Companion ⇄ API WebSocket protocol (JSON text frames). See docs/companion-protocol.md.
 * Everything a device sends is untrusted input and is validated here.
 */

export const PROTOCOL_VERSION = 1;

export type JobOp = "chat" | "embed" | "health";

export type ServerToDevice =
  | { type: "welcome"; protocol: number; device_id: string; server_time: string; heartbeat_interval_ms: number; token_expires_at: string }
  | { type: "job"; job_id: string; op: JobOp; payload: Record<string, unknown>; timeout_ms: number }
  | { type: "cancel"; job_id: string }
  | { type: "reauth_ok"; token_expires_at: string }
  | { type: "error"; code: string; message: string };

const healthSchema = z.object({
  ollama_reachable: z.boolean(),
  ollama_version: z.string().max(40).nullable().optional(),
  models: z
    .array(
      z.object({
        name: z.string().max(200),
        size: z.number().optional(),
        family: z.string().max(80).nullable().optional(),
        parameter_size: z.string().max(40).nullable().optional(),
        quantization: z.string().max(40).nullable().optional(),
      }),
    )
    .max(500)
    .default([]),
  running_models: z.array(z.string().max(200)).max(100).default([]),
  active_jobs: z.number().int().min(0).default(0),
  companion_version: z.string().max(40).nullable().optional(),
  platform: z.string().max(120).nullable().optional(),
});
export type DeviceHealthMessage = z.infer<typeof healthSchema>;

const jobId = z.string().min(1).max(64);

export const deviceMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), companion_version: z.string().max(40), platform: z.string().max(120).optional(), health: healthSchema.optional() }),
  z.object({ type: z.literal("heartbeat"), health: healthSchema }),
  z.object({ type: z.literal("chunk"), job_id: jobId, data: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("result"), job_id: jobId, data: z.record(z.string(), z.unknown()) }),
  z.object({
    type: z.literal("job_error"),
    job_id: jobId,
    error: z.object({ code: z.string().max(60), message: z.string().max(2000), retryable: z.boolean().default(false) }),
  }),
  z.object({ type: z.literal("reauth"), access_token: z.string().min(20).max(4000) }),
]);
export type DeviceMessage = z.infer<typeof deviceMessageSchema>;
