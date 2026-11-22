import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { INTELLIGENCE_FEEDS, TASK_PRIORITIES, type Briefing, type Citation, type FeedItem, type Task } from "@hub/shared";
import type { AIService } from "../../ai/service";
import type { ToolDefinition } from "../../ai/types";
import { unwrap } from "../../lib/errors";
import { dayBounds } from "../../lib/time";
import { retrieveKnowledge } from "../knowledge";
import { productivityStats } from "../productivity/stats";

export interface ToolContext {
  db: SupabaseClient;
  ai: AIService;
  userId: string;
  timezone: string;
  /** Shared, growing list so [n] references stay unique across tool calls. */
  citations: Citation[];
}

export interface ToolOutcome {
  /** JSON-serialisable content returned to the model. */
  content: unknown;
  /** Short human-readable summary shown in the UI. */
  summary: string;
}

interface ToolSpec<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** Consequential tools are never executed by the model — they create a proposal the user confirms. */
  requiresConfirmation: boolean;
  run?: (args: z.output<S>, ctx: ToolContext) => Promise<ToolOutcome>;
  describe?: (args: z.output<S>) => string;
}

function defineTool<S extends z.ZodType>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

function addCitations(ctx: ToolContext, items: Omit<Citation, "ref">[]): Citation[] {
  return items.map((c) => {
    const existing = ctx.citations.find((x) => x.kind === c.kind && x.id === c.id);
    if (existing) return existing;
    const citation = { ...c, ref: ctx.citations.length + 1 };
    ctx.citations.push(citation);
    return citation;
  });
}

const searchKnowledge = defineTool({
  name: "search_knowledge",
  description: "Search the user's personal knowledge vault (saved articles, notes, papers, repositories, docs). Use for anything the user may have saved or written.",
  schema: z.object({ query: z.string().min(2).max(300).describe("What to look for") }),
  requiresConfirmation: false,
  run: async ({ query }, ctx) => {
    const { matches } = await retrieveKnowledge(ctx.db, ctx.ai, query, { limit: 6 });
    const cites = addCitations(
      ctx,
      matches.map((m) => ({ kind: "knowledge" as const, id: m.document_id, title: m.title, url: m.url, snippet: m.content.slice(0, 280) })),
    );
    return {
      content: matches.map((m, i) => ({ ref: cites[i]!.ref, title: m.title, type: m.doc_type, url: m.url, excerpt: m.content.slice(0, 1500) })),
      summary: `Searched your knowledge vault for “${query}” — ${matches.length} result${matches.length === 1 ? "" : "s"}`,
    };
  },
});

const searchIntelligence = defineTool({
  name: "search_intelligence",
  description:
    "Search collected AI news, model releases, developer release notes, GitHub trending repositories and research papers. Returns real items with source links and dates.",
  schema: z.object({
    query: z.string().min(2).max(200).describe("Keywords, e.g. 'Qwen3', 'Next.js release', 'MCP'"),
    feed: z.enum(INTELLIGENCE_FEEDS).optional().describe("Optional feed filter: ai_news, models, products, developer, github_trending, research"),
    days: z.number().int().min(1).max(90).optional().describe("Only items from the last N days"),
  }),
  requiresConfirmation: false,
  run: async ({ query, feed, days }, ctx) => {
    const rows = unwrap<FeedItem[]>(
      await ctx.db.rpc("intelligence_feed", {
        p_feed: feed ?? null,
        p_search: query,
        p_since: days ? new Date(Date.now() - days * 86_400_000).toISOString() : null,
        p_sort: "relevance",
        p_limit: 8,
        p_offset: 0,
      }),
    );
    const cites = addCitations(
      ctx,
      rows.map((r) => ({ kind: "intelligence" as const, id: r.id, title: r.title, url: r.url, snippet: (r.ai_summary ?? r.source_excerpt ?? "").slice(0, 280) })),
    );
    return {
      content: rows.map((r, i) => ({
        ref: cites[i]!.ref,
        title: r.title,
        source: r.source_name,
        published_at: r.published_at,
        feed: r.feed,
        url: r.url,
        source_excerpt: (r.source_excerpt ?? "").slice(0, 900),
        ai_summary: r.ai_summary,
        metrics: r.metadata,
      })),
      summary: `Searched AI & developer intelligence for “${query}” — ${rows.length} item${rows.length === 1 ? "" : "s"}`,
    };
  },
});

const recommendRepositories = defineTool({
  name: "recommend_repositories",
  description: "Find GitHub repositories relevant to a topic from trending lists, tracked releases and the user's saved repositories.",
  schema: z.object({ topic: z.string().min(2).max(120) }),
  requiresConfirmation: false,
  run: async ({ topic }, ctx) => {
    const [trending, saved] = await Promise.all([
      ctx.db.rpc("intelligence_feed", { p_feed: "github_trending", p_search: topic, p_sort: "popular", p_limit: 6, p_offset: 0 }),
      ctx.db.from("knowledge_documents").select("id, title, url, ai_summary, excerpt").eq("type", "repository").textSearch("search", topic, { type: "websearch", config: "english" }).limit(4),
    ]);
    const repos = unwrap<FeedItem[]>(trending);
    const savedRepos = unwrap<{ id: string; title: string; url: string | null; ai_summary: string | null; excerpt: string | null }[]>(saved);
    const c1 = addCitations(ctx, repos.map((r) => ({ kind: "intelligence" as const, id: r.id, title: r.title, url: r.url, snippet: r.source_excerpt?.slice(0, 200) ?? "" })));
    const c2 = addCitations(ctx, savedRepos.map((r) => ({ kind: "knowledge" as const, id: r.id, title: r.title, url: r.url, snippet: (r.ai_summary ?? r.excerpt ?? "").slice(0, 200) })));
    return {
      content: {
        trending: repos.map((r, i) => ({ ref: c1[i]!.ref, repo: r.title, url: r.url, description: r.source_excerpt?.slice(0, 400), metrics: r.metadata })),
        saved: savedRepos.map((r, i) => ({ ref: c2[i]!.ref, repo: r.title, url: r.url, summary: r.ai_summary ?? r.excerpt })),
      },
      summary: `Looked for repositories about “${topic}” — ${repos.length + savedRepos.length} found`,
    };
  },
});

const listTasks = defineTool({
  name: "list_tasks",
  description: "List the user's tasks. Use for questions about what to do, deadlines and priorities.",
  schema: z.object({
    filter: z.enum(["open", "today", "overdue", "upcoming", "completed_this_week"]).default("open"),
  }),
  requiresConfirmation: false,
  run: async ({ filter }, ctx) => {
    const { start, end } = dayBounds(ctx.timezone);
    let q = ctx.db.from("tasks").select("id, title, status, priority, due_at, tags, completed_at").limit(40);
    if (filter === "completed_this_week") q = q.eq("status", "done").gte("completed_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("completed_at", { ascending: false });
    else {
      q = q.in("status", ["todo", "in_progress"]);
      if (filter === "today") q = q.gte("due_at", start.toISOString()).lt("due_at", end.toISOString());
      if (filter === "overdue") q = q.lt("due_at", new Date().toISOString());
      if (filter === "upcoming") q = q.gte("due_at", end.toISOString());
      q = q.order("priority_rank", { ascending: false }).order("due_at", { ascending: true, nullsFirst: false });
    }
    const tasks = unwrap<Partial<Task>[]>(await q);
    return { content: tasks, summary: `Checked your tasks (${filter.replace(/_/g, " ")}) — ${tasks.length}` };
  },
});

const progressSummary = defineTool({
  name: "get_progress_summary",
  description: "Get productivity statistics and goal progress for the last week or month. Use for progress summaries and weekly reports.",
  schema: z.object({ range: z.enum(["week", "month"]).default("week") }),
  requiresConfirmation: false,
  run: async ({ range }, ctx) => {
    const stats = await productivityStats(ctx.db, ctx.timezone, range);
    const { data: milestones } = await ctx.db
      .from("goal_milestones")
      .select("title, goal_id, completed_at")
      .gte("completed_at", new Date(Date.now() - (range === "week" ? 7 : 30) * 86_400_000).toISOString());
    return { content: { ...stats, milestones_completed: milestones ?? [] }, summary: `Pulled your ${range}ly progress` };
  },
});

const latestBriefing = defineTool({
  name: "get_latest_briefing",
  description: "Get the user's most recent daily or weekly briefing (priorities, events, AI developments).",
  schema: z.object({ kind: z.enum(["daily", "weekly"]).default("daily") }),
  requiresConfirmation: false,
  run: async ({ kind }, ctx) => {
    const { data } = await ctx.db.from("briefings").select("title, period_start, content").eq("kind", kind).eq("status", "ready").order("period_start", { ascending: false }).limit(1).maybeSingle();
    const b = data as Pick<Briefing, "title" | "period_start" | "content"> | null;
    return { content: b ?? { message: "No briefing has been generated yet." }, summary: b ? `Read your ${kind} briefing (${b.period_start})` : `No ${kind} briefing yet` };
  },
});

// ── Consequential tools (proposals only) ────────────────────────────────────

export const createTaskArgs = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(2000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  due_at: z.iso.datetime({ offset: true }).optional().describe("ISO 8601 with timezone offset"),
});

export const createReminderArgs = z.object({
  title: z.string().trim().min(1).max(300),
  remind_at: z.iso.datetime({ offset: true }).describe("ISO 8601 with timezone offset"),
});

export const saveNoteArgs = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(20_000).describe("Markdown content"),
  tags: z.array(z.string().max(40)).max(8).optional(),
});

const createTask = defineTool({
  name: "create_task",
  description: "Propose creating a task. The user must confirm it in the app before it is created.",
  schema: createTaskArgs,
  requiresConfirmation: true,
  describe: (a) => `Create task “${a.title}”${a.priority ? ` (${a.priority})` : ""}${a.due_at ? ` due ${new Date(a.due_at).toUTCString()}` : ""}`,
});

const createReminder = defineTool({
  name: "create_reminder",
  description: "Propose a reminder notification at a specific time. The user must confirm it.",
  schema: createReminderArgs,
  requiresConfirmation: true,
  describe: (a) => `Remind you “${a.title}” at ${new Date(a.remind_at).toUTCString()}`,
});

const saveNote = defineTool({
  name: "save_note",
  description: "Propose saving a note (e.g. a research summary) to the user's knowledge vault. The user must confirm it.",
  schema: saveNoteArgs,
  requiresConfirmation: true,
  describe: (a) => `Save note “${a.title}” to your knowledge vault`,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: ToolSpec<any>[] = [searchKnowledge, searchIntelligence, recommendRepositories, listTasks, progressSummary, latestBriefing, createTask, createReminder, saveNote];

export const TOOL_DEFINITIONS: ToolDefinition[] = TOOLS.map((t) => {
  const parameters = z.toJSONSchema(t.schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete parameters.$schema;
  return { name: t.name, description: t.description, parameters };
});

export function findTool(name: string) {
  return TOOLS.find((t) => t.name === name);
}
