import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { config } from "./config";
import { createApp } from "./app";
import { registerAgents } from "./agents";
import { deviceGateway } from "./devices/gateway";
import { JobWorker, startScheduler } from "./jobs/worker";
import { logger } from "./lib/logger";

registerAgents();

const app = createApp();
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info({ port: info.port, env: config.env }, `API listening on ${config.publicApiUrl}`);
});
// Local AI companions connect here (WebSocket upgrade on /v1/devices/connect).
deviceGateway.attach(server as Server);

const worker = new JobWorker({ concurrency: config.worker.concurrency, pollIntervalMs: 3_000 });
if (config.worker.enabled) worker.start();
const crons = config.worker.schedulerEnabled ? startScheduler() : [];

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  for (const cron of crons) cron.stop();
  deviceGateway.close();
  await worker.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandled promise rejection"));
