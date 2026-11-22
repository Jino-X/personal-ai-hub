/**
 * Domain constants shared by the API and the web app.
 * Database CHECK constraints in supabase/migrations mirror these lists — keep them in sync.
 */

// ── Productivity ────────────────────────────────────────────────────────────
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = ["todo", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITY_WEIGHT: Record<TaskPriority, number> = { low: 1, medium: 2, high: 3, urgent: 4 };

export const RECURRENCE_FREQS = ["daily", "weekdays", "weekly", "monthly", "yearly"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const PROJECT_STATUSES = ["active", "on_hold", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const GOAL_TYPES = ["personal", "career", "learning", "health", "project"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const GOAL_STATUSES = ["active", "paused", "completed", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const MILESTONE_KINDS = ["milestone", "lesson"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const LEARNING_RESOURCE_KINDS = ["article", "video", "course", "book", "documentation", "repository", "other"] as const;
export type LearningResourceKind = (typeof LEARNING_RESOURCE_KINDS)[number];

export const LEARNING_RESOURCE_STATUSES = ["todo", "in_progress", "done"] as const;
export type LearningResourceStatus = (typeof LEARNING_RESOURCE_STATUSES)[number];

export const COLORS = ["slate", "red", "orange", "amber", "green", "teal", "sky", "blue", "violet", "pink"] as const;
export type ColorName = (typeof COLORS)[number];

// ── Intelligence ────────────────────────────────────────────────────────────
export const INTELLIGENCE_FEEDS = ["ai_news", "models", "products", "developer", "github_trending", "research"] as const;
export type IntelligenceFeed = (typeof INTELLIGENCE_FEEDS)[number];

export const SOURCE_KINDS = [
  "rss",
  "huggingface_models",
  "huggingface_papers",
  "github_trending",
  "github_releases",
  "arxiv",
  "product_hunt",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Source kinds that users may add themselves from the UI. */
export const USER_SOURCE_KINDS = ["rss", "github_releases", "arxiv"] as const;
export type UserSourceKind = (typeof USER_SOURCE_KINDS)[number];

export const AI_STATUSES = ["pending", "processing", "done", "failed", "skipped"] as const;
export type AIStatus = (typeof AI_STATUSES)[number];

export const INTELLIGENCE_CATEGORIES = [
  { slug: "llm", name: "Large Language Models", description: "Foundation and chat models, reasoning models, model releases." },
  { slug: "ai-agents", name: "AI Agents", description: "Agentic systems, tool use, computer use and orchestration." },
  { slug: "mcp", name: "MCP", description: "Model Context Protocol servers, clients and specification updates." },
  { slug: "open-source-ai", name: "Open-source AI", description: "Open-weight models, local inference and open tooling." },
  { slug: "image-video", name: "Image & Video", description: "Image, video and 3D generation." },
  { slug: "speech-audio", name: "Speech & Audio", description: "Speech recognition, text-to-speech, voice and music AI." },
  { slug: "ai-research", name: "AI Research", description: "Papers, benchmarks, datasets and research results." },
  { slug: "ai-dev-tools", name: "AI Developer Tools", description: "SDKs, frameworks, coding assistants and developer platforms." },
  { slug: "ai-startups", name: "AI Startups & Products", description: "Launches, funding, acquisitions and new AI products." },
] as const;
export type CategorySlug = (typeof INTELLIGENCE_CATEGORIES)[number]["slug"];
export const CATEGORY_SLUGS = INTELLIGENCE_CATEGORIES.map((c) => c.slug) as [CategorySlug, ...CategorySlug[]];

/** Technology topics tracked by the Developer Intelligence module. */
export const TECH_TOPICS = [
  { slug: "react", name: "React", keywords: ["react", "react.dev", "react compiler", "rsc", "server components"] },
  { slug: "nextjs", name: "Next.js", keywords: ["next.js", "nextjs", "vercel/next.js", "turbopack"] },
  { slug: "nodejs", name: "Node.js", keywords: ["node.js", "nodejs", "nodejs/node", "npm"] },
  { slug: "express", name: "Express", keywords: ["express", "expressjs"] },
  { slug: "python", name: "Python", keywords: ["python", "cpython", "pypi", "pep "] },
  { slug: "fastapi", name: "FastAPI", keywords: ["fastapi", "pydantic", "starlette"] },
  { slug: "postgresql", name: "PostgreSQL", keywords: ["postgres", "postgresql", "pgvector"] },
  { slug: "supabase", name: "Supabase", keywords: ["supabase"] },
  { slug: "aws", name: "AWS & Cloud", keywords: ["aws", "amazon web services", "lambda", "bedrock", "s3", "cloudflare", "gcp", "azure"] },
  { slug: "ai-frameworks", name: "AI Frameworks", keywords: ["langchain", "llamaindex", "llama_index", "ai sdk", "pydantic-ai", "pydantic ai", "transformers", "pytorch", "dspy"] },
  { slug: "mcp", name: "MCP Servers", keywords: ["mcp", "model context protocol"] },
  { slug: "agents", name: "Agent Orchestration", keywords: ["langgraph", "crewai", "autogen", "agents sdk", "multi-agent", "agent framework", "orchestration"] },
  { slug: "local-llm", name: "Local LLM Tools", keywords: ["ollama", "llama.cpp", "vllm", "lm studio", "mlx", "gguf", "local llm"] },
] as const;
export type TechTopicSlug = (typeof TECH_TOPICS)[number]["slug"];

export const WATCH_KINDS = ["company", "model", "repository", "framework", "technology", "topic", "keyword"] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

// ── Knowledge ───────────────────────────────────────────────────────────────
export const KNOWLEDGE_DOC_TYPES = ["article", "repository", "paper", "url", "note", "documentation", "ai_summary"] as const;
export type KnowledgeDocType = (typeof KNOWLEDGE_DOC_TYPES)[number];

export const INDEX_STATUSES = ["pending", "processing", "indexed", "failed"] as const;
export type IndexStatus = (typeof INDEX_STATUSES)[number];

// ── Agents & jobs ───────────────────────────────────────────────────────────
export const AGENT_NAMES = ["research", "ai_news", "developer", "productivity", "knowledge", "briefing", "watchlist", "system"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const BRIEFING_KINDS = ["daily", "weekly"] as const;
export type BriefingKind = (typeof BRIEFING_KINDS)[number];

export const ACTION_STATUSES = ["proposed", "confirmed", "rejected", "executed", "failed", "expired"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const NOTIFICATION_KINDS = ["task_reminder", "watchlist_match", "briefing_ready", "device", "system"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// ── AI configuration ────────────────────────────────────────────────────────
export const AI_PROVIDERS = ["auto", "companion", "ollama", "openai_compatible"] as const;
export type AIProviderSetting = (typeof AI_PROVIDERS)[number];

/** Vector dimension of knowledge_chunks.embedding. Changing it requires a migration and re-index. */
export const EMBEDDING_DIMENSIONS = 1024;

export const DEFAULT_AI_SETTINGS = {
  provider: "auto" as AIProviderSetting,
  chat_model: "qwen3:8b",
  embedding_model: "qwen3-embedding:0.6b",
  context_length: 8192,
  temperature: 0.4,
  thinking: false,
  allow_cloud_fallback: false,
};
export type AISettings = typeof DEFAULT_AI_SETTINGS;

// ── Integrations ────────────────────────────────────────────────────────────
export const INTEGRATION_PROVIDERS = ["google_calendar", "github", "huggingface", "product_hunt"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

// ── Dashboard ───────────────────────────────────────────────────────────────
export const DASHBOARD_WIDGETS = [
  { id: "briefing", title: "Daily briefing", description: "Your latest AI-generated daily briefing." },
  { id: "tasks", title: "Today's tasks", description: "Overdue tasks and what's due today." },
  { id: "events", title: "Upcoming events", description: "Calendar events for the next few days." },
  { id: "goals", title: "Goal progress", description: "Progress across your active goals." },
  { id: "intelligence", title: "Latest AI updates", description: "Top-ranked AI intelligence items." },
  { id: "developer", title: "Developer updates", description: "New releases and changelogs you follow." },
  { id: "knowledge", title: "Recently saved", description: "Latest items in your knowledge vault." },
  { id: "watchlist", title: "Watchlist alerts", description: "New matches from your watchlists." },
  { id: "ai_status", title: "Local AI", description: "Status of your local AI companion." },
] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number]["id"];
export const DASHBOARD_WIDGET_IDS = DASHBOARD_WIDGETS.map((w) => w.id) as [DashboardWidgetId, ...DashboardWidgetId[]];
