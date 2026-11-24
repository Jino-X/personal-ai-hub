"use client";

import { DASHBOARD_WIDGETS, type DashboardSummary, type DashboardWidgetConfig, type DashboardWidgetId } from "@hub/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, ArrowDown, ArrowUp, ListTodo, MessageSquare, Settings2, StickyNote } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageContainer } from "@/components/common/page-header";
import { CardGridSkeleton, ErrorState } from "@/components/common/states";
import { useQuickActions } from "@/components/layout/quick-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api/client";
import { useUpdatePreferences } from "@/lib/api/hooks/me";
import { DashboardHero } from "./dashboard-hero";
import {
  AIStatusWidget,
  BriefingWidget,
  DeveloperWidget,
  EventsWidget,
  GoalsWidget,
  IntelligenceWidget,
  KnowledgeWidget,
  TasksWidget,
  WatchlistWidget,
} from "./widgets";

export function DashboardView() {
  const quick = useQuickActions();
  const [customizing, setCustomizing] = useState(false);
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardSummary>("/v1/dashboard"), refetchInterval: 5 * 60_000 });
  const data = dashboard.data;

  const render = (id: DashboardWidgetId) => {
    if (!data) return null;
    switch (id) {
      case "briefing":
        return <BriefingWidget key={id} data={data} />;
      case "tasks":
        return <TasksWidget key={id} data={data} onNewTask={() => quick.open("task")} />;
      case "events":
        return <EventsWidget key={id} data={data} />;
      case "goals":
        return <GoalsWidget key={id} data={data} />;
      case "intelligence":
        return <IntelligenceWidget key={id} data={data} />;
      case "developer":
        return <DeveloperWidget key={id} data={data} />;
      case "knowledge":
        return <KnowledgeWidget key={id} data={data} onNewNote={() => quick.open("note")} />;
      case "watchlist":
        return <WatchlistWidget key={id} data={data} />;
      case "ai_status":
        return <AIStatusWidget key={id} />;
    }
  };

  return (
    <PageContainer wide>
      <DashboardHero
        data={data}
        actions={
          <>
            <Button size="sm" className="shadow-[0_8px_20px_-8px_var(--primary)]" onClick={() => quick.open("task")}>
              <ListTodo /> Task
            </Button>
            <Button size="sm" variant="outline" className="bg-background/40" onClick={() => quick.open("reminder")}>
              <AlarmClock /> Reminder
            </Button>
            <Button size="sm" variant="outline" className="bg-background/40" onClick={() => quick.open("note")}>
              <StickyNote /> Note
            </Button>
            <Button size="sm" variant="outline" className="bg-background/40" asChild>
              <Link href="/assistant">
                <MessageSquare /> Ask AI
              </Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCustomizing(true)} disabled={!data}>
              <Settings2 /> Customize
            </Button>
          </>
        }
      />

      {dashboard.isPending ? (
        <CardGridSkeleton cards={6} />
      ) : dashboard.isError ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data!.widgets.filter((w) => w.visible).map((w) => render(w.id))}</div>
      )}

      {data && <CustomizeDialog open={customizing} onOpenChange={setCustomizing} widgets={data.widgets} />}
    </PageContainer>
  );
}

function CustomizeDialog({ open, onOpenChange, widgets }: { open: boolean; onOpenChange: (o: boolean) => void; widgets: DashboardWidgetConfig[] }) {
  const qc = useQueryClient();
  const update = useUpdatePreferences();
  const [draft, setDraft] = useState(widgets);
  const meta = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w]));

  const move = (index: number, delta: number) => {
    const next = [...draft];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    setDraft(next);
  };

  async function save() {
    await update.mutateAsync({ dashboard_widgets: draft });
    qc.setQueryData<DashboardSummary>(["dashboard"], (prev) => (prev ? { ...prev, widgets: draft } : prev));
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(widgets);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customize dashboard</DialogTitle>
          <DialogDescription>Choose which widgets to show and their order.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {draft.map((w, i) => (
            <li key={w.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <Switch checked={w.visible} aria-label={`Show ${meta.get(w.id)?.title}`} onCheckedChange={(v) => setDraft(draft.map((d) => (d.id === w.id ? { ...d, visible: v } : d)))} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{meta.get(w.id)?.title}</p>
                <p className="truncate text-xs text-muted-foreground">{meta.get(w.id)?.description}</p>
              </div>
              <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp />
              </Button>
              <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={i === draft.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown />
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={update.isPending}>
            Save layout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
