import { jwtVerify, SignJWT } from "jose";
import { config } from "../../config";
import { enqueueJob } from "../../jobs/queue";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { decryptJson, encryptJson } from "../../lib/crypto";
import { errorMessage, ExternalServiceError } from "../../lib/errors";
import { fetchWithRetry } from "../../lib/http";
import { adminDb } from "../../lib/supabase";

/**
 * Google Calendar integration (read-only): OAuth 2.0 authorization code flow with
 * offline access, tokens encrypted at rest (AES-256-GCM), periodic event sync.
 */

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"];
const stateKey = new TextEncoder().encode(`${config.deviceTokenSecret}:google-oauth-state`);
export const GOOGLE_REDIRECT_URI = `${config.publicApiUrl}/v1/integrations/google/callback`;

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

export async function googleAuthUrl(userId: string): Promise<string> {
  if (!config.google) throw new ExternalServiceError("google", "Google Calendar is not configured on the server", 400, false);
  const state = await new SignJWT({ purpose: "google-oauth" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateKey);
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function verifyGoogleState(state: string): Promise<string> {
  const { payload } = await jwtVerify(state, stateKey, { algorithms: ["HS256"] });
  if (payload.purpose !== "google-oauth" || !payload.sub) throw new Error("invalid state");
  return payload.sub;
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number; id_token?: string }> {
  const res = await fetchWithRetry("https://oauth2.googleapis.com/token", {
    service: "google",
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.google!.clientId, client_secret: config.google!.clientSecret, ...body }).toString(),
    retries: 1,
  });
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; id_token?: string }>;
}

/** Exchanges the authorization code, stores encrypted tokens and queues the first sync. */
export async function completeGoogleConnection(userId: string, code: string) {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: GOOGLE_REDIRECT_URI });
  let email: string | null = null;
  if (tokens.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1]!, "base64url").toString("utf8")) as { email?: string };
      email = payload.email ?? null;
    } catch {
      /* label is optional */
    }
  }
  const { data: integration, error } = await adminDb
    .from("connected_integrations")
    .upsert(
      { user_id: userId, provider: "google_calendar", status: "connected", account_label: email, scopes: SCOPES, last_error: null, config: { calendar_id: "primary" } },
      { onConflict: "user_id,provider" },
    )
    .select("id")
    .single();
  if (error) throw error;

  const stored: GoogleTokens = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + tokens.expires_in * 1000 };
  if (!stored.refresh_token) {
    // Re-consent without a new refresh token: keep the one we already have.
    const { data: existing } = await adminDb.from("integration_credentials").select("ciphertext").eq("integration_id", integration.id).maybeSingle();
    if (existing) stored.refresh_token = decryptJson<GoogleTokens>(existing.ciphertext as string).refresh_token;
  }
  await adminDb.from("integration_credentials").upsert({ integration_id: integration.id, user_id: userId, ciphertext: encryptJson(stored), key_version: 1 });
  await enqueueJob({ agent: "productivity", kind: "calendar.sync_google", userId, payload: { integration_id: integration.id }, dedupeKey: `gcal:${integration.id}`, priority: 3 });
  return integration.id as string;
}

async function accessToken(integrationId: string): Promise<string> {
  const { data } = await adminDb.from("integration_credentials").select("ciphertext").eq("integration_id", integrationId).maybeSingle();
  if (!data) throw new ExternalServiceError("google", "credentials missing — reconnect Google Calendar", 401, false);
  const tokens = decryptJson<GoogleTokens>(data.ciphertext as string);
  if (tokens.expires_at - 60_000 > Date.now()) return tokens.access_token;
  if (!tokens.refresh_token) throw new ExternalServiceError("google", "no refresh token — reconnect Google Calendar", 401, false);
  const refreshed = await tokenRequest({ refresh_token: tokens.refresh_token, grant_type: "refresh_token" });
  const next: GoogleTokens = { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token ?? tokens.refresh_token, expires_at: Date.now() + refreshed.expires_in * 1000 };
  await adminDb.from("integration_credentials").update({ ciphertext: encryptJson(next), updated_at: new Date().toISOString() }).eq("integration_id", integrationId);
  return next.access_token;
}

export async function revokeGoogle(integrationId: string) {
  try {
    const { data } = await adminDb.from("integration_credentials").select("ciphertext").eq("integration_id", integrationId).maybeSingle();
    if (data) {
      const tokens = decryptJson<GoogleTokens>(data.ciphertext as string);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refresh_token ?? tokens.access_token)}`, { method: "POST", signal: AbortSignal.timeout(8_000) });
    }
  } catch {
    /* best effort */
  }
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

async function syncGoogle(integrationId: string, userId: string) {
  const token = await accessToken(integrationId);
  const timeMin = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const timeMax = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250", ...(pageToken ? { pageToken } : {}) });
    const res = await fetchWithRetry(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      service: "google",
      headers: { authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    events.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken && events.length < 2000);

  const rows = events
    .filter((e) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date))
    .map((e) => {
      const allDay = !e.start?.dateTime;
      return {
        user_id: userId,
        integration_id: integrationId,
        source: "google",
        external_id: e.id,
        calendar_id: "primary",
        title: (e.summary ?? "(No title)").slice(0, 300),
        description: e.description?.slice(0, 10_000) ?? null,
        location: e.location?.slice(0, 300) ?? null,
        url: e.htmlLink ?? null,
        starts_at: new Date(e.start!.dateTime ?? `${e.start!.date}T00:00:00Z`).toISOString(),
        ends_at: e.end?.dateTime || e.end?.date ? new Date(e.end.dateTime ?? `${e.end.date}T00:00:00Z`).toISOString() : null,
        all_day: allDay,
      };
    });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await adminDb.from("calendar_events").upsert(rows.slice(i, i + 200), { onConflict: "user_id,source,external_id" });
    if (error) throw error;
  }
  // Remove events in the window that no longer exist upstream.
  const keep = new Set(rows.map((r) => r.external_id));
  const { data: existing } = await adminDb
    .from("calendar_events")
    .select("id, external_id")
    .eq("integration_id", integrationId)
    .gte("starts_at", timeMin)
    .lt("starts_at", timeMax);
  const stale = (existing ?? []).filter((e) => !keep.has(e.external_id as string)).map((e) => e.id as string);
  if (stale.length) await adminDb.from("calendar_events").delete().in("id", stale);

  await adminDb.from("connected_integrations").update({ last_synced_at: new Date().toISOString(), status: "connected", last_error: null }).eq("id", integrationId);
  return { synced: rows.length, removed: stale.length };
}

export function registerCalendarSync() {
  registerJobHandler("calendar.sync_google", async ({ job }) => {
    const integrationId = String(job.payload.integration_id);
    try {
      return await syncGoogle(integrationId, job.user_id!);
    } catch (err) {
      await adminDb.from("connected_integrations").update({ status: "error", last_error: errorMessage(err).slice(0, 300) }).eq("id", integrationId);
      throw err;
    }
  });

  registerSchedule({
    name: "calendar.sync-google",
    pattern: "7,37 * * * *",
    run: async () => {
      const { data } = await adminDb.from("connected_integrations").select("id, user_id").eq("provider", "google_calendar").neq("status", "disconnected");
      for (const i of data ?? []) {
        await enqueueJob({ agent: "productivity", kind: "calendar.sync_google", userId: i.user_id as string, payload: { integration_id: i.id }, dedupeKey: `gcal:${i.id}`, priority: 6 });
      }
    },
  });
}
