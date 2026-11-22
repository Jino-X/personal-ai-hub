import type { Hono } from "hono";
import type { AppEnv } from "../types";
import { aiRoutes } from "./ai";
import { deviceRoutes } from "./devices";
import { meRoutes } from "./me";
import { jobRoutes, notificationRoutes } from "./notifications";

/** Mounts every versioned feature router under /v1. */
export function registerRoutes(app: Hono<AppEnv>) {
  app.route("/v1/me", meRoutes);
  app.route("/v1/notifications", notificationRoutes);
  app.route("/v1/jobs", jobRoutes);
  app.route("/v1/devices", deviceRoutes);
  app.route("/v1/ai", aiRoutes);
}
