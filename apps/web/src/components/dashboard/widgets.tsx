"use client";

import type { DashboardSummary } from "@hub/shared";
import { format } from "date-fns";
import { ArrowRight, ArrowUpRight, BookMarked, CalendarDays, CodeXml, Cpu, Eye, ListTodo, Newspaper, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { BriefingContentView } from "@/components/briefings/briefing-content";
import { DocIcon } from "@/components/knowledge/meta";
import { TaskRow } from "@/components/productivity/task-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useGenerateBriefing } from "@/lib/api/hooks/briefings";
import { useAIStatus } from "@/lib/api/hooks/system";
import { friendlyDate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function Widget({
  title,
  icon: Icon,
  tint = "var(--chart-1)",
  href,
  children,
  className,
}: {
  title: string;
  icon: typeof ListTodo;
  tint?: string;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-sm">
          <span className="icon-chip size-7 rounded-lg" style={{ "--tint": tint } as CSSProperties}>
            <Icon className="size-4" />
          </span>
          {title}
        </CardTitle>
        {href && (
          <CardAction>
            <Button asChild variant="ghost" size="xs">
              <Link href={href} className="group/all text-muted-foreground hover:text-foreground">
                View all <ArrowRight className="transition-transform group-hover/all:translate-x-0.5" />
              </Link>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>;
}

export function BriefingWidget({ data }: { data: DashboardSummary }) {
  const generate = useGenerateBriefing();
  return (
    <Widget title="Daily briefing" icon={Newspaper} tint="var(--chart-1)" href="/briefings" className="md:col-span-2">
      {data.briefing ? (
        <>
          <p className="text-xs text-muted-foreground">
            {data.briefing.title} · generated {relativeTime(data.briefing.generated_at ?? data.briefing.created_at)}
          </p>
          <BriefingContentView briefing={data.briefing} compact />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-muted-foreground">No briefing yet today. It&apos;s generated automatically each morning, or you can create one now.</p>
          <Button size="sm" disabled={generate.isPending} onClick={() => generate.mutate("daily")}>
            {generate.isPending ? <Spinner /> : <Sparkles />} Generate briefing
          </Button>
        </div>
      )}
    </Widget>
  );
}

export function TasksWidget({ data, onNewTask }: { data: DashboardSummary; onNewTask: () => void }) {
  const { today, overdue, completed_today, open_total } = data.tasks;
  return (
    <Widget title="Today's tasks" icon={ListTodo} tint="var(--chart-1)" href="/productivity/tasks">
      <p className="text-xs text-muted-foreground">
        {completed_today} done today · {open_total} open{overdue.length > 0 && <span className="text-destructive"> · {overdue.length} overdue</span>}
      </p>
      {overdue.length + today.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-3">
          <Empty>Nothing due today.</Empty>
          <Button size="xs" variant="outline" onClick={onNewTask}>
            Add a task
          </Button>
        </div>
      ) : (
        [...overdue, ...today].slice(0, 7).map((t) => <TaskRow key={t.id} task={t} compact />)
      )}
    </Widget>
  );
}

export function EventsWidget({ data }: { data: DashboardSummary }) {
  return (
    <Widget title="Upcoming events" icon={CalendarDays} tint="var(--chart-2)" href="/productivity/calendar">
      {data.events.length === 0 ? (
        <Empty>No events in the next 3 days.</Empty>
      ) : (
        <ul className="space-y-2">
          {data.events.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <div className="w-20 shrink-0 text-xs text-muted-foreground">
                <p>{friendlyDate(e.starts_at)}</p>
                <p className="tabular-nums">{e.all_day ? "All day" : format(new Date(e.starts_at), "HH:mm")}</p>
              </div>
              <div className="min-w-0">
                <p className="truncate">{e.title}</p>
                {e.location && <p className="truncate text-xs text-muted-foreground">{e.location}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function GoalsWidget({ data }: { data: DashboardSummary }) {
  return (
    <Widget title="Goal progress" icon={Target} tint="var(--chart-4)" href="/productivity/goals">
      {data.goals.length === 0 ? (
        <Empty>No active goals yet.</Empty>
      ) : (
        <ul className="space-y-3">
          {data.goals.map((g) => (
            <li key={g.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <Link href={`/productivity/goals?goal=${g.id}`} className="truncate hover:text-primary">
                  {g.title}
                </Link>
                <span className="text-xs tabular-nums text-muted-foreground">{g.progress}%</span>
              </div>
              <Progress value={g.progress} className="h-1.5" />
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

function FeedList({ items }: { items: DashboardSummary["intelligence"] }) {
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.id} className="space-y-0.5">
          <a href={i.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-1 text-sm font-medium hover:text-primary">
            <span className="line-clamp-2">{i.title}</span>
            <ArrowUpRight className="mt-0.5 size-3 shrink-0 opacity-50 group-hover:opacity-100" />
          </a>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{i.source_name}</span>
            <span>·</span>
            <span>{i.published_at ? friendlyDate(i.published_at) : relativeTime(i.fetched_at)}</span>
            {i.category_name && <Badge variant="secondary" className="text-[10px]">{i.category_name}</Badge>}
          </p>
          {i.ai_summary && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              <Sparkles className="mr-1 inline size-3 text-primary" />
              {i.ai_summary}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function IntelligenceWidget({ data }: { data: DashboardSummary }) {
  return (
    <Widget title="Latest AI updates" icon={Newspaper} tint="var(--chart-5)" href="/intelligence/ai-news">
      {data.intelligence.length === 0 ? <Empty>No recent updates — sources refresh in the background.</Empty> : <FeedList items={data.intelligence} />}
    </Widget>
  );
}

export function DeveloperWidget({ data }: { data: DashboardSummary }) {
  return (
    <Widget title="Developer updates" icon={CodeXml} tint="var(--chart-3)" href="/intelligence/developer-news">
      {data.developer.length === 0 ? <Empty>No new releases this week.</Empty> : <FeedList items={data.developer} />}
    </Widget>
  );
}

export function KnowledgeWidget({ data, onNewNote }: { data: DashboardSummary; onNewNote: () => void }) {
  return (
    <Widget title="Recently saved" icon={BookMarked} tint="var(--chart-2)" href="/knowledge">
      {data.knowledge.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-3">
          <Empty>Your knowledge vault is empty.</Empty>
          <Button size="xs" variant="outline" onClick={onNewNote}>
            Write a note
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.knowledge.map((d) => (
            <li key={d.id}>
              <Link href={`/knowledge?doc=${d.id}`} className="flex items-center gap-2 text-sm hover:text-primary">
                <DocIcon type={d.type} className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{d.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relativeTime(d.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function WatchlistWidget({ data }: { data: DashboardSummary }) {
  return (
    <Widget title="Watchlist alerts" icon={Eye} tint="var(--chart-4)" href="/watchlist">
      {data.watchlist_matches.length === 0 ? (
        <Empty>No new matches.</Empty>
      ) : (
        <ul className="space-y-2.5">
          {data.watchlist_matches.map((m) => (
            <li key={m.id} className="space-y-0.5">
              <Badge variant="secondary" className="text-[10px]">
                {m.watchlist_item?.value}
              </Badge>
              <a href={m.item?.url} target="_blank" rel="noopener noreferrer" className="block text-sm hover:text-primary">
                {m.item?.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function AIStatusWidget() {
  const { data, isPending } = useAIStatus();
  return (
    <Widget title="Local AI" icon={Cpu} tint="var(--chart-3)" href="/settings/ai">
      {isPending ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : !data ? (
        <Empty>Status unavailable.</Empty>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full", data.available ? (data.chat_model_available ? "bg-success" : "bg-warning") : "bg-destructive")} />
            <span className="font-medium">{data.available ? "Online" : "Offline"}</span>
            {data.provider && <span className="text-xs text-muted-foreground">via {data.provider === "companion" ? "companion" : data.provider === "ollama" ? "Ollama" : "cloud"}</span>}
          </div>
          {!data.available && data.reason && <p className="text-xs text-muted-foreground">{data.reason}</p>}
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-muted-foreground">Chat model</dt>
            <dd className="text-right">{data.settings.chat_model}</dd>
            <dt className="text-muted-foreground">Embeddings</dt>
            <dd className="text-right">{data.settings.embedding_model}</dd>
            <dt className="text-muted-foreground">Devices online</dt>
            <dd className="text-right">
              {data.devices.filter((d) => d.online).length}/{data.devices.length}
            </dd>
          </dl>
        </div>
      )}
    </Widget>
  );
}
