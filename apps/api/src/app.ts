import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { config } from "./config";
import { AIUnavailableError, AppError } from "./lib/errors";
import { logger } from "./lib/logger";
import { rateLimit } from "./lib/rate-limit";
import { registerRoutes } from "./routes";
import { healthRoutes } from "./routes/health";
import type { AppEnv } from "./types";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", requestId());
  app.use("*", secureHeaders({ crossOriginResourcePolicy: "same-site" }));
  app.use(
    "*",
    cors({
      origin: config.corsOrigins,
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      exposeHeaders: ["Retry-After", "X-Request-Id"],
      maxAge: 600,
    }),
  );

  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    if (c.req.path.startsWith("/health")) return;
    const ms = Math.round(performance.now() - started);
    const level = c.res.status >= 500 ? "error" : c.res.status >= 400 ? "warn" : "info";
    logger[level]({ method: c.req.method, path: c.req.path, status: c.res.status, ms, requestId: c.get("requestId"), userId: c.get("user")?.id }, "request");
  });

  app.use(
    "/v1/*",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) => c.json({ error: { code: "payload_too_large", message: "Request body is too large" } }, 413),
    }),
  );
  // Global per-client ceiling; feature routes add tighter limits for expensive endpoints.
  app.use("/v1/*", rateLimit({ name: "global", capacity: 600, windowMs: 60_000 }));

  app.route("/health", healthRoutes);
  registerRoutes(app);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      // Local AI being offline is an expected, user-facing condition — not a server error.
      if (err instanceof AIUnavailableError) logger.warn({ requestId: c.get("requestId") }, err.message);
      else if (!err.expose || err.status >= 500) logger.error({ err, cause: err.cause, requestId: c.get("requestId") }, err.message);
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    }
    if (err instanceof HTTPException) {
      return c.json({ error: { code: "http_error", message: err.message } }, err.status);
    }
    logger.error({ err, requestId: c.get("requestId") }, "unhandled error");
    return c.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
