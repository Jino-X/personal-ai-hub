import { DEFAULT_AI_SETTINGS, type AISettings } from "@hub/shared";
import { adminDb } from "../lib/supabase";

const cache = new Map<string, { value: AISettings; at: number }>();
const TTL_MS = 30_000;

export function mergeAISettings(stored: Partial<AISettings> | null | undefined): AISettings {
  return { ...DEFAULT_AI_SETTINGS, ...(stored ?? {}) };
}

/** Loads a user's AI settings (cached briefly; invalidated on update). */
export async function getAISettings(userId: string): Promise<AISettings> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { data } = await adminDb.from("user_preferences").select("ai_settings").eq("user_id", userId).maybeSingle();
  const value = mergeAISettings(data?.ai_settings as Partial<AISettings> | undefined);
  cache.set(userId, { value, at: Date.now() });
  return value;
}

export function invalidateAISettings(userId: string) {
  cache.delete(userId);
}
