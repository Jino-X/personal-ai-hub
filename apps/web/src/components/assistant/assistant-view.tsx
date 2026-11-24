"use client";

import type { AssistantAction, AssistantStreamEvent, Citation } from "@hub/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BookMarked,
  Brain,
  CircleAlert,
  CodeXml,
  FileText,
  GitBranch,
  ListTodo,
  MessageSquarePlus,
  Newspaper,
  Pin,
  PinOff,
  Send,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { DepthSurface } from "@/components/auth/depth-surface";
import { Markdown } from "@/components/common/markdown";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { apiStream, errorMessage } from "@/lib/api/client";
import { assistantKeys, useConversation, useConversationMutations, useConversations } from "@/lib/api/hooks/assistant";
import { useAIStatus } from "@/lib/api/hooks/system";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ActionCard, SourceList, ThinkingBlock, ToolSteps } from "./message-parts";

const SUGGESTIONS = [
  { text: "Summarize the most important AI news from this week", icon: Newspaper, tint: "var(--chart-1)" },
  { text: "What changed in the latest Next.js and React releases?", icon: CodeXml, tint: "var(--chart-2)" },
  { text: "What have I saved about RAG and vector search?", icon: BookMarked, tint: "var(--chart-3)" },
  { text: "Recommend repositories for building MCP servers", icon: GitBranch, tint: "var(--chart-5)" },
  { text: "Plan my day based on my tasks", icon: ListTodo, tint: "var(--chart-4)" },
  { text: "Write my weekly progress report", icon: FileText, tint: "var(--chart-1)" },
];

/** The assistant's mark: a glowing core with orbiting rings, set in depth so it tilts with the pointer. */
function AssistantOrb() {
  return (
    <div className="depth-perspective mx-auto size-36">
      <div className="depth-stage relative size-full">
        <div aria-hidden className="absolute inset-4 rounded-full bg-[var(--orb-1)] blur-2xl" />
        <div aria-hidden className="depth-layer inset-0 [--z:-20px]">
          <div className="animate-orbit size-full rounded-full border border-dashed border-primary/30" />
        </div>
        <div aria-hidden className="depth-layer inset-5 [--z:10px]">
          <div className="animate-orbit relative size-full rounded-full border border-primary/25 [animation-direction:reverse] [animation-duration:9s]">
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-chart-2 shadow-[0_0_10px_var(--chart-2)]" />
          </div>
        </div>
        <div className="depth-layer inset-0 flex items-center justify-center [--z:50px]">
          <div className="animate-float icon-tile size-16 rounded-[22px]">
            <Sparkles className="size-7" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface StreamState {
  userText: string;
  content: string;
  thinking: string;
  steps: { name: string; summary?: string }[];
  actions: AssistantAction[];
  citations: Citation[];
  error: string | null;
}

export function AssistantView() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const conversations = useConversations();
  const { create, update, remove } = useConversationMutations();
  const status = useAIStatus();
  const [selected, setSelected] = useState<string | null>(params.get("c"));
  const detail = useConversation(selected);
  const [input, setInput] = useState(params.get("prompt") ?? "");
  const [think, setThink] = useState(false);
  const [stream, setStream] = useState<StreamState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [detail.data?.messages.length, stream?.content, stream?.steps.length]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || stream) return;
    let conversationId = selected;
    try {
      if (!conversationId) {
        conversationId = (await create.mutateAsync()).id;
        setSelected(conversationId);
      }
    } catch {
      return;
    }
    setInput("");
    const controller = new AbortController();
    abortRef.current = controller;
    setStream({ userText: content, content: "", thinking: "", steps: [], actions: [], citations: [], error: null });

    const onEvent = (event: AssistantStreamEvent) => {
      setStream((s) => {
        if (!s) return s;
        switch (event.type) {
          case "delta":
            return { ...s, content: s.content + event.delta };
          case "thinking":
            return { ...s, thinking: s.thinking + event.delta };
          case "tool_call":
            return { ...s, steps: [...s.steps, { name: event.name }] };
          case "tool_result": {
            const steps = [...s.steps];
            const idx = steps.findIndex((st) => st.name === event.name && !st.summary);
            if (idx >= 0) steps[idx] = { name: event.name, summary: event.summary };
            return { ...s, steps };
          }
          case "action":
            return { ...s, actions: [...s.actions, event.action] };
          case "citations":
            return { ...s, citations: event.citations };
          case "error":
            return { ...s, error: event.message };
          default:
            return s;
        }
      });
    };

    try {
      await apiStream(`/v1/assistant/conversations/${conversationId}/messages`, { content, think }, onEvent, controller.signal);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) toast.error(errorMessage(err));
    } finally {
      abortRef.current = null;
      await qc.invalidateQueries({ queryKey: assistantKeys.conversation(conversationId) });
      void qc.invalidateQueries({ queryKey: assistantKeys.conversations });
      setStream(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  const messages = detail.data?.messages ?? [];
  const actions = detail.data?.actions ?? [];
  const aiOffline = status.data && !status.data.available;
  const empty = messages.length === 0 && !stream;

  return (
    <div className="grid h-[calc(100svh-3.5rem)] md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden flex-col border-r bg-sidebar/40 backdrop-blur-sm md:flex">
        <div className="p-3">
          <Button
            className="w-full"
            variant="outline"
            onClick={() => {
              setSelected(null);
              setStream(null);
            }}
          >
            <MessageSquarePlus /> New chat
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5 px-2 pb-3">
            {conversations.isPending && Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="mx-1 my-1 h-9" />)}
            {(conversations.data ?? []).map((c) => (
              <div key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={cn(
                    "relative flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/60",
                    selected === c.id &&
                      "bg-[linear-gradient(90deg,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)] ring-1 ring-primary/15 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-primary before:shadow-[0_0_10px_var(--primary)]",
                  )}
                >
                  <span className="flex items-center gap-1 truncate pr-12 text-sm">
                    {c.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
                    {c.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{relativeTime(c.last_message_at ?? c.created_at)}</span>
                </button>
                <div className="absolute top-1.5 right-1 hidden gap-0.5 group-hover:flex">
                  <Button size="icon-xs" variant="ghost" aria-label={c.pinned ? "Unpin" : "Pin"} onClick={() => update.mutate({ id: c.id, pinned: !c.pinned })}>
                    {c.pinned ? <PinOff /> : <Pin />}
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Delete conversation"
                    onClick={() => {
                      remove.mutate(c.id);
                      if (selected === c.id) setSelected(null);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <section className="flex min-h-0 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
            {aiOffline && (
              <Alert>
                <CircleAlert />
                <AlertDescription>
                  {status.data?.reason ?? "Local AI is offline."}{" "}
                  <Link href="/settings/ai" className="text-primary underline-offset-4 hover:underline">
                    Check AI settings
                  </Link>
                </AlertDescription>
              </Alert>
            )}

            {empty && !detail.isFetching && (
              <DepthSurface maxTilt={12} className="page-enter space-y-8 py-8 text-center">
                <AssistantOrb />
                <div className="space-y-2">
                  <h1 className="text-gradient text-2xl font-semibold tracking-tight md:text-3xl">How can I help?</h1>
                  <p className="mx-auto max-w-xl text-sm text-muted-foreground">
                    I run on your local model and can search your knowledge vault, AI news and tasks. Anything that changes your data needs your confirmation.
                  </p>
                </div>
                <div className="stagger grid gap-3 text-left sm:grid-cols-2">
                  {SUGGESTIONS.map(({ text, icon: Icon, tint }) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => void send(text)}
                      data-slot="card"
                      className="lift group flex items-start gap-3 rounded-xl border bg-card/70 p-3.5 text-left text-sm"
                    >
                      <span className="icon-chip size-8 shrink-0 rounded-lg" style={{ "--tint": tint } as CSSProperties}>
                        <Icon className="size-4" />
                      </span>
                      <span className="flex-1 pt-1.5 leading-snug">{text}</span>
                      <ArrowUpRight className="mt-1.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              </DepthSurface>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} text={m.content} />
              ) : (
                <div key={m.id} className="space-y-3">
                  {m.thinking && <ThinkingBlock text={m.thinking} />}
                  {m.tool_calls && <ToolSteps steps={m.tool_calls.map((t) => ({ name: t.name, summary: t.result_summary ?? t.name }))} />}
                  {m.content ? (
                    <Markdown>{m.content}</Markdown>
                  ) : m.status === "error" ? (
                    <p className="text-sm text-destructive">{m.error ?? "The model failed to respond."}</p>
                  ) : null}
                  {actions
                    .filter((a) => a.message_id === m.id)
                    .map((a) => (
                      <ActionCard key={a.id} action={a} conversationId={selected} />
                    ))}
                  <SourceList citations={m.citations} />
                  {m.model && <p className="text-[10px] text-muted-foreground">AI-generated · {m.model}</p>}
                </div>
              ),
            )}

            {stream && (
              <>
                <UserBubble text={stream.userText} />
                <div className="space-y-3">
                  <ThinkingBlock text={stream.thinking} live={!stream.content} />
                  <ToolSteps steps={stream.steps} />
                  {stream.content ? (
                    <Markdown>{stream.content}</Markdown>
                  ) : (
                    !stream.error && (
                      <div className="flex gap-1" aria-label="Assistant is typing">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 120}ms` }} />
                        ))}
                      </div>
                    )
                  )}
                  {stream.actions.map((a) => (
                    <ActionCard key={a.id} action={a} conversationId={selected} />
                  ))}
                  {stream.error && <p className="text-sm text-destructive">{stream.error}</p>}
                  <SourceList citations={stream.citations} />
                </div>
              </>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <form onSubmit={onSubmit} className="p-3 pt-0">
          <div className="glass mx-auto flex max-w-3xl flex-col gap-2 rounded-2xl border p-2 shadow-[0_20px_50px_-24px_oklch(0_0_0/0.6)] transition-[box-shadow,border-color] duration-300 focus-within:border-primary/40 focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_12%,transparent),0_24px_60px_-20px_color-mix(in_oklch,var(--primary)_35%,transparent)]">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={8000}
              placeholder="Ask about your knowledge, AI news, tasks… (Enter to send, Shift+Enter for a new line)"
              className="min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex items-center justify-between">
              <Toggle size="sm" pressed={think} onPressedChange={setThink} aria-label="Reasoning mode">
                <Brain /> Think
              </Toggle>
              {stream ? (
                <Button type="button" size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>
                  <Square /> Stop
                </Button>
              ) : (
                <Button type="submit" size="sm" disabled={!input.trim()} className="shadow-[0_8px_20px_-8px_var(--primary)]">
                  <Send /> Send
                </Button>
              )}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] animate-rise rounded-2xl rounded-br-md bg-[linear-gradient(135deg,var(--tile-from),var(--tile-to))] px-4 py-2.5 text-sm whitespace-pre-wrap text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.25),0_12px_28px_-14px_var(--tile-to)]">{text}</div>
    </div>
  );
}
