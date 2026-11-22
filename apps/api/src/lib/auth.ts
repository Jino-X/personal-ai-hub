import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { config } from "../config";
import { forbidden, unauthorized } from "./errors";

export interface AuthUser {
  id: string;
  email: string | null;
  /** The raw Supabase access token, forwarded to Postgres so RLS applies. */
  token: string;
  sessionId: string | null;
}

const issuer = `${config.supabase.url}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
});
const legacySecret = config.supabase.jwtSecret ? new TextEncoder().encode(config.supabase.jwtSecret) : null;

interface SupabaseClaims extends JWTPayload {
  email?: string;
  role?: string;
  session_id?: string;
  is_anonymous?: boolean;
}

/**
 * Verifies a Supabase Auth access token locally.
 * Asymmetric signing keys (ES256/RS256) are checked against the project's JWKS;
 * legacy HS256 tokens are checked against SUPABASE_JWT_SECRET when configured.
 */
export async function verifySupabaseToken(token: string): Promise<AuthUser> {
  let claims: SupabaseClaims;
  try {
    const { alg } = decodeProtectedHeader(token);
    const options = { issuer, audience: "authenticated", clockTolerance: 5 } as const;
    if (alg === "HS256") {
      if (!legacySecret) throw new Error("HS256 token but SUPABASE_JWT_SECRET is not configured");
      claims = (await jwtVerify<SupabaseClaims>(token, legacySecret, options)).payload;
    } else {
      claims = (await jwtVerify<SupabaseClaims>(token, jwks, options)).payload;
    }
  } catch {
    throw unauthorized("Your session is invalid or has expired. Please sign in again.");
  }

  if (!claims.sub || claims.role !== "authenticated" || claims.is_anonymous) {
    throw unauthorized();
  }

  const email = claims.email?.toLowerCase() ?? null;
  if (config.allowedEmails.length > 0 && (!email || !config.allowedEmails.includes(email))) {
    throw forbidden("This account is not allowed to use this workspace.");
  }

  return { id: claims.sub, email, token, sessionId: claims.session_id ?? null };
}

export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
