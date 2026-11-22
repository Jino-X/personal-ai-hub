import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { "x-client-info": "hub-api" } },
} as const;

/**
 * Service-role client. Bypasses RLS — use only for system work (workers, ingestion,
 * device auth) and always filter by user_id explicitly.
 */
export const adminDb: SupabaseClient = createClient(config.supabase.url, config.supabase.secretKey, clientOptions);

/**
 * Request-scoped client that acts as the signed-in user, so Postgres Row Level
 * Security is enforced on every query.
 */
export function createUserDb(accessToken: string): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.publishableKey, {
    ...clientOptions,
    global: { headers: { ...clientOptions.global.headers, Authorization: `Bearer ${accessToken}` } },
  });
}
