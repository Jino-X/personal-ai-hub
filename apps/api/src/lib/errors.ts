import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly expose = true,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") => new AppError(403, "forbidden", message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const validationError = (details: unknown) => new AppError(422, "validation_error", "The request is invalid", details);
export const tooManyRequests = (retryAfterSec: number) =>
  new AppError(429, "rate_limited", "Too many requests — please slow down", { retry_after: retryAfterSec });
export const serviceUnavailable = (code: string, message: string) => new AppError(503, code, message);

/** Raised when no AI provider can serve a request (e.g. the local companion is offline). */
export class AIUnavailableError extends AppError {
  constructor(message = "Local AI is not available. Start the AI companion on your Mac or check Settings → AI.") {
    super(503, "ai_unavailable", message);
    this.name = "AIUnavailableError";
  }
}

/** Errors from upstream services (GitHub, Hugging Face, Ollama...). */
export class ExternalServiceError extends Error {
  constructor(
    public readonly service: string,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(`${service}: ${message}`);
    this.name = "ExternalServiceError";
  }
}

interface PostgrestLikeError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Maps a PostgREST / Postgres error onto an API error without leaking internals. */
export function dbError(error: PostgrestLikeError): AppError {
  switch (error.code) {
    case "23505":
      return conflict("This item already exists");
    case "23503":
      return badRequest("A referenced item does not exist or does not belong to you");
    case "23514":
    case "22P02":
    case "22007":
    case "22008":
      return badRequest("The request contains an invalid value");
    case "42501":
    case "PGRST301":
      return forbidden();
    case "PGRST116":
      return notFound();
    default:
      return new AppError(500, "database_error", "A database error occurred", undefined, false);
  }
}

/**
 * Unwraps a supabase-js result, throwing a mapped AppError on failure.
 * The database client is untyped, so callers state the row type via the generic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unwrap<T = any>(result: { data: unknown; error: PostgrestLikeError | null }, notFoundWhat?: string): T {
  if (result.error) {
    if (result.error.code === "PGRST116" && notFoundWhat) throw notFound(notFoundWhat);
    throw Object.assign(dbError(result.error), { cause: result.error });
  }
  if ((result.data === null || result.data === undefined) && notFoundWhat) throw notFound(notFoundWhat);
  return result.data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
