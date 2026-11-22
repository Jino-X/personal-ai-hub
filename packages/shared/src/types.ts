import type {
  ActionStatus,
  AgentName,
  AISettings,
  AIStatus,
  BriefingKind,
  CategorySlug,
  DashboardWidgetId,
  GoalStatus,
  GoalType,
  IndexStatus,
  IntegrationProvider,
  IntelligenceFeed,
  JobStatus,
  KnowledgeDocType,
  LearningResourceKind,
  LearningResourceStatus,
  MilestoneKind,
  NotificationKind,
  ProjectStatus,
  RecurrenceFreq,
  SourceKind,
  TaskPriority,
  TaskStatus,
  WatchKind,
} from "./constants";

/** ISO-8601 timestamp string (timestamptz). */
export type Timestamp = string;
/** ISO-8601 calendar date string (YYYY-MM-DD). */
export type DateString = string;

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// ── Users & preferences ─────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DashboardWidgetConfig {
  id: DashboardWidgetId;
  visible: boolean;
}

export interface UserPreferences {
  user_id: string;
  theme: "dark" | "light" | "system";
  dashboard_widgets: DashboardWidgetConfig[];
  interest_categories: CategorySlug[];
  interest_keywords: string[];
  muted_source_ids: string[];
  ai_settings: Partial<AISettings>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface NotificationPreferences {
  user_id: string;
  daily_briefing_enabled: boolean;
  daily_briefing_time: string; // HH:MM[:SS]
  weekly_briefing_enabled: boolean;
  weekly_briefing_day: number; // 0 = Sunday
  task_reminders_enabled: boolean;
  watchlist_alerts_enabled: boolean;
  min_alert_relevance: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Notification {
  id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown>;
  read_at: Timestamp | null;
  created_at: Timestamp;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  actor: "user" | "assistant" | "system" | "device";
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Timestamp;
}

// ── Productivity ────────────────────────────────────────────────────────────
export interface Recurrence {
  freq: RecurrenceFreq;
  interval: number;
  until?: DateString | null;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  status: ProjectStatus;
  goal_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Task {
  id: string;
  user_id: string;
  project_id: string | null;
  goal_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category: string | null;
  tags: string[];
  due_at: Timestamp | null;
  remind_at: Timestamp | null;
  reminder_sent_at: Timestamp | null;
  recurrence: Recurrence | null;
  recurrence_parent_id: string | null;
  completed_at: Timestamp | null;
  sort_order: number;
  source: "user" | "assistant" | "recurrence" | "briefing";
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  type: GoalType;
  status: GoalStatus;
  target_date: DateString | null;
  progress: number;
  color: string | null;
  completed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface GoalMilestone {
  id: string;
  goal_id: string;
  user_id: string;
  title: string;
  description: string | null;
  kind: MilestoneKind;
  target_value: number | null;
  current_value: number;
  unit: string | null;
  due_date: DateString | null;
  completed_at: Timestamp | null;
  sort_order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface GoalWithDetails extends Goal {
  milestones: GoalMilestone[];
  resources: LearningResource[];
  open_task_count: number;
}

export interface Skill {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  level: number;
  target_level: number;
  notes: string | null;
  last_practiced_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface LearningResource {
  id: string;
  user_id: string;
  goal_id: string | null;
  title: string;
  url: string | null;
  kind: LearningResourceKind;
  status: LearningResourceStatus;
  notes: string | null;
  completed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  integration_id: string | null;
  source: "local" | "google";
  external_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  starts_at: Timestamp;
  ends_at: Timestamp | null;
  all_day: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProductivityStats {
  range: { start: DateString; end: DateString };
  completed_per_day: { date: DateString; count: number }[];
  completed_total: number;
  created_total: number;
  overdue_open: number;
  open_by_priority: Record<TaskPriority, number>;
  goals: { id: string; title: string; progress: number; status: GoalStatus }[];
}

// ── Intelligence ────────────────────────────────────────────────────────────
export interface IntelligenceCategory {
  id: string;
  slug: CategorySlug;
  name: string;
  description: string | null;
}

export interface NewsSource {
  id: string;
  user_id: string | null;
  kind: SourceKind;
  name: string;
  url: string | null;
  feed: IntelligenceFeed;
  config: Record<string, unknown>;
  enabled: boolean;
  fetch_interval_minutes: number;
  weight: number;
  last_fetched_at: Timestamp | null;
  last_success_at: Timestamp | null;
  last_error: string | null;
  consecutive_failures: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Row returned by the intelligence_feed() database function. */
export interface FeedItem {
  id: string;
  feed: IntelligenceFeed;
  url: string;
  title: string;
  source_name: string;
  author: string | null;
  published_at: Timestamp | null;
  fetched_at: Timestamp;
  category_slug: CategorySlug | null;
  category_name: string | null;
  /** Content taken verbatim from the original source (trimmed). */
  source_excerpt: string | null;
  /** Metrics exactly as reported by the source API (stars, downloads, upvotes...). */
  metadata: Record<string, unknown>;
  technologies: string[];
  /** Developer tech-topic slugs (see TECH_TOPICS). */
  topics: string[];
  /** AI-generated fields — always presented as AI output, never as source content. */
  ai_summary: string | null;
  ai_why_it_matters: string | null;
  ai_status: AIStatus;
  ai_model: string | null;
  importance_score: number;
  relevance_score: number;
  is_read: boolean;
  is_bookmarked: boolean;
  duplicate_count: number;
}

export interface Bookmark {
  id: string;
  user_id: string;
  item_id: string;
  note: string | null;
  created_at: Timestamp;
}

export interface Watchlist {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string | null;
  notify: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface WatchlistItem {
  id: string;
  watchlist_id: string;
  user_id: string;
  kind: WatchKind;
  value: string;
  match_terms: string[];
  last_checked_at: Timestamp | null;
  last_seen_release: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface WatchlistWithItems extends Watchlist {
  items: (WatchlistItem & { match_count: number })[];
}

export interface WatchlistMatch {
  id: string;
  user_id: string;
  watchlist_item_id: string;
  item_id: string;
  matched_terms: string[];
  seen_at: Timestamp | null;
  created_at: Timestamp;
  watchlist_item?: Pick<WatchlistItem, "id" | "kind" | "value" | "watchlist_id">;
  item?: Pick<FeedItem, "id" | "title" | "url" | "source_name" | "published_at" | "feed" | "ai_summary">;
}

// ── Knowledge ───────────────────────────────────────────────────────────────
export interface KnowledgeFolder {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface KnowledgeDocument {
  id: string;
  user_id: string;
  folder_id: string | null;
  type: KnowledgeDocType;
  title: string;
  url: string | null;
  source_item_id: string | null;
  content: string | null;
  excerpt: string | null;
  ai_summary: string | null;
  auto_category: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  index_status: IndexStatus;
  index_error: string | null;
  indexed_at: Timestamp | null;
  embedding_model: string | null;
  chunk_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type KnowledgeDocumentSummary = Omit<KnowledgeDocument, "content">;

export interface KnowledgeMatch {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  title: string;
  url: string | null;
  doc_type: KnowledgeDocType;
  score: number;
}

export interface Citation {
  /** 1-based reference number used inline as [n]. */
  ref: number;
  kind: "knowledge" | "intelligence" | "task" | "goal";
  id: string;
  title: string;
  url: string | null;
  snippet: string;
}

export interface KnowledgeAnswer {
  answer: string;
  citations: Citation[];
  model: string | null;
}

// ── Assistant ───────────────────────────────────────────────────────────────
export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  model: string | null;
  pinned: boolean;
  last_message_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result_summary?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking: string | null;
  citations: Citation[];
  tool_calls: ToolCallRecord[] | null;
  status: "streaming" | "complete" | "error";
  model: string | null;
  error: string | null;
  created_at: Timestamp;
}

export interface AssistantAction {
  id: string;
  user_id: string;
  conversation_id: string;
  message_id: string | null;
  tool: string;
  arguments: Record<string, unknown>;
  summary: string;
  status: ActionStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  expires_at: Timestamp;
  decided_at: Timestamp | null;
  executed_at: Timestamp | null;
  created_at: Timestamp;
}

export type AssistantStreamEvent =
  | { type: "start"; conversation_id: string; message_id: string; model: string }
  | { type: "thinking"; delta: string }
  | { type: "delta"; delta: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; summary: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "action"; action: AssistantAction }
  | { type: "done"; message: Message; conversation: Conversation }
  | { type: "error"; code: string; message: string };

// ── Agents, jobs & briefings ────────────────────────────────────────────────
export interface AgentJob {
  id: string;
  user_id: string | null;
  agent: AgentName;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_at: Timestamp;
  locked_at: Timestamp | null;
  locked_by: string | null;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  last_error: string | null;
  result: Record<string, unknown> | null;
  dedupe_key: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface BriefingTaskRef {
  id: string;
  title: string;
  priority: TaskPriority;
  due_at: Timestamp | null;
  status: TaskStatus;
}

export interface BriefingItemRef {
  id: string;
  title: string;
  url: string;
  source_name: string;
  published_at: Timestamp | null;
  category: string | null;
  summary: string | null;
}

export interface BriefingContent {
  priorities: BriefingTaskRef[];
  overdue: BriefingTaskRef[];
  unfinished: BriefingTaskRef[];
  events: { id: string; title: string; starts_at: Timestamp; ends_at: Timestamp | null; all_day: boolean; location: string | null }[];
  ai_developments: BriefingItemRef[];
  developer_updates: BriefingItemRef[];
  learning: { goal_id: string; goal_title: string; next_steps: string[] }[];
  saved_research: { id: string; title: string; url: string | null; type: string }[];
  productivity?: {
    completed: number;
    created: number;
    completion_rate: number;
    completed_per_day: { date: DateString; count: number }[];
  };
  goals?: { id: string; title: string; progress: number; progress_delta: number | null; status: GoalStatus }[];
  /** AI-written sections, generated strictly from the data above. */
  ai?: {
    headline: string;
    summary: string;
    focus: string[];
    recommendations: string[];
  } | null;
}

export interface Briefing {
  id: string;
  user_id: string;
  kind: BriefingKind;
  period_start: DateString;
  period_end: DateString;
  title: string;
  content: BriefingContent;
  status: "pending" | "generating" | "ready" | "failed";
  ai_status: AIStatus;
  model: string | null;
  error: string | null;
  generated_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// ── Integrations & local AI devices ─────────────────────────────────────────
export interface ConnectedIntegration {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  status: "connected" | "error" | "disconnected";
  account_label: string | null;
  scopes: string[];
  config: Record<string, unknown>;
  last_synced_at: Timestamp | null;
  last_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface IntegrationStatus {
  provider: IntegrationProvider | "rss" | "ollama";
  name: string;
  description: string;
  configured: boolean;
  connected: boolean;
  scope: "server" | "user";
  detail: string | null;
  integration?: ConnectedIntegration | null;
}

export interface OllamaModelInfo {
  name: string;
  size?: number;
  family?: string | null;
  parameter_size?: string | null;
  quantization?: string | null;
}

export interface DeviceHealth {
  ollama_reachable: boolean;
  ollama_version: string | null;
  models: OllamaModelInfo[];
  running_models: string[];
  active_jobs: number;
  companion_version: string | null;
  platform: string | null;
  checked_at: Timestamp;
}

export interface LocalAIDevice {
  id: string;
  user_id: string;
  name: string;
  platform: string | null;
  companion_version: string | null;
  status: "active" | "revoked";
  last_seen_at: Timestamp | null;
  last_connected_at: Timestamp | null;
  health: Partial<DeviceHealth>;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** Live connection state from the API gateway (not stored). */
  online?: boolean;
}

export interface PairingCode {
  code: string;
  expires_at: Timestamp;
  server_url: string;
  command: string;
}

export interface AIRuntimeStatus {
  available: boolean;
  provider: "companion" | "ollama" | "openai_compatible" | null;
  reason: string | null;
  settings: AISettings;
  chat_model_available: boolean;
  embedding_model_available: boolean;
  devices: LocalAIDevice[];
  providers: { id: "companion" | "ollama" | "openai_compatible"; configured: boolean; available: boolean; detail: string | null }[];
  checked_at: Timestamp;
}

// ── Dashboard ───────────────────────────────────────────────────────────────
export interface DashboardSummary {
  profile: Pick<UserProfile, "display_name" | "timezone">;
  now: Timestamp;
  widgets: DashboardWidgetConfig[];
  tasks: { today: Task[]; overdue: Task[]; completed_today: number; open_total: number };
  events: CalendarEvent[];
  goals: Pick<Goal, "id" | "title" | "progress" | "status" | "type" | "target_date">[];
  intelligence: FeedItem[];
  developer: FeedItem[];
  knowledge: KnowledgeDocumentSummary[];
  watchlist_matches: WatchlistMatch[];
  briefing: Briefing | null;
  unread_notifications: number;
}
