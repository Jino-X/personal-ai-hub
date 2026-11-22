"use client";

import type { AssistantAction, Citation } from "@hub/shared";
import { ArrowUpRight, Brain, Check, ChevronRight, Loader2, Search, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDecideAction } from "@/lib/api/hooks/assistant";
import { cn } from "@/lib/utils";

export function ThinkingBlock({ text, live = false }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        <Brain className="size-3" /> {live ? "Thinking…" : "Reasoning"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-2 border-l-2 pl-3 text-xs whitespace-pre-wrap text-muted-foreground">{text}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ToolSteps({ steps }: { steps: { name: string; summary?: string }[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {steps.map((s, i) => (
        <span key={`${s.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-0.5 text-[11px] text-muted-foreground">
          {s.summary ? <Search className="size-3" /> : <Loader2 className="size-3 animate-spin" />}
          {s.summary ?? `Running ${s.name.replace(/_/g, " ")}…`}
        </span>
      ))}
    </div>
  );
}

export function SourceList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="space-y-1 border-t pt-2">
      <p className="text-[11px] font-medium text-muted-foreground">Sources</p>
      <ol className="space-y-1">
        {citations.map((c) => {
          const href = c.kind === "knowledge" ? `/knowledge?doc=${c.id}` : (c.url ?? "#");
          const external = c.kind !== "knowledge";
          const label = (
            <>
              <span className="flex size-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold">{c.ref}</span>
              <span className="truncate">{c.title}</span>
              {external && <ArrowUpRight className="size-3 shrink-0" />}
              <Badge variant="outline" className="ml-auto shrink-0 text-[9px]">
                {c.kind === "knowledge" ? "your vault" : "intelligence"}
              </Badge>
            </>
          );
          return (
            <li key={`${c.kind}-${c.id}`}>
              {external ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs hover:text-primary">
                  {label}
                </a>
              ) : (
                <Link href={href} className="flex items-center gap-2 text-xs hover:text-primary">
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const STATUS_LABEL: Record<AssistantAction["status"], string> = {
  proposed: "Waiting for your confirmation",
  confirmed: "Running…",
  rejected: "Rejected",
  executed: "Done",
  failed: "Failed",
  expired: "Expired",
};

/** Explicit user confirmation for consequential assistant actions. */
export function ActionCard({ action, conversationId }: { action: AssistantAction; conversationId: string | null }) {
  const decide = useDecideAction(conversationId);
  const pending = action.status === "proposed";
  const link = typeof action.result?.link === "string" ? action.result.link : null;

  return (
    <div className={cn("space-y-2 rounded-lg border p-3", pending ? "border-primary/40 bg-primary/5" : "bg-muted/30")}>
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{action.summary}</p>
          <p className="text-xs text-muted-foreground">{STATUS_LABEL[action.status]}</p>
          {action.error && <p className="text-xs text-destructive">{action.error}</p>}
        </div>
      </div>
      {pending ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: action.id, decision: "confirm" })}>
            <Check /> Confirm
          </Button>
          <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: action.id, decision: "reject" })}>
            <X /> Reject
          </Button>
        </div>
      ) : (
        link && (
          <Button asChild size="xs" variant="outline">
            <Link href={link}>Open</Link>
          </Button>
        )
      )}
    </div>
  );
}
