# hub-companion — local AI companion

A small Python service that runs on your Mac and lets the cloud-hosted Personal AI Hub API use
**your local Ollama models** (Qwen3 8B by default) without exposing Ollama to the internet.

```
Personal AI Hub API  ◀── outbound WSS (device token) ──  hub-companion  ──▶  Ollama (127.0.0.1:11434)
```

- **Outbound only** — the companion dials the API; nothing listens for inbound connections and
  Ollama stays bound to localhost.
- **Device authentication** — one-time pairing code → 15-minute access tokens + a rotating refresh
  token stored with `0600` permissions. Reusing an old refresh token revokes the device.
- **Untrusted job validation** — every job is rebuilt from an allow-list of fields, model names
  are checked against installed (and optionally allow-listed) models, and context/output sizes
  are capped locally.
- **Resilient** — heartbeats with health (Ollama version, installed/running models), automatic
  reconnect with jittered exponential backoff, in-band token renewal, job cancellation.

## Setup

```bash
# 1. Ollama + models
brew install ollama && ollama serve        # or the Ollama.app
ollama pull qwen3:8b
ollama pull qwen3-embedding:0.6b

# 2. Install the companion (uv: https://docs.astral.sh/uv/)
uv tool install ./apps/companion           # puts `hub-companion` on your PATH
hub-companion doctor                        # checks Ollama + recommended models

# 3. Pair: in the web app open Settings → AI → "Pair a device" and copy the command
hub-companion pair --server https://your-api.example.com --code ABCD-EFGH

# 4. Run
hub-companion run
```

For development you can also run it without installing: `cd apps/companion && uv run hub-companion run`.

To start automatically at login, see `launchd/com.personalaihub.companion.plist`.

## Configuration

Environment variables (or a `.env` file in the working directory) — see `.env.example`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HUB_COMPANION_OLLAMA_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint |
| `HUB_COMPANION_ALLOWED_MODELS` | _(any installed)_ | Comma-separated model allow-list |
| `HUB_COMPANION_MAX_CONCURRENT_JOBS` | `2` | Parallel inference jobs |
| `HUB_COMPANION_MAX_CONTEXT_LENGTH` | `32768` | Upper bound for `num_ctx` |
| `HUB_COMPANION_MAX_OUTPUT_TOKENS` | `8192` | Upper bound for `num_predict` |
| `HUB_COMPANION_ALLOW_INSECURE` | `false` | Allow `http://` to non-local servers (dev only) |

## Commands

| Command | Description |
| --- | --- |
| `hub-companion pair --server URL --code CODE` | Pair this Mac with your account |
| `hub-companion run` | Connect and serve jobs (default) |
| `hub-companion doctor` | Check Ollama, models and pairing |
| `hub-companion status` | Show pairing details |
| `hub-companion unpair` | Remove local credentials (also revoke in the web app) |

The wire protocol is documented in [`docs/companion-protocol.md`](../../docs/companion-protocol.md).
