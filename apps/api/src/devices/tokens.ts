import { jwtVerify, SignJWT } from "jose";
import { config } from "../config";
import { randomToken, sha256 } from "../lib/crypto";
import { adminDb } from "../lib/supabase";
import { audit } from "../lib/audit";
import { logger } from "../lib/logger";

/**
 * Device credentials:
 *  - access token: HS256 JWT, 15 minutes, used to open/keep the WebSocket.
 *  - refresh token: random 256-bit secret, stored only as a SHA-256 hash, rotated on
 *    every use. Presenting an already-rotated token revokes the device (theft detection).
 */

const secret = new TextEncoder().encode(config.deviceTokenSecret);
const ISSUER = "hub-api";
const AUDIENCE = "hub-device";
export const ACCESS_TOKEN_TTL_S = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 86_400_000;

export interface DeviceClaims {
  deviceId: string;
  userId: string;
  expiresAt: Date;
}

export async function signDeviceAccessToken(deviceId: string, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_S * 1000);
  const token = await new SignJWT({ uid: userId, typ: "device" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(deviceId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);
  return { token, expiresAt };
}

export async function verifyDeviceAccessToken(token: string): Promise<DeviceClaims> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
  if (payload.typ !== "device" || typeof payload.uid !== "string" || !payload.sub || !payload.exp) throw new Error("invalid device token");
  return { deviceId: payload.sub, userId: payload.uid, expiresAt: new Date(payload.exp * 1000) };
}

/** Creates (or replaces) the device's refresh token. Returns the plaintext once. */
export async function issueRefreshToken(deviceId: string): Promise<string> {
  const token = randomToken(32);
  const { error } = await adminDb.from("device_credentials").upsert({
    device_id: deviceId,
    refresh_token_hash: sha256(token),
    previous_token_hash: null,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
    rotated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`failed to store device credential: ${error.message}`);
  return token;
}

export type RotationResult =
  | { ok: true; refreshToken: string; userId: string }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "reuse" };

/** Validates and rotates a refresh token (compare-and-swap on the stored hash). */
export async function rotateRefreshToken(deviceId: string, presented: string): Promise<RotationResult> {
  const presentedHash = sha256(presented);
  const { data: device } = await adminDb.from("local_ai_devices").select("id, user_id, status").eq("id", deviceId).maybeSingle();
  if (!device) return { ok: false, reason: "invalid" };
  if (device.status !== "active") return { ok: false, reason: "revoked" };

  const { data: cred } = await adminDb.from("device_credentials").select("*").eq("device_id", deviceId).maybeSingle();
  if (!cred) return { ok: false, reason: "invalid" };

  if (cred.previous_token_hash && cred.previous_token_hash === presentedHash) {
    await revokeDevice(deviceId, device.user_id, "refresh_token_reuse");
    logger.warn({ deviceId }, "refresh token reuse detected — device revoked");
    return { ok: false, reason: "reuse" };
  }
  if (cred.refresh_token_hash !== presentedHash) return { ok: false, reason: "invalid" };
  if (new Date(cred.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };

  const next = randomToken(32);
  const { data: updated, error } = await adminDb
    .from("device_credentials")
    .update({
      refresh_token_hash: sha256(next),
      previous_token_hash: presentedHash,
      expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
      rotated_at: new Date().toISOString(),
    })
    .eq("device_id", deviceId)
    .eq("refresh_token_hash", presentedHash)
    .select("device_id");
  if (error || !updated?.length) return { ok: false, reason: "invalid" };
  return { ok: true, refreshToken: next, userId: device.user_id };
}

export async function revokeDevice(deviceId: string, userId: string, reason: string) {
  await adminDb.from("device_credentials").delete().eq("device_id", deviceId);
  await adminDb
    .from("local_ai_devices")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", deviceId)
    .eq("user_id", userId);
  await audit({ userId, actor: reason === "user_revoked" ? "user" : "system", action: "device.revoked", targetType: "device", targetId: deviceId, metadata: { reason } });
}
