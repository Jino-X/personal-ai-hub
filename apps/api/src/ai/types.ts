export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Assistant tool calls (role = assistant). */
  tool_calls?: ToolCall[];
  /** Tool results (role = tool). */
  tool_name?: string;
  tool_call_id?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  contextLength?: number;
  maxTokens?: number;
  /** Enable reasoning ("thinking") output for models that support it (e.g. Qwen3). */
  think?: boolean;
  /** JSON Schema for structured output, or "json" for free-form JSON. */
  format?: Record<string, unknown> | "json";
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_duration_ms?: number;
}

export interface ChatChunk {
  content?: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  done?: boolean;
  usage?: ChatUsage;
}

export interface ChatResult {
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
  model: string;
  usage?: ChatUsage;
}

export interface EmbedOptions {
  model: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ModelInfo {
  name: string;
  size?: number;
  family?: string | null;
  parameter_size?: string | null;
  quantization?: string | null;
}

export interface ProviderHealth {
  available: boolean;
  detail: string | null;
  version?: string | null;
  models: ModelInfo[];
}

export type ProviderId = "companion" | "ollama" | "openai_compatible";

/**
 * The single seam between business logic and model inference.
 * Adding a new local runtime or cloud API means implementing this interface —
 * agents and routes never talk to a specific provider.
 */
export interface ModelProvider {
  readonly id: ProviderId;
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResult>;
  streamChat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatChunk>;
  embed(texts: string[], options: EmbedOptions): Promise<number[][]>;
  health(): Promise<ProviderHealth>;
  /** Chat model actually used (cloud providers may override the user's local model choice). */
  resolveChatModel(requested: string): string;
  resolveEmbeddingModel(requested: string): string;
}
