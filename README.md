# Personal AI Hub

A personal operating system that combines **productivity**, **AI & developer intelligence**, a
**knowledge vault** and an **AI assistant**, with inference running on **your own Mac** through
Ollama (Qwen3 8B by default). The web app and API are cloud-hosted; your models are not exposed to
the internet.

- **Dashboard** — greeting, today's tasks, upcoming events, goal progress, latest AI and developer
  updates, recently saved knowledge, watchlist alerts, local-AI status and the daily briefing, in
  widgets you can show, hide and reorder.
- **Productivity** — tasks with priorities (low → urgent), due dates, reminders, tags, categories,
  recurrence and projects; goals with measurable milestones; learning paths with lessons and
  resources; a skills tracker; a calendar (local events + optional Google Calendar sync); weekly
  stats; AI "plan my day" and weekly progress analysis.
- **AI Intelligence Center** — Hugging Face trending models and Daily Papers, GitHub Trending and
  releases, arXiv, AI lab and tech-press RSS, Product Hunt. Every item keeps its original link,
  source date and source metrics; AI summaries, "why it matters", category, technologies and a
  personal relevance score are clearly labelled as AI output. Search, filters, sorting, bookmarks,
  read state, duplicate detection and in-depth explanations.
- **Developer Intelligence** — releases and changelogs for React, Next.js, Node.js, Express,
  Python/FastAPI, PostgreSQL/Supabase, AWS, AI frameworks, MCP, agent orchestration and local LLM
  tools, filterable by technology, with AI explanations of technical changes.
- **Watchlist** — follow companies, models, repositories, frameworks, technologies, topics and
  keywords; get grouped alerts when something relevant appears.
- **Knowledge Vault** — save articles, GitHub repos (README imported), arXiv/Hugging Face papers,
  docs, URLs and notes into folders with tags. Local embeddings in pgvector power semantic and
  hybrid search, automatic categorisation, and question answering with source citations.
- **AI Assistant** — streaming chat on your local model that searches your knowledge, AI news and
  tasks, recommends repositories, explains models and writes progress reports. Anything that
  changes your data (tasks, reminders, notes) is proposed and only happens after you confirm.
- **Briefings** — daily and weekly briefings built strictly from your stored data, with an
  AI-written narrative on top.

See **[docs/architecture.md](docs/architecture.md)** for the design and
**[docs/companion-protocol.md](docs/companion-protocol.md)** for the device protocol.

## Tech stack

| Layer | Stack |
| --- | --- |
| Web | Next.js 16.4 (App Router, Turbopack, Cache Components, React Compiler, `proxy.ts`), React 19.3, Tailwind CSS v4, shadcn/ui (Radix), TanStack Query 5, next-themes, cmdk, sonner |
| API | Node.js 24, Hono 4, Supabase JS, zod 4, jose, ws, croner, undici, Mozilla Readability, cheerio, pino |
| Data | Supabase Postgres 17, Row Level Security, pgvector (HNSW), pg_trgm, full-text search |
| AI | Ollama, `qwen3:8b` (chat, tool calling, structured output, optional reasoning), `qwen3-embedding:0.6b` (1024-dim embeddings) |
| Companion | Python 3.11+, httpx, websockets, pydantic v2, uv |
| Tooling | pnpm 11 workspaces, Turborepo, TypeScript 7 (native compiler) |

## Repository layout

```
apps/
  web/         Next.js app — 15 pages under src/app/(app)
  api/         Hono API — routes/, agents/, ai/, devices/, jobs/, lib/
  companion/   Python local AI companion (hub-companion CLI)
packages/
  shared/      Domain constants, types and zod schemas
supabase/
  migrations/  Schema, RLS, pgvector, SQL functions, reference data
docs/          Architecture and companion protocol
```

## Getting started

### 1. Prerequisites

- Node.js 24+ and pnpm 11 (`corepack enable`)
- A Supabase project — hosted, or local with the [Supabase CLI](https://supabase.com/docs/guides/cli) (needs Docker)
- On your Mac: [Ollama](https://ollama.com), Python 3.11+ and [uv](https://docs.astral.sh/uv/)

```bash
pnpm install
```

### 2. Database

Local:

```bash
supabase start          # prints the API URL and keys
supabase db reset       # applies supabase/migrations
```

Hosted:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

In the Supabase dashboard (Authentication → URL configuration) set the Site URL to your web app and
add `<web-app-url>/auth/callback` as a redirect URL.

### 3. API

```bash
cp apps/api/.env.example apps/api/.env
openssl rand -base64 48   # → DEVICE_TOKEN_SECRET
openssl rand -base64 32   # → ENCRYPTION_KEY
```

Fill in `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (and
`SUPABASE_JWT_SECRET` only for projects on legacy HS256 JWT secrets). For a personal deployment,
set `ALLOWED_EMAILS` to your email. Optional: `GITHUB_TOKEN`, `HF_TOKEN`, `PRODUCT_HUNT_TOKEN`,
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.

### 4. Web app

```bash
cp apps/web/.env.example apps/web/.env.local
# NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_API_URL
```

### 5. Run

```bash
pnpm dev                 # API on :8787 and web on :3000 (Turborepo)
```

Open http://localhost:3000, create an account, then go to **Settings → AI & devices → Pair a device**.

### 6. Local AI companion (on your Mac)

```bash
ollama pull qwen3:8b
ollama pull qwen3-embedding:0.6b
uv tool install ./apps/companion
hub-companion doctor
hub-companion pair --server http://localhost:8787 --code ABCD-EFGH   # code from Settings → AI
hub-companion run
```

The header's status dot turns green when local AI is available. Ingestion starts automatically;
use **Refresh** on any intelligence page to fetch immediately. See
[apps/companion/README.md](apps/companion/README.md) for configuration and running it at login.

## Configuration reference

| Variable (API) | Purpose |
| --- | --- |
| `PUBLIC_API_URL`, `WEB_APP_URL`, `CORS_ORIGINS` | Public URLs (pairing instructions, OAuth redirects, CORS) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET` | Database and auth verification |
| `ALLOWED_EMAILS` | Restrict the workspace to specific accounts |
| `DEVICE_TOKEN_SECRET` | Signs 15-minute device access tokens |
| `ENCRYPTION_KEY` | AES-256-GCM key for integration tokens at rest |
| `OLLAMA_DIRECT_URL` | Optional: API calls Ollama directly when on the same host/private network |
| `OPENAI_COMPATIBLE_*` | Optional cloud provider; used only if a user enables cloud fallback |
| `AI_REQUEST_TIMEOUT_MS` | Inference timeout |
| `GITHUB_TOKEN`, `HF_TOKEN`, `PRODUCT_HUNT_TOKEN` | Higher rate limits / enable Product Hunt |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Calendar (redirect URI: `<PUBLIC_API_URL>/v1/integrations/google/callback`) |
| `WORKER_ENABLED`, `SCHEDULER_ENABLED`, `WORKER_CONCURRENCY` | Background processing |

AI model settings (provider, chat/embedding model, context length, temperature, reasoning, cloud
fallback) are per user in **Settings → AI & devices**.

## Deployment

| Part | Suggested target | Notes |
| --- | --- | --- |
| Database & auth | Supabase (hosted) | `supabase db push` |
| API | Any container host (Fly.io, Railway, Render, a VPS) | `docker build -f apps/api/Dockerfile .` — run **one instance** (the device gateway and rate limiter are in-memory); serve over HTTPS so companions use `wss://`; set `TRUST_PROXY=true` behind a proxy |
| Web | Vercel (root directory `apps/web`) or any Node host | Set the three `NEXT_PUBLIC_*` variables |
| Companion | Your Mac | `uv tool install ./apps/companion`; LaunchAgent template in `apps/companion/launchd/` |

## Security & privacy

- Supabase Auth; the API verifies JWTs locally and queries as the user so **Row Level Security**
  applies; composite foreign keys prevent cross-user references; secret tables are inaccessible to
  clients.
- Ollama is never exposed: the companion only makes outbound connections; device tokens are
  short-lived and rotate, with refresh-token reuse detection and instant revocation.
- Rate limiting, request validation (zod) on every endpoint, body size limits, secure headers,
  SSRF-safe fetching of user-supplied URLs, encrypted integration tokens, audit logs for sensitive
  actions, and explicit confirmation for assistant actions.
- Retrieved content is treated as untrusted data in prompts; AI output is always labelled and
  grounded in stored sources.
- Full JSON export and account deletion in **Settings → General**.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run API and web in watch mode |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Type-check all packages (TypeScript 7) |
| `pnpm lint` | Lint (ESLint for web; the web app pins the TS 6 API side by side because typescript-eslint doesn't support TS 7 yet) |

## Out of scope for this MVP

Multi-tenant subscriptions, voice, email integration, autonomous financial actions, unrestricted
autonomous browsing, social features and custom model training. The modular agent, provider and
source abstractions are designed so these can be added without rewriting the core.
