# Local AI companion protocol (v1)

The companion (`apps/companion`) connects **outbound** to the API, authenticates as a device, and
executes inference jobs against the local Ollama instance. Ollama is never reachable from the
network.

## 1. Pairing

1. The signed-in user calls `POST /v1/devices/pairing-codes` (web: Settings → AI → *Pair a device*).
   The API stores the SHA-256 hash of an 8-character one-time code that expires after 10 minutes.
2. On the Mac: `hub-companion pair --server <API URL> --code ABCD-EFGH`
   → `POST /v1/devices/pair` `{code, name, platform, companion_version}` (rate limited per IP).
3. The API atomically consumes the code, creates a `local_ai_devices` row and returns:

```json
{
  "device_id": "uuid",
  "refresh_token": "base64url (256-bit)",
  "access_token": "JWT (HS256, 15 min, aud=hub-device)",
  "access_token_expires_at": "ISO-8601",
  "connect_url": "wss://api.example.com/v1/devices/connect"
}
```

Only the refresh token's hash is stored server-side. The companion writes it to
`~/Library/Application Support/hub-companion/credentials.json` (`0600`).

## 2. Tokens

`POST /v1/devices/token` `{device_id, refresh_token}` → new access token **and a new refresh token**
(rotation on every use). Presenting the previous refresh token more than 2 minutes after it was
rotated is treated as theft: the device is revoked and must be paired again. A retry inside that
window (lost response) is accepted.

## 3. WebSocket session

`GET /v1/devices/connect` with `Authorization: Bearer <access token>` (upgrade). The API rejects the
upgrade with `401`/`403` before any WebSocket is opened if the token or device is invalid.

All frames are JSON text. Device → server messages are schema-validated.

| Direction | `type` | Fields |
| --- | --- | --- |
| S → D | `welcome` | `protocol`, `device_id`, `server_time`, `heartbeat_interval_ms`, `token_expires_at` |
| D → S | `hello` | `companion_version`, `platform`, `health` |
| D → S | `heartbeat` | `health` (every `heartbeat_interval_ms`) |
| S → D | `job` | `job_id`, `op` (`chat` \| `embed` \| `health`), `payload`, `timeout_ms` |
| D → S | `chunk` | `job_id`, `data` — one Ollama streaming object (`stream: true` chat only) |
| D → S | `result` | `job_id`, `data` — full Ollama response (or `{}` after a stream) |
| D → S | `job_error` | `job_id`, `error: {code, message, retryable}` |
| S → D | `cancel` | `job_id` (client disconnected, timeout, user aborted) |
| D → S | `reauth` | `access_token` — renewed before expiry |
| S → D | `reauth_ok` | `token_expires_at` |
| S → D | `error` | `code`, `message` |

`health` = `{ollama_reachable, ollama_version, models[], running_models[], active_jobs, companion_version, platform}`.

### Close codes

| Code | Meaning | Companion behaviour |
| --- | --- | --- |
| `4000` | Replaced by a newer connection from the same device | reconnect |
| `4001` | Access token expired/invalid | refresh token, reconnect |
| `4003` | Device revoked by the user | stop, ask to re-pair |
| `1001` | Server shutting down | reconnect with backoff |

## 4. Job payloads

`chat` payloads use Ollama's `/api/chat` shape (`model`, `messages`, `stream`, `think`, `format`,
`tools`, `options.{num_ctx,temperature,num_predict}`, `keep_alive`). `embed` payloads use
`/api/embed` (`model`, `input[]`, `truncate`). The companion rebuilds every request from these
allow-listed fields, enforces its own limits (`HUB_COMPANION_MAX_*`) and model allow-list, and
forwards nothing else.

## 5. Liveness & recovery

- The API pings every 30 s and terminates silent connections; heartbeats refresh device health
  (persisted at most once a minute).
- In-flight jobs on a dropped connection fail with a *retryable* error; the API's `AIService`
  retries them, and durable background jobs are re-queued by the job worker.
- The companion reconnects with exponential backoff (1 s → 60 s, ±30 % jitter).
