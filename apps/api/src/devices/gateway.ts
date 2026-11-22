import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { DeviceHealth } from "@hub/shared";
import { bearerToken } from "../lib/auth";
import { AsyncQueue } from "../lib/async-queue";
import { errorMessage, ExternalServiceError } from "../lib/errors";
import { logger } from "../lib/logger";
import { adminDb } from "../lib/supabase";
import { deviceMessageSchema, PROTOCOL_VERSION, type DeviceHealthMessage, type JobOp, type ServerToDevice } from "./protocol";
import { verifyDeviceAccessToken } from "./tokens";

const CONNECT_PATH = "/v1/devices/connect";
const HEARTBEAT_INTERVAL_MS = 20_000;
const PING_INTERVAL_MS = 30_000;
const DB_TOUCH_INTERVAL_MS = 60_000;
const MAX_INFLIGHT_PER_DEVICE = 8;

/** A device dropped mid-job — safe to retry on another attempt. */
export class DeviceDisconnectedError extends ExternalServiceError {
  constructor() {
    super("companion", "the local AI device disconnected", undefined, true);
  }
}

interface PendingJob {
  op: JobOp;
  resolve: (data: Record<string, unknown>) => void;
  reject: (err: unknown) => void;
  onChunk?: (data: Record<string, unknown>) => void;
  timer: NodeJS.Timeout;
}

class DeviceConnection {
  readonly connectedAt = new Date();
  pending = new Map<string, PendingJob>();
  health: DeviceHealth | null = null;
  alive = true;
  lastDbTouch = 0;
  companionVersion: string | null = null;

  constructor(
    readonly ws: WebSocket,
    readonly deviceId: string,
    readonly userId: string,
    public tokenExpiresAt: Date,
  ) {}

  send(message: ServerToDevice) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(message));
  }
}

/**
 * Accepts authenticated outbound WebSocket connections from local AI companions and
 * dispatches inference jobs to them. Ollama is never exposed: the companion dials out
 * to the API, so no inbound ports are opened on the user's Mac.
 *
 * Connections are held in memory — a single API instance is assumed for this MVP.
 */
export class DeviceGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  private readonly connections = new Map<string, DeviceConnection>();
  private pingTimer: NodeJS.Timeout | null = null;

  attach(server: Server) {
    server.on("upgrade", (req, socket, head) => {
      void this.handleUpgrade(req, socket, head);
    });
    this.pingTimer = setInterval(() => this.sweep(), PING_INTERVAL_MS);
    this.pingTimer.unref();
  }

  close() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const conn of this.connections.values()) conn.ws.close(1001, "server_shutdown");
    this.wss.close();
  }

  private reject(socket: Duplex, status: number, message: string) {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== CONNECT_PATH) return this.reject(socket, 404, "Not Found");

    const token = bearerToken(req.headers.authorization);
    if (!token) return this.reject(socket, 401, "Unauthorized");
    let claims;
    try {
      claims = await verifyDeviceAccessToken(token);
    } catch {
      return this.reject(socket, 401, "Unauthorized");
    }
    const { data: device } = await adminDb
      .from("local_ai_devices")
      .select("id, status, user_id")
      .eq("id", claims.deviceId)
      .eq("user_id", claims.userId)
      .maybeSingle();
    if (!device || device.status !== "active") return this.reject(socket, 403, "Forbidden");

    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, claims.deviceId, claims.userId, claims.expiresAt));
  }

  private onConnection(ws: WebSocket, deviceId: string, userId: string, tokenExpiresAt: Date) {
    const previous = this.connections.get(deviceId);
    if (previous) previous.ws.close(4000, "replaced_by_new_connection");

    const conn = new DeviceConnection(ws, deviceId, userId, tokenExpiresAt);
    this.connections.set(deviceId, conn);
    logger.info({ deviceId, userId }, "AI device connected");

    conn.send({
      type: "welcome",
      protocol: PROTOCOL_VERSION,
      device_id: deviceId,
      server_time: new Date().toISOString(),
      heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
      token_expires_at: tokenExpiresAt.toISOString(),
    });
    void adminDb
      .from("local_ai_devices")
      .update({ last_connected_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
      .eq("id", deviceId)
      .then(({ error }) => error && logger.warn({ err: error }, "device touch failed"));

    ws.on("pong", () => {
      conn.alive = true;
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      void this.handleMessage(conn, data);
    });
    ws.on("close", (code) => {
      if (this.connections.get(deviceId) === conn) this.connections.delete(deviceId);
      for (const [jobId, job] of conn.pending) {
        clearTimeout(job.timer);
        job.reject(new DeviceDisconnectedError());
        conn.pending.delete(jobId);
      }
      void adminDb.from("local_ai_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", deviceId);
      logger.info({ deviceId, code }, "AI device disconnected");
    });
    ws.on("error", (err) => logger.warn({ deviceId, err: errorMessage(err) }, "device socket error"));
  }

  private async handleMessage(conn: DeviceConnection, raw: RawData) {
    let parsed;
    try {
      parsed = deviceMessageSchema.safeParse(JSON.parse(raw.toString()));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      const where = parsed?.error.issues[0] ? ` (${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message})` : "";
      logger.warn({ deviceId: conn.deviceId, where }, "invalid device message");
      conn.send({ type: "error", code: "invalid_message", message: `Message failed validation${where}` });
      return;
    }
    const msg = parsed.data;
    conn.alive = true;

    switch (msg.type) {
      case "hello":
        conn.companionVersion = msg.companion_version;
        if (msg.health) this.updateHealth(conn, msg.health);
        await adminDb
          .from("local_ai_devices")
          .update({ companion_version: msg.companion_version, platform: msg.platform ?? null })
          .eq("id", conn.deviceId);
        break;
      case "heartbeat":
        this.updateHealth(conn, msg.health);
        break;
      case "chunk":
        conn.pending.get(msg.job_id)?.onChunk?.(msg.data);
        break;
      case "result": {
        const job = conn.pending.get(msg.job_id);
        if (job) {
          clearTimeout(job.timer);
          conn.pending.delete(msg.job_id);
          job.resolve(msg.data);
        }
        break;
      }
      case "job_error": {
        const job = conn.pending.get(msg.job_id);
        if (job) {
          clearTimeout(job.timer);
          conn.pending.delete(msg.job_id);
          job.reject(new ExternalServiceError("companion", msg.error.message, undefined, msg.error.retryable));
        }
        break;
      }
      case "reauth":
        try {
          const claims = await verifyDeviceAccessToken(msg.access_token);
          if (claims.deviceId !== conn.deviceId || claims.userId !== conn.userId) throw new Error("device mismatch");
          conn.tokenExpiresAt = claims.expiresAt;
          conn.send({ type: "reauth_ok", token_expires_at: claims.expiresAt.toISOString() });
        } catch {
          conn.ws.close(4001, "invalid_token");
        }
        break;
    }
  }

  private updateHealth(conn: DeviceConnection, health: DeviceHealthMessage) {
    const previous = conn.health;
    conn.health = {
      ollama_reachable: health.ollama_reachable,
      ollama_version: health.ollama_version ?? null,
      models: health.models,
      running_models: health.running_models,
      active_jobs: health.active_jobs,
      companion_version: health.companion_version ?? conn.companionVersion,
      platform: health.platform ?? null,
      checked_at: new Date().toISOString(),
    };
    const changed = previous?.ollama_reachable !== health.ollama_reachable || previous?.models.length !== health.models.length;
    if (changed || Date.now() - conn.lastDbTouch > DB_TOUCH_INTERVAL_MS) {
      conn.lastDbTouch = Date.now();
      void adminDb
        .from("local_ai_devices")
        .update({ last_seen_at: new Date().toISOString(), health: conn.health })
        .eq("id", conn.deviceId)
        .then(({ error }) => error && logger.warn({ err: error }, "device health update failed"));
    }
  }

  /** Liveness pings and access-token expiry enforcement. */
  private sweep() {
    const now = Date.now();
    for (const conn of this.connections.values()) {
      if (conn.tokenExpiresAt.getTime() < now) {
        conn.ws.close(4001, "token_expired");
        continue;
      }
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  isOnline(deviceId: string) {
    return this.connections.has(deviceId);
  }

  connectionHealth(deviceId: string): DeviceHealth | null {
    return this.connections.get(deviceId)?.health ?? null;
  }

  /** Best connected device for a user: Ollama reachable, least busy. */
  pickDevice(userId: string): DeviceConnection | undefined {
    let best: DeviceConnection | undefined;
    for (const conn of this.connections.values()) {
      if (conn.userId !== userId || !conn.health?.ollama_reachable) continue;
      if (conn.pending.size >= MAX_INFLIGHT_PER_DEVICE) continue;
      if (!best || conn.pending.size < best.pending.size) best = conn;
    }
    return best;
  }

  /** Users with at least one connected device whose Ollama is reachable. */
  onlineUserIds(): string[] {
    return [...new Set([...this.connections.values()].filter((c) => c.health?.ollama_reachable).map((c) => c.userId))];
  }

  userDevices(userId: string): { deviceId: string; health: DeviceHealth | null }[] {
    return [...this.connections.values()].filter((c) => c.userId === userId).map((c) => ({ deviceId: c.deviceId, health: c.health }));
  }

  disconnect(deviceId: string, reason: string) {
    this.connections.get(deviceId)?.ws.close(4003, reason);
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  private dispatch(
    userId: string,
    op: JobOp,
    payload: Record<string, unknown>,
    opts: { timeoutMs: number; signal?: AbortSignal; onChunk?: (data: Record<string, unknown>) => void },
  ): { jobId: string; promise: Promise<Record<string, unknown>>; cancel: () => void } {
    const conn = this.pickDevice(userId);
    if (!conn) throw new ExternalServiceError("companion", "no connected local AI device", undefined, false);
    const jobId = randomUUID();

    const cancel = () => {
      const job = conn.pending.get(jobId);
      if (!job) return;
      clearTimeout(job.timer);
      conn.pending.delete(jobId);
      conn.send({ type: "cancel", job_id: jobId });
      job.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    };

    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(jobId);
        conn.send({ type: "cancel", job_id: jobId });
        reject(new ExternalServiceError("companion", `inference timed out after ${opts.timeoutMs}ms`, undefined, true));
      }, opts.timeoutMs);
      conn.pending.set(jobId, { op, resolve, reject, onChunk: opts.onChunk, timer });
    });

    if (opts.signal) {
      if (opts.signal.aborted) cancel();
      else opts.signal.addEventListener("abort", cancel, { once: true });
    }
    conn.send({ type: "job", job_id: jobId, op, payload, timeout_ms: opts.timeoutMs });
    return { jobId, promise, cancel };
  }

  /** Request/response job (non-streaming chat, embeddings, health). */
  request(userId: string, op: JobOp, payload: Record<string, unknown>, opts: { timeoutMs: number; signal?: AbortSignal }) {
    return this.dispatch(userId, op, payload, opts).promise;
  }

  /** Streaming job: yields each chunk the device forwards, then the final result. */
  stream(
    userId: string,
    op: JobOp,
    payload: Record<string, unknown>,
    opts: { timeoutMs: number; signal?: AbortSignal },
  ): AsyncIterable<{ kind: "chunk" | "final"; data: Record<string, unknown> }> {
    let cancel: () => void = () => undefined;
    const queue = new AsyncQueue<{ kind: "chunk" | "final"; data: Record<string, unknown> }>(() => cancel());
    const handle = this.dispatch(userId, op, payload, { ...opts, onChunk: (data) => queue.push({ kind: "chunk", data }) });
    cancel = handle.cancel;
    handle.promise.then(
      (data) => {
        queue.push({ kind: "final", data });
        queue.end();
      },
      (err) => queue.fail(err),
    );
    return queue;
  }
}

export const deviceGateway = new DeviceGateway();
