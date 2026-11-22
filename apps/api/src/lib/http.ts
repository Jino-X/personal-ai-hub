import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";
import { ExternalServiceError } from "./errors";

export const USER_AGENT = "PersonalAIHub/0.1 (+https://github.com/personal-ai-hub)";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  service: string;
  timeoutMs?: number;
  retries?: number;
  /** Base delay for exponential backoff (ms). */
  backoffMs?: number;
}

/**
 * fetch() for trusted, well-known upstream APIs (GitHub, Hugging Face, RSS...).
 * Adds a timeout, retries 429/5xx/network errors with exponential backoff + jitter,
 * and honours Retry-After.
 */
export async function fetchWithRetry(url: string, init: RequestInit & RetryOptions): Promise<Response> {
  const { service, timeoutMs = 20_000, retries = 2, backoffMs = 800, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...requestInit, headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === retries) {
        const body = await res.text().catch(() => "");
        throw new ExternalServiceError(service, `HTTP ${res.status} ${body.slice(0, 200)}`.trim(), res.status, retryable);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      await res.body?.cancel().catch(() => undefined);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : jitter(backoffMs, attempt));
    } catch (err) {
      if (err instanceof ExternalServiceError) throw err;
      lastError = err;
      if (attempt === retries) break;
      await sleep(jitter(backoffMs, attempt));
    }
  }
  const reason = lastError instanceof Error ? (lastError.name === "TimeoutError" ? "request timed out" : lastError.message) : "request failed";
  throw new ExternalServiceError(service, reason, undefined, true);
}

function jitter(base: number, attempt: number) {
  return base * 2 ** attempt + Math.random() * base;
}

// ── SSRF-safe fetching of user-supplied URLs ────────────────────────────────

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function assertPublicAddress(address: string) {
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  if (parsed.range() !== "unicast") {
    throw new UnsafeUrlError("URLs that resolve to private or internal addresses are not allowed");
  }
}

/** DNS lookup that refuses private/loopback/link-local targets at connect time (defeats DNS rebinding). */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as unknown as LookupAddress[];
    try {
      for (const a of list) assertPublicAddress(a.address);
    } catch (e) {
      return callback(e as NodeJS.ErrnoException, "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    const first = list[0];
    if (!first) return callback(new Error(`No addresses for ${hostname}`) as NodeJS.ErrnoException, "", 0);
    callback(null, first.address, first.family);
  });
};

const safeAgent = new Agent({ connect: { lookup: guardedLookup, timeout: 10_000 }, headersTimeout: 15_000, bodyTimeout: 20_000 });

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

/**
 * Fetches an untrusted URL (e.g. a link the user saves to the knowledge vault):
 * http(s) only, standard ports only, no private network targets, manual redirect
 * validation, response size cap and timeout.
 */
export async function safeFetchText(
  rawUrl: string,
  { maxBytes = 5 * 1024 * 1024, timeoutMs = 20_000, accept = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } = {},
): Promise<SafeFetchResult> {
  let current = new URL(rawUrl);
  const deadline = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop < 5; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") throw new UnsafeUrlError("Only http and https URLs are supported");
    if (current.username || current.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
    if (current.port && !["80", "443", "8080", "8443"].includes(current.port)) throw new UnsafeUrlError("Non-standard ports are not allowed");
    if (ipaddr.isValid(current.hostname.replace(/^\[|\]$/g, ""))) assertPublicAddress(current.hostname.replace(/^\[|\]$/g, ""));

    const res = await undiciFetch(current, {
      dispatcher: safeAgent,
      redirect: "manual",
      signal: deadline,
      headers: { "user-agent": USER_AGENT, accept },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!location) throw new ExternalServiceError("fetch", `Redirect without location (${res.status})`);
      current = new URL(location, current);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ExternalServiceError("fetch", `The page returned HTTP ${res.status}`, res.status);
    }

    const contentType = res.headers.get("content-type") ?? "";
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new ExternalServiceError("fetch", "The page is too large to import");

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new ExternalServiceError("fetch", "The page is too large to import");
        }
        chunks.push(value);
      }
    }
    const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase() ?? "utf-8";
    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(charset);
    } catch {
      decoder = new TextDecoder("utf-8");
    }
    return { url: current.toString(), status: res.status, contentType, body: decoder.decode(Buffer.concat(chunks)) };
  }
  throw new ExternalServiceError("fetch", "Too many redirects");
}
