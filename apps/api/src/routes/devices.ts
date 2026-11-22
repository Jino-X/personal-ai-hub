import { Hono } from "hono";
import { devicePairSchema, deviceRenameSchema, deviceTokenSchema, type LocalAIDevice, type PairingCode } from "@hub/shared";
import { config } from "../config";
import { deviceGateway } from "../devices/gateway";
import { ACCESS_TOKEN_TTL_S, issueRefreshToken, revokeDevice, rotateRefreshToken, signDeviceAccessToken } from "../devices/tokens";
import { audit } from "../lib/audit";
import { normalizePairingCode, randomPairingCode, sha256 } from "../lib/crypto";
import { AppError, notFound, unauthorized, unwrap } from "../lib/errors";
import { clientIp, rateLimit } from "../lib/rate-limit";
import { adminDb } from "../lib/supabase";
import { idParam, parseBody } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const PAIRING_CODE_TTL_MS = 10 * 60_000;
const byIp = (c: Parameters<typeof clientIp>[0]) => clientIp(c);

function withLiveState(device: LocalAIDevice): LocalAIDevice {
  return {
    ...device,
    online: deviceGateway.isOnline(device.id),
    health: deviceGateway.connectionHealth(device.id) ?? device.health,
  };
}

/**
 * Local AI device management.
 * Public endpoints (/pair, /token) are used by the companion and authenticate with
 * one-time pairing codes or rotating refresh tokens; everything else needs a user session.
 */
export const deviceRoutes = new Hono<AppEnv>()
  // ── Companion-facing (no user session) ────────────────────────────────────
  .post("/pair", rateLimit({ name: "device-pair", capacity: 10, windowMs: 15 * 60_000, key: byIp }), async (c) => {
    const body = await parseBody(c, devicePairSchema);
    const codeHash = sha256(normalizePairingCode(body.code));

    // Atomically consume the code (single use, unexpired).
    const { data: code } = await adminDb
      .from("device_pairing_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("code_hash", codeHash)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id, user_id")
      .maybeSingle();
    if (!code) throw new AppError(401, "invalid_pairing_code", "This pairing code is invalid or has expired. Generate a new one in Settings → AI.");

    const device = unwrap<LocalAIDevice>(
      await adminDb
        .from("local_ai_devices")
        .insert({ user_id: code.user_id, name: body.name, platform: body.platform ?? null, companion_version: body.companion_version ?? null })
        .select("*")
        .single(),
    );
    await adminDb.from("device_pairing_codes").update({ device_id: device.id }).eq("id", code.id);

    const refreshToken = await issueRefreshToken(device.id);
    const access = await signDeviceAccessToken(device.id, code.user_id);
    await audit({ userId: code.user_id, actor: "device", action: "device.paired", targetType: "device", targetId: device.id, metadata: { name: body.name, platform: body.platform }, c });
    await adminDb.from("notifications").insert({
      user_id: code.user_id,
      kind: "device",
      title: `New local AI device paired: ${body.name}`,
      body: "If this wasn't you, revoke it in Settings → AI.",
      link: "/settings/ai",
    });

    return c.json(
      {
        device_id: device.id,
        refresh_token: refreshToken,
        access_token: access.token,
        access_token_expires_at: access.expiresAt.toISOString(),
        access_token_ttl_s: ACCESS_TOKEN_TTL_S,
        connect_url: `${config.publicApiUrl.replace(/^http/, "ws")}/v1/devices/connect`,
      },
      201,
    );
  })
  .post("/token", rateLimit({ name: "device-token", capacity: 30, windowMs: 60_000, key: byIp }), async (c) => {
    const body = await parseBody(c, deviceTokenSchema);
    const rotation = await rotateRefreshToken(body.device_id, body.refresh_token);
    if (!rotation.ok) {
      if (rotation.reason === "revoked" || rotation.reason === "reuse") {
        throw new AppError(403, "device_revoked", "This device has been revoked. Pair it again from Settings → AI.");
      }
      throw unauthorized("Invalid or expired device credentials. Pair the device again.");
    }
    const access = await signDeviceAccessToken(body.device_id, rotation.userId);
    return c.json({
      refresh_token: rotation.refreshToken,
      access_token: access.token,
      access_token_expires_at: access.expiresAt.toISOString(),
      access_token_ttl_s: ACCESS_TOKEN_TTL_S,
    });
  })

  // ── User-facing ───────────────────────────────────────────────────────────
  .post("/pairing-codes", requireAuth, rateLimit({ name: "pairing-code", capacity: 10, windowMs: 60 * 60_000 }), async (c) => {
    const user = c.get("user");
    const code = randomPairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    unwrap(
      await adminDb.from("device_pairing_codes").insert({
        user_id: user.id,
        code_hash: sha256(normalizePairingCode(code)),
        expires_at: expiresAt.toISOString(),
      }),
    );
    await audit({ userId: user.id, actor: "user", action: "device.pairing_code_created", c });
    const response: PairingCode = {
      code,
      expires_at: expiresAt.toISOString(),
      server_url: config.publicApiUrl,
      command: `hub-companion pair --server ${config.publicApiUrl} --code ${code}`,
    };
    return c.json(response, 201);
  })
  .get("/", requireAuth, async (c) => {
    const rows = unwrap<LocalAIDevice[]>(
      await c.get("db").from("local_ai_devices").select("*").eq("status", "active").order("last_seen_at", { ascending: false, nullsFirst: false }),
    );
    return c.json({ items: rows.map(withLiveState) });
  })
  .patch("/:id", requireAuth, async (c) => {
    const id = idParam(c);
    const body = await parseBody(c, deviceRenameSchema);
    const { data } = await adminDb
      .from("local_ai_devices")
      .update({ name: body.name })
      .eq("id", id)
      .eq("user_id", c.get("user").id)
      .eq("status", "active")
      .select("*")
      .maybeSingle();
    if (!data) throw notFound("Device");
    return c.json(withLiveState(data as LocalAIDevice));
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = idParam(c);
    const user = c.get("user");
    const { data } = await c.get("db").from("local_ai_devices").select("id").eq("id", id).maybeSingle();
    if (!data) throw notFound("Device");
    await revokeDevice(id, user.id, "user_revoked");
    deviceGateway.disconnect(id, "revoked");
    return c.body(null, 204);
  });
