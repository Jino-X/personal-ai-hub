import type { Hono } from "hono";
import type { AppEnv } from "../types";
import { aiRoutes } from "./ai";
import { deviceRoutes } from "./devices";
import { meRoutes } from "./me";
import { jobRoutes, notificationRoutes } from "./notifications";
import { searchRoutes } from "./search";
import { calendarRoutes } from "./calendar";
import { goalRoutes, learningRoutes } from "./goals";
import { projectRoutes, taskRoutes } from "./tasks";
import { intelligenceRoutes } from "./intelligence";
import { watchlistRoutes } from "./watchlists";
import { knowledgeRoutes } from "./knowledge";

/** Mounts every versioned feature router under /v1. */
export function registerRoutes(app: Hono<AppEnv>) {
  app.route("/v1/me", meRoutes);
  app.route("/v1/notifications", notificationRoutes);
  app.route("/v1/jobs", jobRoutes);
  app.route("/v1/devices", deviceRoutes);
  app.route("/v1/ai", aiRoutes);
  app.route("/v1/search", searchRoutes);
  app.route("/v1/tasks", taskRoutes);
  app.route("/v1/projects", projectRoutes);
  app.route("/v1/goals", goalRoutes);
  app.route("/v1/learning", learningRoutes);
  app.route("/v1/calendar", calendarRoutes);
  app.route("/v1/intelligence", intelligenceRoutes);
  app.route("/v1/watchlists", watchlistRoutes);
  app.route("/v1/knowledge", knowledgeRoutes);
}
