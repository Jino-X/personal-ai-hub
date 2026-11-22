import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { config } from "../config";
import { tooManyRequests } from "./errors";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * In-memory token-bucket rate limiter.
 * Suitable for the single-instance personal deployment this MVP targets; swap the
 * store for Redis/Upstash when running multiple API instances.
 */
export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;

  constructor(
    private readonly capacity: number,
    windowMs: number,
  ) {
    this.refillPerMs = capacity / windowMs;
    setInterval(() => this.sweep(), 5 * 60_000).unref();
  }

  /** Returns 0 when allowed, otherwise the number of seconds to wait. */
  take(key: string, cost = 1): number {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.updatedAt) * this.refillPerMs);
    bucket.updatedAt = now;
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.buckets.set(key, bucket);
      return 0;
    }
    this.buckets.set(key, bucket);
    return Math.ceil((cost - bucket.tokens) / this.refillPerMs / 1000);
  }

  private sweep() {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [key, bucket] of this.buckets) if (bucket.updatedAt < cutoff) this.buckets.delete(key);
  }
}

export function clientIp(c: Context): string {
  if (config.trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

interface RateLimitOptions {
  name: string;
  capacity: number;
  windowMs: number;
  /** Defaults to the authenticated user id, falling back to client IP. */
  key?: (c: Context) => string;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const limiter = new TokenBucketLimiter(options.capacity, options.windowMs);
  return async (c, next) => {
    const user = c.get("user") as { id: string } | undefined;
    const key = `${options.name}:${options.key ? options.key(c) : (user?.id ?? clientIp(c))}`;
    const wait = limiter.take(key);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      throw tooManyRequests(wait);
    }
    await next();
  };
}
