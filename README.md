# Personal AI Hub

A personal operating system that combines productivity, AI intelligence, developer updates, a personal
knowledge vault and an AI assistant — with **local AI inference** (Ollama + Qwen3) running on your Mac.

> Work in progress. See `docs/architecture.md` (added later in the build) for the full design.

## Monorepo layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 16 web app (App Router, React 19, Tailwind v4, shadcn/ui) |
| `apps/api` | Node.js API (Hono): REST + SSE, agent workers, scheduler, device gateway |
| `apps/companion` | Python local AI companion that bridges the cloud API to your local Ollama |
| `packages/shared` | Shared domain constants, types and zod validation schemas |
| `supabase` | Postgres migrations: schema, Row Level Security, pgvector |

## Requirements

- Node.js 24+ and pnpm 11
- A Supabase project (or the Supabase CLI for local development)
- Python 3.11+ and [uv](https://docs.astral.sh/uv/) for the companion
- [Ollama](https://ollama.com) on the machine that runs inference

```bash
pnpm install
```
