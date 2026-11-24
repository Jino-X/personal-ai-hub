"use client";

import { LEARNING_RESOURCE_KINDS, type GoalWithDetails, type LearningResource, type LearningResourceKind, type LearningResourceStatus, type Skill } from "@hub/shared";
import { BookOpen, Check, ExternalLink, GraduationCap, Minus, Plus, Sparkles, Target, Trash2, Trophy } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useGoalAnalysis,
  useGoals,
  useLearningResources,
  useResourceMutations,
  useSkillMutations,
  useSkills,
  useTasks,
} from "@/lib/api/hooks/productivity";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddMilestoneForm, GoalCard, MilestoneRow } from "./goal-card";
import { GoalDialog } from "./goal-dialog";
import { TaskDialog } from "./task-dialog";
import { TaskRow } from "./task-row";

export function GoalsView() {
  const params = useSearchParams();
  const goals = useGoals("current");
  const analysis = useGoalAnalysis();
  const [tab, setTab] = useState("goals");
  const [goalDialog, setGoalDialog] = useState<{ open: boolean; goal?: GoalWithDetails | null; type?: "personal" | "learning" }>({ open: false });
  const [taskForGoal, setTaskForGoal] = useState<string | null>(null);

  const focusGoal = params.get("goal");
  useEffect(() => {
    if (focusGoal && goals.data) document.getElementById(`goal-${focusGoal}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusGoal, goals.data]);

  const all = goals.data ?? [];
  const learning = all.filter((g) => g.type === "learning");

  return (
    <PageContainer wide>
      <PageHeader
        title="Goals & Learning"
        description="Turn ambitions into measurable milestones, learning paths and skills."
        actions={
          <>
            <Button variant="outline" disabled={analysis.isPending} onClick={() => analysis.mutate()}>
              {analysis.isPending ? <Spinner /> : <Sparkles />} Analyze my week
            </Button>
            <Button onClick={() => setGoalDialog({ open: true, type: tab === "learning" ? "learning" : "personal" })}>
              <Plus /> {tab === "learning" ? "New learning path" : "New goal"}
            </Button>
          </>
        }
      />

      {analysis.data && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="size-4 text-primary" /> Weekly progress analysis
            </CardTitle>
            <CardDescription>
              AI-generated from your goals, milestones and completed work · {analysis.data.model} · {relativeTime(analysis.data.generated_at)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>{analysis.data.summary}</p>
            <div className="grid gap-4 md:grid-cols-3">
              {(
                [
                  ["Wins", analysis.data.wins],
                  ["At risk", analysis.data.risks],
                  ["Next steps", analysis.data.next_steps],
                ] as const
              ).map(([label, list]) => (
                <div key={label}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {list.length ? list.map((x) => <li key={x}>{x}</li>) : <li className="text-muted-foreground">—</li>}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="goals">
            <Target /> Goals
          </TabsTrigger>
          <TabsTrigger value="learning">
            <GraduationCap /> Learning
          </TabsTrigger>
          <TabsTrigger value="skills">
            <Trophy /> Skills
          </TabsTrigger>
        </TabsList>

        <TabsContent value="goals" className="mt-4">
          {goals.isPending ? (
            <CardGridSkeleton />
          ) : goals.isError ? (
            <ErrorState error={goals.error} onRetry={() => void goals.refetch()} />
          ) : all.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No goals yet"
              description="Try “Prepare for technical interviews”, “Learn AI engineering” or “Ship my side project”."
              action={
                <Button size="sm" onClick={() => setGoalDialog({ open: true })}>
                  <Plus /> New goal
                </Button>
              }
            />
          ) : (
            <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {all.map((g) => (
                <GoalCard key={g.id} goal={g} onEdit={() => setGoalDialog({ open: true, goal: g })} onAddTask={() => setTaskForGoal(g.id)} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="learning" className="mt-4">
          <LearningTab paths={learning} onNewPath={() => setGoalDialog({ open: true, type: "learning" })} onAddTask={setTaskForGoal} />
        </TabsContent>

        <TabsContent value="skills" className="mt-4">
          <SkillsTab />
        </TabsContent>
      </Tabs>

      <GoalDialog
        open={goalDialog.open}
        goal={goalDialog.goal}
        defaultType={goalDialog.type}
        onOpenChange={(open) => !open && setGoalDialog({ open: false })}
      />
      <TaskDialog
        open={taskForGoal !== null}
        onOpenChange={(o) => !o && setTaskForGoal(null)}
        defaults={taskForGoal ? { goal_id: taskForGoal, category: learning.some((l) => l.id === taskForGoal) ? "learning" : undefined } : undefined}
      />
    </PageContainer>
  );
}

const RESOURCE_STATUS_NEXT: Record<LearningResourceStatus, LearningResourceStatus> = { todo: "in_progress", in_progress: "done", done: "todo" };

function LearningTab({ paths, onNewPath, onAddTask }: { paths: GoalWithDetails[]; onNewPath: () => void; onAddTask: (goalId: string) => void }) {
  const { data: resources = [] } = useLearningResources();
  const pathIds = paths.map((p) => p.id);
  const todayTasks = useTasks({ status: "open", due: "today", limit: 100 }, paths.length > 0);
  const learningToday = (todayTasks.data?.items ?? []).filter((t) => t.goal_id && pathIds.includes(t.goal_id));
  const unassigned = resources.filter((r) => !r.goal_id);

  if (paths.length === 0 && resources.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="Start a learning path"
        description="Create a path like “AI engineering”, add lessons and resources, and track daily learning tasks."
        action={
          <Button size="sm" onClick={onNewPath}>
            <Plus /> New learning path
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {paths.map((path) => (
          <LearningPathCard key={path.id} path={path} resources={resources.filter((r) => r.goal_id === path.id)} onAddTask={() => onAddTask(path.id)} />
        ))}
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Today&apos;s learning</CardTitle>
            <CardDescription>Open tasks due today on your learning paths.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {learningToday.length ? (
              learningToday.map((t) => <TaskRow key={t.id} task={t} compact />)
            ) : (
              <p className="text-sm text-muted-foreground">Nothing scheduled — add a learning task to a path.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Other resources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {unassigned.map((r) => (
              <ResourceRow key={r.id} resource={r} />
            ))}
            <AddResourceForm goalId={null} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LearningPathCard({ path, resources, onAddTask }: { path: GoalWithDetails; resources: LearningResource[]; onAddTask: () => void }) {
  const [addingLesson, setAddingLesson] = useState(false);
  const lessons = path.milestones.filter((m) => m.kind === "lesson");
  const doneLessons = lessons.filter((l) => l.completed_at).length;

  return (
    <Card id={`goal-${path.id}`}>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{path.title}</CardTitle>
            <CardDescription>
              {doneLessons}/{lessons.length} lessons · {resources.filter((r) => r.status === "done").length}/{resources.length} resources
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={onAddTask}>
            <Plus /> Learning task
          </Button>
        </div>
        <Progress value={path.progress} className="h-1.5" />
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Lessons</p>
          {lessons.map((l) => (
            <MilestoneRow key={l.id} milestone={l} />
          ))}
          {addingLesson ? (
            <AddMilestoneForm goalId={path.id} kind="lesson" onDone={() => setAddingLesson(false)} />
          ) : (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setAddingLesson(true)}>
              <Plus /> Add lesson
            </Button>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Resources</p>
          {resources.map((r) => (
            <ResourceRow key={r.id} resource={r} />
          ))}
          <AddResourceForm goalId={path.id} />
        </div>
      </CardContent>
    </Card>
  );
}

function ResourceRow({ resource: r }: { resource: LearningResource }) {
  const { update, remove } = useResourceMutations();
  return (
    <div className="group flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={() => update.mutate({ id: r.id, status: RESOURCE_STATUS_NEXT[r.status] })}
        aria-label={`Status: ${r.status}. Click to advance.`}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          r.status === "done" && "border-success bg-success text-background",
          r.status === "in_progress" && "border-primary bg-primary/30",
        )}
      >
        {r.status === "done" && <Check className="size-3" />}
      </button>
      <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("flex-1 truncate", r.status === "done" && "text-muted-foreground line-through")}>{r.title}</span>
      <Badge variant="outline" className="text-[10px]">
        {r.kind}
      </Badge>
      {r.url && (
        <a href={r.url} target="_blank" rel="noopener noreferrer" aria-label="Open resource" className="text-muted-foreground hover:text-foreground">
          <ExternalLink className="size-3.5" />
        </a>
      )}
      <Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100" aria-label="Delete resource" onClick={() => remove.mutate(r.id)}>
        <Trash2 />
      </Button>
    </div>
  );
}

function AddResourceForm({ goalId }: { goalId: string | null }) {
  const { create } = useResourceMutations();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<LearningResourceKind>("article");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await create.mutateAsync({ title: title.trim(), url: url.trim() || null, kind, goal_id: goalId });
    setTitle("");
    setUrl("");
  }

  return (
    <form onSubmit={submit} className="space-y-2 pt-1">
      <div className="flex gap-2">
        <Input className="h-8" placeholder="Add a resource" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Select value={kind} onValueChange={(v) => setKind(v as LearningResourceKind)}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEARNING_RESOURCE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {title && (
        <div className="flex gap-2">
          <Input className="h-8" type="url" placeholder="https://… (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button size="sm" type="submit" disabled={create.isPending}>
            Add
          </Button>
        </div>
      )}
    </form>
  );
}

function SkillsTab() {
  const skills = useSkills();
  const { create, update, remove } = useSkillMutations();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await create.mutateAsync({ name: name.trim(), category: category.trim() || null, level: 1, target_level: 4 });
    setName("");
  }

  const list: Skill[] = skills.data ?? [];

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex max-w-xl gap-2">
        <Input placeholder="Skill (e.g. System design)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="w-40" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          <Plus /> Add
        </Button>
      </form>
      {skills.isPending ? (
        <CardGridSkeleton cards={3} />
      ) : list.length === 0 ? (
        <EmptyState icon={Trophy} title="Track your technical skills" description="Add skills, rate your current level and set a target." />
      ) : (
        <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <Card key={s.id} className="lift gap-3 py-4">
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.category ?? "General"} · {s.last_practiced_at ? `practiced ${relativeTime(s.last_practiced_at)}` : "not practiced yet"}
                    </p>
                  </div>
                  <Button size="icon-xs" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => remove.mutate(s.id)}>
                    <Trash2 />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="icon-xs" variant="outline" aria-label="Lower level" disabled={s.level <= 0} onClick={() => update.mutate({ id: s.id, level: s.level - 1 })}>
                    <Minus />
                  </Button>
                  <div className="flex flex-1 gap-1" role="meter" aria-valuemin={0} aria-valuemax={5} aria-valuenow={s.level} aria-label={`${s.name} level`}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "h-2 flex-1 rounded-full bg-muted",
                          i < s.level && "bg-primary",
                          i >= s.level && i < s.target_level && "bg-primary/20",
                        )}
                      />
                    ))}
                  </div>
                  <Button size="icon-xs" variant="outline" aria-label="Raise level" disabled={s.level >= 5} onClick={() => update.mutate({ id: s.id, level: s.level + 1 })}>
                    <Plus />
                  </Button>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Level {s.level} · target {s.target_level}
                  </span>
                  <Button size="xs" variant="ghost" onClick={() => update.mutate({ id: s.id, practiced: true })}>
                    <Check /> Practiced today
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
