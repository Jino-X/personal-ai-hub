import { createMiddleware } from "hono/factory";
import { bearerToken, verifySupabaseToken } from "../lib/auth";
import { unauthorized } from "../lib/errors";
import { createUserDb } from "../lib/supabase";
import type { AppEnv } from "../types";

/** Requires a valid Supabase session and exposes `user` and an RLS-scoped `db`. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c.req.header("authorization"));
  if (!token) throw unauthorized();
  const user = await verifySupabaseToken(token);
  c.set("user", user);
  c.set("db", createUserDb(token));
  await next();
});
