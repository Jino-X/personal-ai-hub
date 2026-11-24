"use client";

import type { Task, TaskListQuery, TaskPriority } from "@hub/shared";
import { TASK_PRIORITIES } from "@hub/shared";
import { endOfDay } from "date-fns";
import { FolderPlus, Inbox, ListTodo, Plus, Search, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api/client";
import { useProjectMutations, useProjects, useTasks, useTaskStats } from "@/lib/api/hooks/productivity";
import { cn } from "@/lib/utils";
import { COLOR_DOT, PRIORITY_META } from "./meta";
import { PlanPanel } from "./plan-panel";
import { TaskDialog } from "./task-dialog";
import { TaskRow } from "./task-row";
import { CompletedPerDayChart } from "./weekly-chart";

type View = "open" | "today" | "upcoming" | "overdue" | "done" | "all";
const VIEW_QUERY: Record<View, Pick<TaskListQuery, "status"> & Partial<Pick<TaskListQuery, "due" | "sort">>> = {
  open: { status: "open" },
  today: { status: "open", due: "today" },
  upcoming: { status: "open", due: "upcoming" },
  overdue: { status: "open", due: "overdue" },
  done: { status: "done" },
  all: { status: "all", sort: "created" },
};

function groupOpen(tasks: Task[]) {
  const now = new Date();
  const todayEnd = endOfDay(now);
  const groups: { label: string; items: Task[] }[] = [
    { label: "Overdue", items: [] },
    { label: "Today", items: [] },
    { label: "Upcoming", items: [] },
    { label: "No due date", items: [] },
  ];
  for (const t of tasks) {
    if (!t.due_at) groups[3]!.items.push(t);
    else if (new Date(t.due_at) < now) groups[0]!.items.push(t);
    else if (new Date(t.due_at) <= todayEnd) groups[1]!.items.push(t);
    else groups[2]!.items.push(t);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function TasksView() {
  const params = useSearchParams();
  const [view, setView] = useState<View>("open");
  const [project, setProject] = useState<string>("all");
  const [priority, setPriority] = useState<TaskPriority | "all">("all");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);

  const filters = {
    ...VIEW_QUERY[view],
    ...(project !== "all" ? { project_id: project } : {}),
    ...(priority !== "all" ? { priority } : {}),
    ...(q ? { q } : {}),
    limit: 200,
  };
  const tasks = useTasks(filters);
  const { data: projects = [] } = useProjects();
  const stats = useTaskStats("week");
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // Deep link: /productivity/tasks?task=<id> (from search and reminders).
  const deepLinkId = params.get("task");
  useEffect(() => {
    if (!deepLinkId) return;
    let cancelled = false;
    void api<Task>(`/v1/tasks/${deepLinkId}`)
      .then((t) => !cancelled && setEditing(t))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [deepLinkId]);

  const items = tasks.data?.items ?? [];
  const groups = view === "open" ? groupOpen(items) : [{ label: "", items }];

  return (
    <PageContainer wide>
      <PageHeader
        title="Tasks"
        description="Plan, prioritise and finish what matters."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New task
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
        <ProjectsPanel selected={project} onSelect={setProject} />

        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Tabs value={view} onValueChange={(v) => setView(v as View)} className="overflow-x-auto">
              <TabsList>
                <TabsTrigger value="open">Open</TabsTrigger>
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="overdue">Overdue</TabsTrigger>
                <TabsTrigger value="done">Done</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-1 gap-2">
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search tasks" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority | "all")}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All priorities</SelectItem>
                  {[...TASK_PRIORITIES].reverse().map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {tasks.isPending ? (
            <ListSkeleton rows={6} />
          ) : tasks.isError ? (
            <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title={q ? "No matching tasks" : view === "done" ? "Nothing completed yet" : "You're all clear"}
              description={q ? "Try a different search." : "Add a task to get started — or ask the assistant to create some for you."}
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus /> New task
                </Button>
              }
            />
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <section key={group.label || "all"} className="space-y-2">
                  {group.label && (
                    <h2 className={cn("text-xs font-semibold tracking-wide text-muted-foreground uppercase", group.label === "Overdue" && "text-destructive")}>
                      {group.label} · {group.items.length}
                    </h2>
                  )}
                  {group.items.map((task) => {
                    const p = task.project_id ? projectById.get(task.project_id) : undefined;
                    return <TaskRow key={task.id} task={task} projectName={p?.name} projectColor={p?.color} onEdit={setEditing} />;
                  })}
                </section>
              ))}
              {tasks.data && tasks.data.total > items.length && (
                <p className="text-center text-xs text-muted-foreground">
                  Showing {items.length} of {tasks.data.total}. Narrow the filters to see more.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <PlanPanel />
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">This week</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {stats.data ? (
                <>
                  <CompletedPerDayChart data={stats.data.completed_per_day} />
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Completed</dt>
                      <dd className="text-lg font-semibold tabular-nums">{stats.data.completed_total}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Created</dt>
                      <dd className="text-lg font-semibold tabular-nums">{stats.data.created_total}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Overdue</dt>
                      <dd className={cn("text-lg font-semibold tabular-nums", stats.data.overdue_open > 0 && "text-destructive")}>
                        {stats.data.overdue_open}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : stats.isError ? (
                <ErrorState compact error={stats.error} onRetry={() => void stats.refetch()} />
              ) : (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <TaskDialog
        open={creating || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        task={editing}
        defaults={project !== "all" && project !== "none" ? { project_id: project } : undefined}
      />
    </PageContainer>
  );
}

function ProjectsPanel({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { data: projects = [] } = useProjects();
  const { create, remove } = useProjectMutations();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await create.mutateAsync({ name: name.trim(), color: "violet" });
    setName("");
    setAdding(false);
  }

  const item = (id: string, label: string, icon: ReactNode, count?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => onSelect(id)}
      data-active={selected === id}
      className="nav-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
    </button>
  );

  return (
    <nav className="space-y-1" aria-label="Projects">
      {item("all", "All tasks", <ListTodo className="size-4" />)}
      {item("none", "Inbox", <Inbox className="size-4" />)}
      <div className="flex items-center justify-between pt-3 pb-1">
        <span className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Projects</span>
        <Button size="icon-xs" variant="ghost" aria-label="New project" onClick={() => setAdding((v) => !v)}>
          <FolderPlus />
        </Button>
      </div>
      {adding && (
        <form onSubmit={add} className="px-1 pb-1">
          <Input autoFocus placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
        </form>
      )}
      {projects.map((p) => (
        <div key={p.id} className="group relative">
          {item(p.id, p.name, <span className={cn("ml-1 size-2 rounded-full", COLOR_DOT[p.color] ?? COLOR_DOT.slate)} />, p.open_task_count)}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Delete project ${p.name}`}
            className="absolute top-1 right-1 hidden group-hover:inline-flex"
            onClick={() => {
              if (confirm(`Delete "${p.name}"? Its tasks move to the inbox.`)) {
                remove.mutate(p.id);
                if (selected === p.id) onSelect("all");
              }
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      {projects.length === 0 && !adding && <p className="px-2 text-xs text-muted-foreground">No projects yet.</p>}
    </nav>
  );
}
