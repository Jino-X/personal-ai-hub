import type { Context } from "hono";
import type { z } from "zod";
import { badRequest, validationError } from "./errors";

function formatIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/** Parses and validates a JSON request body. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const result = schema.safeParse(json);
  if (!result.success) throw validationError(formatIssues(result.error));
  return result.data;
}

/** Validates query-string parameters. */
export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw validationError(formatIssues(result.error));
  return result.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads and validates a UUID route parameter. */
export function idParam(c: Context, name = "id"): string {
  const value = c.req.param(name);
  if (!value || !UUID_RE.test(value)) throw badRequest(`Invalid ${name}`);
  return value;
}

/** Drops keys whose value is undefined so partial updates only touch provided fields. */
export function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Escapes a value for use inside a PostgREST `ilike` / `or` filter. */
export function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (m) => `\\${m}`).replace(/[,()]/g, " ");
}
