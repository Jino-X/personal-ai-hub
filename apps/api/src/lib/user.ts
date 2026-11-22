import type { SupabaseClient } from "@supabase/supabase-js";
import { adminDb } from "./supabase";
import { safeTimezone } from "./time";

/** The user's IANA time zone (via the RLS client when available). */
export async function userTimezone(db: SupabaseClient | null, userId: string): Promise<string> {
  const client = db ?? adminDb;
  const query = client.from("users").select("timezone");
  const { data } = await (db ? query.single() : query.eq("id", userId).single());
  return safeTimezone((data as { timezone?: string } | null)?.timezone);
}
