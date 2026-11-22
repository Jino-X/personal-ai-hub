"use client";

import type { Briefing, BriefingItemRef, BriefingTaskRef } from "@hub/shared";
import { format } from "date-fns";
import { AlertTriangle, ArrowUpRight, BookMarked, CalendarDays, CodeXml, GraduationCap, ListTodo, Newspaper, Sparkles, Target, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PRIORITY_META } from "@/components/productivity/meta";
import { CompletedPerDayChart } from "@/components/productivity/weekly-chart";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function Section({ icon: Icon, title, children, empty }: { icon: LucideIcon; title: string; children: ReactNode; empty?: boolean }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" /> {title}
      </h3>
      {empty ? <p className="text-sm text-muted-foreground">Nothing here.</p> : children}
    </section>
  );
}

function TaskList({ tasks }: { tasks: BriefingTaskRef[] }) {
  return (
    <ul className="space-y-1.5">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-2 text-sm">
          <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_META[t.priority].dot)} />
          <Link href={`/productivity/tasks?task=${t.id}`} className="flex-1 truncate hover:text-primary">
            {t.title}
          </Link>
          {t.due_at && <span className="shrink-0 text-xs text-muted-foreground">{friendlyDate(t.due_at, true)}</span>}
        </li>
      ))}
    </ul>
  );
}

function ItemList({ items }: { items: BriefingItemRef[] }) {
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.id} className="space-y-0.5">
          <a href={i.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-start gap-1 text-sm font-medium hover:text-primary">
            {i.title} <ArrowUpRight className="mt-0.5 size-3 shrink-0 opacity-50 group-hover:opacity-100" />
          </a>
          <p className="text-xs text-muted-foreground">
            {i.source_name}
            {i.published_at ? ` · ${friendlyDate(i.published_at)}` : ""}
            {i.category ? ` · ${i.category}` : ""}
          </p>
          {i.summary && <p className="text-xs text-muted-foreground">{i.summary}</p>}
        </li>
      ))}
    </ul>
  );
}

export function BriefingContentView({ briefing, compact = false }: { briefing: Briefing; compact?: boolean }) {
  const c = briefing.content;
  const ai = c.ai;

  return (
    <div className="space-y-6">
      {ai ? (
        <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.05] p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
            <Sparkles className="size-3" /> AI-written from the data below · {briefing.model}
          </p>
          <p className="text-base font-semibold">{ai.headline}</p>
          <p className="text-sm">{ai.summary}</p>
          {!compact && (
            <div className="grid gap-4 sm:grid-cols-2">
              {ai.focus.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Focus</p>
                  <ul className="list-disc space-y-1 pl-4 text-sm">
                    {ai.focus.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {ai.recommendations.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Recommended</p>
                  <ul className="list-disc space-y-1 pl-4 text-sm">
                    {ai.recommendations.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      ) : briefing.ai_status === "pending" || briefing.ai_status === "processing" ? (
        <div className="space-y-2 rounded-xl border border-dashed p-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3" /> Writing your summary with local AI…
          </p>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">AI summary unavailable — local AI was offline. The sections below come straight from your data.</p>
      )}

      <div className={cn("grid gap-6", !compact && "md:grid-cols-2")}>
        <Section icon={ListTodo} title={briefing.kind === "daily" ? "Today's priorities" : "Priorities"} empty={c.priorities.length === 0}>
          <TaskList tasks={c.priorities} />
        </Section>
        <Section icon={CalendarDays} title={briefing.kind === "daily" ? "Today's events" : "Coming up"} empty={c.events.length === 0}>
          <ul className="space-y-1.5">
            {c.events.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {e.all_day ? (briefing.kind === "daily" ? "All day" : format(new Date(e.starts_at), "EEE d")) : format(new Date(e.starts_at), briefing.kind === "daily" ? "HH:mm" : "EEE HH:mm")}
                </span>
                <span className="truncate">{e.title}</span>
              </li>
            ))}
          </ul>
        </Section>
        {c.overdue.length > 0 && (
          <Section icon={AlertTriangle} title="Overdue">
            <TaskList tasks={c.overdue} />
          </Section>
        )}
        {!compact && c.unfinished.length > 0 && (
          <Section icon={ListTodo} title="In progress">
            <TaskList tasks={c.unfinished} />
          </Section>
        )}
      </div>

      {!compact && c.productivity && (
        <Section icon={Target} title="Productivity">
          <div className="grid gap-6 md:grid-cols-[1fr_200px]">
            <CompletedPerDayChart data={c.productivity.completed_per_day} />
            <dl className="grid grid-cols-2 content-start gap-3 text-center">
              <div>
                <dt className="text-[11px] text-muted-foreground">Completed</dt>
                <dd className="text-xl font-semibold tabular-nums">{c.productivity.completed}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Created</dt>
                <dd className="text-xl font-semibold tabular-nums">{c.productivity.created}</dd>
              </div>
            </dl>
          </div>
        </Section>
      )}
      {!compact && c.goals && c.goals.length > 0 && (
        <Section icon={Target} title="Goal progress">
          <ul className="space-y-2">
            {c.goals.map((g) => (
              <li key={g.id} className="flex items-center gap-3 text-sm">
                <span className="w-48 truncate">{g.title}</span>
                <Progress value={g.progress} className="h-1.5" />
                <span className="w-10 text-right text-xs tabular-nums">{g.progress}%</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section icon={Newspaper} title="Important AI developments" empty={c.ai_developments.length === 0}>
        <ItemList items={compact ? c.ai_developments.slice(0, 3) : c.ai_developments} />
      </Section>
      {!compact && (
        <Section icon={CodeXml} title="Developer updates" empty={c.developer_updates.length === 0}>
          <ItemList items={c.developer_updates} />
        </Section>
      )}
      {!compact && c.learning.length > 0 && (
        <Section icon={GraduationCap} title="Recommended learning">
          <ul className="space-y-2 text-sm">
            {c.learning.map((l) => (
              <li key={l.goal_id}>
                <Link href={`/productivity/goals?goal=${l.goal_id}`} className="font-medium hover:text-primary">
                  {l.goal_title}
                </Link>
                {l.next_steps.length > 0 ? (
                  <span className="text-muted-foreground"> — next: {l.next_steps.join(", ")}</span>
                ) : (
                  <span className="text-muted-foreground"> — add lessons to plan your next step</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!compact && c.saved_research.length > 0 && (
        <Section icon={BookMarked} title="Saved research">
          <ul className="flex flex-wrap gap-2">
            {c.saved_research.map((d) => (
              <li key={d.id}>
                <Link href={`/knowledge?doc=${d.id}`}>
                  <Badge variant="secondary" className="hover:bg-accent">
                    {d.title}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
