import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./lib/auth";

export type AppVariables = {
  requestId: string;
  user: AuthUser;
  /** RLS-enforcing Supabase client acting as the current user. */
  db: SupabaseClient;
};

export type AppEnv = { Variables: AppVariables };
