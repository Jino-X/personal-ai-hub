import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantAction, AssistantStreamEvent, Citation, Message, ToolCallRecord } from "@hub/shared";
import { dataBlock, GROUNDING_RULES, todayLine } from "../../ai/prompts";
import type { AIService } from "../../ai/service";
import type { ChatMessage, ToolCall } from "../../ai/types";
import { audit } from "../../lib/audit";
import { errorMessage, unwrap } from "../../lib/errors";
import { adminDb } from "../../lib/supabase";
import { enqueueIndex } from "../knowledge";
import { createReminderArgs, createTaskArgs, findTool, saveNoteArgs, TOOL_DEFINITIONS, type ToolContext } from "./tools";

const MAX_STEPS = 5;
const HISTORY_MESSAGES = 16;

function systemPrompt(timezone: string) {
  return `You are the personal AI assistant inside "Personal AI Hub", running on the user's own local model.
You help the user with: questions about their saved knowledge, AI news and developer updates, researching technical subjects, explaining AI models, recommending repositories, planning and creating tasks, and summarising progress (including weekly reports).

How to work:
- Use tools to look things up instead of guessing. search_knowledge for anything the user may have saved; search_intelligence for news, models, releases, papers and repositories; recommend_repositories for repo suggestions; list_tasks and get_progress_summary for productivity questions and weekly reports; get_latest_briefing for their briefing.
- When you use information from a tool result, cite it inline with its [n] reference number, e.g. "Qwen3 adds tool calling [2]".
- If tools return nothing relevant you may answer from general knowledge, but say clearly that it is general knowledge and may be out of date.
- create_task, create_reminder and save_note only PROPOSE an action: the user must confirm it in the app. Never say it has been done — say it is waiting for their confirmation.
- For times, use the user's time zone and ISO 8601 with offset.
- Format answers in concise Markdown.
${GROUNDING_RULES}
${todayLine(timezone)}`;
}

interface RunInput {
  db: SupabaseClient;
  ai: AIService;
  userId: string;
  timezone: string;
  conversationId: string;
  assistantMessageId: string;
  history: Pick<Message, "role" | "content">[];
  userText: string;
  think: boolean;
  signal: AbortSignal;
}

export interface RunResult {
  content: string;
  thinking: string;
  citations: Citation[];
  toolCalls: ToolCallRecord[];
  model: string;
}

/**
 * Runs one assistant turn: streams model output, executes read-only tools, turns
 * consequential tool calls into confirmable proposals, and loops until the model answers.
 */
export async function* runAssistantTurn(input: RunInput): AsyncGenerator<AssistantStreamEvent, RunResult> {
  const ctx: ToolContext = { db: input.db, ai: input.ai, userId: input.userId, timezone: input.timezone, citations: [] };
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input.timezone) },
    ...input.history.slice(-HISTORY_MESSAGES).map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 6000) })),
    { role: "user", content: input.userText },
  ];

  let content = "";
  let thinking = "";
  let model = input.ai.chatModel;
  const toolRecords: ToolCallRecord[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    let stepContent = "";
    const calls: ToolCall[] = [];
    const isLastStep = step === MAX_STEPS - 1;

    for await (const chunk of input.ai.streamChat(messages, { tools: isLastStep ? undefined : TOOL_DEFINITIONS, think: input.think, signal: input.signal })) {
      if (chunk.thinking) {
        thinking += chunk.thinking;
        yield { type: "thinking", delta: chunk.thinking };
      }
      if (chunk.content) {
        stepContent += chunk.content;
        yield { type: "delta", delta: chunk.content };
      }
      if (chunk.toolCalls) calls.push(...chunk.toolCalls);
    }
    content += stepContent;
    if (calls.length === 0) break;

    messages.push({ role: "assistant", content: stepContent, tool_calls: calls });
    for (const call of calls) {
      yield { type: "tool_call", name: call.name, arguments: call.arguments };
      const outcome = await handleToolCall(call, ctx, input);
      toolRecords.push({ name: call.name, arguments: call.arguments, result_summary: outcome.summary });
      if (outcome.action) yield { type: "action", action: outcome.action };
      yield { type: "tool_result", name: call.name, summary: outcome.summary };
      messages.push({ role: "tool", tool_name: call.name, tool_call_id: call.id, content: outcome.forModel });
    }
    if (stepContent) content += "\n\n";
  }

  if (ctx.citations.length) yield { type: "citations", citations: ctx.citations };
  model = input.ai.chatModel;
  return { content: content.trim(), thinking, citations: ctx.citations, toolCalls: toolRecords, model };
}

async function handleToolCall(
  call: ToolCall,
  ctx: ToolContext,
  input: RunInput,
): Promise<{ summary: string; forModel: string; action?: AssistantAction }> {
  const tool = findTool(call.name);
  if (!tool) return { summary: `Unknown tool ${call.name}`, forModel: `Error: tool "${call.name}" does not exist.` };

  const parsed = tool.schema.safeParse(call.arguments ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ");
    return { summary: `Invalid arguments for ${call.name}`, forModel: `Error: invalid arguments (${issues}). Fix them and try again.` };
  }

  if (tool.requiresConfirmation) {
    const { data, error } = await adminDb
      .from("assistant_actions")
      .insert({
        user_id: input.userId,
        conversation_id: input.conversationId,
        message_id: input.assistantMessageId,
        tool: tool.name,
        arguments: parsed.data,
        summary: tool.describe?.(parsed.data) ?? tool.name,
      })
      .select("*")
      .single();
    if (error) return { summary: "Could not create the proposal", forModel: "Error: the proposal could not be recorded." };
    await audit({ userId: input.userId, actor: "assistant", action: "assistant.action_proposed", targetType: "assistant_action", targetId: data.id, metadata: { tool: tool.name } });
    return {
      summary: `Proposed: ${data.summary}`,
      forModel: "Proposal created and shown to the user. It has NOT been executed — it will only happen if the user confirms it.",
      action: data as AssistantAction,
    };
  }

  try {
    const outcome = await tool.run!(parsed.data, ctx);
    return { summary: outcome.summary, forModel: dataBlock(`${tool.name}_result`, outcome.content) };
  } catch (err) {
    return { summary: `${call.name} failed`, forModel: `Error running ${call.name}: ${errorMessage(err).slice(0, 300)}` };
  }
}

/** Executes a user-confirmed assistant action as the user (RLS) and records the outcome. */
export async function executeAction(db: SupabaseClient, action: AssistantAction, userId: string): Promise<Record<string, unknown>> {
  switch (action.tool) {
    case "create_task": {
      const args = createTaskArgs.parse(action.arguments);
      const task = unwrap<{ id: string; title: string }>(
        await db
          .from("tasks")
          .insert({ user_id: userId, title: args.title, description: args.notes ?? null, priority: args.priority ?? "medium", due_at: args.due_at ?? null, source: "assistant" })
          .select("id, title")
          .single(),
      );
      return { task_id: task.id, title: task.title, link: `/productivity/tasks?task=${task.id}` };
    }
    case "create_reminder": {
      const args = createReminderArgs.parse(action.arguments);
      const task = unwrap<{ id: string; title: string }>(
        await db.from("tasks").insert({ user_id: userId, title: args.title, remind_at: args.remind_at, source: "assistant" }).select("id, title").single(),
      );
      return { task_id: task.id, title: task.title, remind_at: args.remind_at, link: `/productivity/tasks?task=${task.id}` };
    }
    case "save_note": {
      const args = saveNoteArgs.parse(action.arguments);
      const doc = unwrap<{ id: string; title: string }>(
        await db
          .from("knowledge_documents")
          .insert({
            user_id: userId,
            type: "ai_summary",
            title: args.title,
            content: args.content,
            excerpt: args.content.slice(0, 300),
            tags: (args.tags ?? []).map((t) => t.toLowerCase()),
            metadata: { created_by: "assistant" },
          })
          .select("id, title")
          .single(),
      );
      await enqueueIndex(doc.id, userId, 3);
      return { document_id: doc.id, title: doc.title, link: `/knowledge?doc=${doc.id}` };
    }
    default:
      throw new Error(`Unsupported action ${action.tool}`);
  }
}
