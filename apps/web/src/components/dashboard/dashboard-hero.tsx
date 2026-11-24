"use client";

import type { DashboardSummary } from "@hub/shared";
import { format } from "date-fns";
import { CalendarDays, CheckCircle2, Cpu, ListTodo, Target, type LucideIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { DepthSurface } from "@/components/auth/depth-surface";
import { useAIStatus } from "@/lib/api/hooks/system";
import { friendlyDate, greeting } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Counts up to `value` over ~700 ms when it first arrives or changes; reduced motion shows it at once. */
function useCountUp(value: number | null) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (value === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / 700);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return value === null ? null : shown;
}

function Ring({ value }: { value: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="size-11 -rotate-90" aria-hidden>
      <defs>
        <linearGradient id="hero-ring" x1="0" x2="1">
          <stop offset="0%" stopColor="var(--chart-2)" />
          <stop offset="100%" stopColor="var(--primary)" />
        </linearGradient>
      </defs>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--muted)" strokeWidth="3.5" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="url(#hero-ring)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value / 100)}
        className="transition-[stroke-dashoffset] duration-1000 ease-out"
      />
    </svg>
  );
}

/** One floating figure; `z` is how far it rises towards the viewer as the hero tilts. */
function Stat({
  icon: Icon,
  tint,
  label,
  value,
  suffix,
  sub,
  z,
  delay,
  aside,
}: {
  icon: LucideIcon;
  tint: string;
  label: string;
  value: number | null;
  suffix?: string;
  sub: ReactNode;
  z: number;
  delay: number;
  aside?: ReactNode;
}) {
  const shown = useCountUp(value);
  return (
    <div className="[transform-style:preserve-3d]" style={{ transform: `translateZ(${z}px)` }}>
      <div
        className="animate-float flex h-full items-center gap-3 rounded-2xl border bg-card/80 p-4 shadow-[0_24px_48px_-24px_oklch(0_0_0/0.55)] backdrop-blur-md"
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="icon-chip size-6 rounded-md" style={{ "--tint": tint } as CSSProperties}>
              <Icon className="size-3.5" />
            </span>
            {label}
          </p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">
            {shown === null ? "–" : shown}
            {suffix && shown !== null && <span className="ml-0.5 text-lg text-muted-foreground">{suffix}</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{sub}</p>
        </div>
        {aside && <div className="hidden shrink-0 sm:block">{aside}</div>}
      </div>
    </div>
  );
}

/**
 * The dashboard's opening band: the date and a greeting with a one-line read of the day, the quick
 * actions, and the day's figures as floating tiles in a scene that tilts towards the pointer.
 */
export function DashboardHero({ data, actions }: { data?: DashboardSummary; actions: ReactNode }) {
  const ai = useAIStatus();
  const name = data?.profile.display_name?.split(" ")[0];
  const due = data ? data.tasks.today.length + data.tasks.overdue.length : null;
  const overdue = data?.tasks.overdue.length ?? 0;
  const goalAvg = data && data.goals.length ? Math.round(data.goals.reduce((s, g) => s + g.progress, 0) / data.goals.length) : data ? 0 : null;
  const nextEvent = data?.events[0];
  const aiState = ai.data ? (ai.data.available ? (ai.data.chat_model_available ? "online" : "partial") : "offline") : "unknown";

  const summary = !data
    ? "Pulling your day together…"
    : [
        due ? `${due} task${due === 1 ? "" : "s"} due` : "Nothing due today",
        overdue ? `${overdue} overdue` : null,
        data.events.length ? `${data.events.length} event${data.events.length === 1 ? "" : "s"} coming up` : null,
        data.intelligence.length ? `${data.intelligence.length} fresh AI updates` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <DepthSurface
      maxTilt={7}
      className="relative overflow-hidden rounded-3xl border bg-card/50 p-6 shadow-[inset_0_1px_0_oklch(1_0_0/0.06)] md:p-8"
    >
      {/* Light: colour drifting behind, and a glow that follows the pointer */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="animate-drift absolute -top-1/2 -left-1/4 size-[80%] rounded-full bg-[var(--orb-1)] blur-[90px]" />
        <div className="animate-drift absolute -right-1/4 -bottom-1/2 size-[70%] rounded-full bg-[var(--orb-2)] blur-[90px] [animation-delay:-8s]" />
        <div className="absolute inset-0 bg-[radial-gradient(520px_circle_at_var(--mx)_var(--my),var(--glow),transparent_60%)]" />
      </div>

      <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-[0.14em] text-primary/90 uppercase">{format(new Date(), "EEEE, d MMMM yyyy")}</p>
            <h1 className="text-gradient text-3xl font-semibold tracking-tight md:text-4xl">
              {greeting()}
              {name ? `, ${name}` : ""}
            </h1>
            <p className="text-sm text-muted-foreground">{summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">{actions}</div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex size-2">
              {aiState === "online" && <span className="animate-pulse-ring absolute inset-0 rounded-full bg-success" />}
              <span
                className={cn(
                  "relative size-2 rounded-full",
                  aiState === "online" ? "bg-success" : aiState === "partial" ? "bg-warning" : aiState === "offline" ? "bg-destructive" : "bg-muted-foreground",
                )}
              />
            </span>
            <Cpu className="size-3.5" />
            {aiState === "unknown"
              ? "Checking local AI…"
              : aiState === "offline"
                ? "Local AI offline: summaries and chat wait until it's back"
                : `Local AI ${aiState === "partial" ? "reachable, chat model missing" : "online"} · ${ai.data!.settings.chat_model}`}
          </p>
        </div>

        <div className="depth-perspective">
          <div className="depth-stage grid grid-cols-2 gap-3">
            <Stat
              icon={ListTodo}
              tint="var(--chart-1)"
              label="Due today"
              value={due}
              sub={overdue ? <span className="text-destructive">{overdue} overdue</span> : "All on track"}
              z={40}
              delay={0}
            />
            <Stat
              icon={CheckCircle2}
              tint="var(--chart-3)"
              label="Done today"
              value={data?.tasks.completed_today ?? null}
              sub={data ? `${data.tasks.open_total} still open` : " "}
              z={70}
              delay={-1500}
            />
            <Stat
              icon={CalendarDays}
              tint="var(--chart-2)"
              label="Next 3 days"
              value={data?.events.length ?? null}
              sub={nextEvent ? `${friendlyDate(nextEvent.starts_at)}: ${nextEvent.title}` : "A clear calendar"}
              z={60}
              delay={-3000}
            />
            <Stat
              icon={Target}
              tint="var(--chart-4)"
              label="Goal progress"
              value={goalAvg}
              suffix="%"
              sub={data ? `${data.goals.length} active goal${data.goals.length === 1 ? "" : "s"}` : " "}
              z={30}
              delay={-4500}
              aside={goalAvg !== null && <Ring value={goalAvg} />}
            />
          </div>
        </div>
      </div>
    </DepthSurface>
  );
}
