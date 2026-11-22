import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  actionDecisionSchema,
  chatMessageSchema,
  conversationCreateSchema,
  conversationUpdateSchema,
  type AssistantAction,
  type AssistantStreamEvent,
  type Conversation,
  type Message,
} from "@hub/shared";
import { executeAction, runAssistantTurn, type RunResult } from "../agents/assistant/run";
import { resolveAI } from "../ai/service";
import { audit } from "../lib/audit";
import { AppError, errorMessage, notFound, unwrap } from "../lib/errors";
import { logger } from "../lib/logger";
import { rateLimit } from "../lib/rate-limit";
import { adminDb } from "../lib/supabase";
import { userTimezone } from "../lib/user";
import { definedOnly, idParam, parseBody } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

function titleFrom(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || "New conversation";
}

export const assistantRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/conversations", async (c) => {
    const rows = unwrap<Conversation[]>(
      await c.get("db").from("conversations").select("*").order("pinned", { ascending: false }).order("last_message_at", { ascending: false, nullsFirst: false }).limit(100),
    );
    return c.json({ items: rows });
  })
  .post("/conversations", async (c) => {
    const body = await parseBody(c, conversationCreateSchema);
    const row = unwrap<Conversation>(
      await c.get("db").from("conversations").insert({ user_id: c.get("user").id, title: body.title ?? "New conversation" }).select("*").single(),
    );
    return c.json(row, 201);
  })
  .get("/conversations/:id", async (c) => {
    const id = idParam(c);
    const db = c.get("db");
    const [conversation, messages, actions] = await Promise.all([
      db.from("conversations").select("*").eq("id", id).maybeSingle(),
      db.from("messages").select("*").eq("conversation_id", id).neq("role", "tool").order("created_at").limit(500),
      db.from("assistant_actions").select("*").eq("conversation_id", id).order("created_at"),
    ]);
    return c.json({
      conversation: unwrap<Conversation>(conversation, "Conversation"),
      messages: unwrap<Message[]>(messages),
      actions: unwrap<AssistantAction[]>(actions),
    });
  })
  .patch("/conversations/:id", async (c) => {
    const body = definedOnly(await parseBody(c, conversationUpdateSchema));
    return c.json(unwrap<Conversation>(await c.get("db").from("conversations").update(body).eq("id", idParam(c)).select("*").single(), "Conversation"));
  })
  .delete("/conversations/:id", async (c) => {
    unwrap(await c.get("db").from("conversations").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  })
  .post("/conversations/:id/messages", rateLimit({ name: "assistant-chat", capacity: 20, windowMs: 60_000 }), async (c) => {
    const conversationId = idParam(c);
    const body = await parseBody(c, chatMessageSchema);
    const db = c.get("db");
    const user = c.get("user");

    const conversation = unwrap<Conversation | null>(await db.from("conversations").select("*").eq("id", conversationId).maybeSingle());
    if (!conversation) throw notFound("Conversation");
    // Resolve AI before streaming so "offline" is a normal 503 the UI can show.
    const [ai, timezone] = await Promise.all([resolveAI(user.id), userTimezone(db, user.id)]);

    const history = unwrap<Pick<Message, "role" | "content">[]>(
      await db.from("messages").select("role, content").eq("conversation_id", conversationId).in("role", ["user", "assistant"]).eq("status", "complete").order("created_at", { ascending: false }).limit(16),
    ).reverse();

    unwrap(await db.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "user", content: body.content }));
    const assistantMessage = unwrap<Message>(
      await db
        .from("messages")
        .insert({ conversation_id: conversationId, user_id: user.id, role: "assistant", content: "", status: "streaming", model: ai.chatModel })
        .select("*")
        .single(),
    );
    const titlePatch = conversation.title === "New conversation" ? { title: titleFrom(body.content) } : {};
    await db.from("conversations").update({ ...titlePatch, last_message_at: new Date().toISOString(), model: ai.chatModel }).eq("id", conversationId);

    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());
      const send = (event: AssistantStreamEvent) => stream.writeSSE({ data: JSON.stringify(event) });

      await send({ type: "start", conversation_id: conversationId, message_id: assistantMessage.id, model: ai.chatModel });
      let result: RunResult | null = null;
      let partial = "";
      try {
        const turn = runAssistantTurn({
          db,
          ai,
          userId: user.id,
          timezone,
          conversationId,
          assistantMessageId: assistantMessage.id,
          history,
          userText: body.content,
          think: body.think ?? ai.settings.thinking,
          signal: abort.signal,
        });
        for (;;) {
          const next = await turn.next();
          if (next.done) {
            result = next.value;
            break;
          }
          if (next.value.type === "delta") partial += next.value.delta;
          await send(next.value);
        }
        const final = unwrap<Message>(
          await db
            .from("messages")
            .update({
              content: result.content,
              thinking: result.thinking || null,
              citations: result.citations,
              tool_calls: result.toolCalls.length ? result.toolCalls : null,
              status: "complete",
              model: result.model,
            })
            .eq("id", assistantMessage.id)
            .select("*")
            .single(),
        );
        const conv = unwrap<Conversation>(await db.from("conversations").select("*").eq("id", conversationId).single());
        await send({ type: "done", message: final, conversation: conv });
      } catch (err) {
        const aborted = abort.signal.aborted;
        logger.warn({ err: errorMessage(err), aborted }, "assistant turn failed");
        await adminDb
          .from("messages")
          .update({ content: partial, status: aborted && partial ? "complete" : "error", error: aborted ? "Stopped by user" : errorMessage(err).slice(0, 500) })
          .eq("id", assistantMessage.id);
        if (!aborted) await send({ type: "error", code: "assistant_error", message: `The local model failed to respond: ${errorMessage(err).slice(0, 200)}` });
      }
    });
  })
  .post("/actions/:id/decision", async (c) => {
    const id = idParam(c);
    const { decision } = await parseBody(c, actionDecisionSchema);
    const user = c.get("user");
    const action = unwrap<AssistantAction | null>(
      await adminDb.from("assistant_actions").select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
    );
    if (!action) throw notFound("Action");
    if (action.status !== "proposed") throw new AppError(409, "action_decided", `This action was already ${action.status}.`);
    if (new Date(action.expires_at) < new Date()) {
      await adminDb.from("assistant_actions").update({ status: "expired" }).eq("id", id);
      throw new AppError(410, "action_expired", "This proposal has expired. Ask the assistant again.");
    }

    const now = new Date().toISOString();
    if (decision === "reject") {
      const row = unwrap<AssistantAction>(await adminDb.from("assistant_actions").update({ status: "rejected", decided_at: now }).eq("id", id).select("*").single());
      await audit({ userId: user.id, actor: "user", action: "assistant.action_rejected", targetType: "assistant_action", targetId: id, metadata: { tool: action.tool }, c });
      return c.json(row);
    }

    // Claim the action atomically so a double-click can't execute it twice.
    const { data: claimed } = await adminDb
      .from("assistant_actions")
      .update({ status: "confirmed", decided_at: now })
      .eq("id", id)
      .eq("status", "proposed")
      .select("id");
    if (!claimed?.length) throw new AppError(409, "action_decided", "This action was already handled.");

    try {
      const result = await executeAction(c.get("db"), action, user.id);
      const row = unwrap<AssistantAction>(
        await adminDb.from("assistant_actions").update({ status: "executed", executed_at: new Date().toISOString(), result }).eq("id", id).select("*").single(),
      );
      await audit({ userId: user.id, actor: "user", action: "assistant.action_executed", targetType: "assistant_action", targetId: id, metadata: { tool: action.tool, result }, c });
      return c.json(row);
    } catch (err) {
      const row = unwrap<AssistantAction>(
        await adminDb.from("assistant_actions").update({ status: "failed", error: errorMessage(err).slice(0, 500) }).eq("id", id).select("*").single(),
      );
      await audit({ userId: user.id, actor: "user", action: "assistant.action_failed", targetType: "assistant_action", targetId: id, metadata: { tool: action.tool }, c });
      return c.json(row, 422);
    }
  });
