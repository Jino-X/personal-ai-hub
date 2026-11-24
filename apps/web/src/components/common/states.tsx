"use client";

import { CircleAlert, RefreshCw, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("relative overflow-hidden bg-card/30 py-10", className ?? "border border-dashed")}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(50%_100%_at_50%_0%,var(--glow),transparent)]" />
      <EmptyHeader>
        <EmptyMedia className="relative mb-3">
          <span aria-hidden className="animate-pulse-ring absolute inset-0 rounded-2xl border border-primary/40" />
          <span aria-hidden className="animate-pulse-ring absolute inset-0 rounded-2xl border border-primary/30 [animation-delay:1.2s]" />
          <span className="animate-float icon-tile size-12 rounded-2xl">
            <Icon className="size-5" />
          </span>
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function ErrorState({ error, onRetry, compact = false }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <CircleAlert className="size-4 shrink-0 text-destructive" />
        <span className="flex-1 text-muted-foreground">{errorMessage(error)}</span>
        {onRetry && (
          <Button size="xs" variant="ghost" onClick={onRetry}>
            <RefreshCw /> Retry
          </Button>
        )}
      </div>
    );
  }
  return (
    <EmptyState
      icon={CircleAlert}
      title="Couldn't load this"
      description={errorMessage(error)}
      action={
        onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw /> Try again
          </Button>
        )
      }
      className="border border-destructive/30"
    />
  );
}

export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={className ?? "space-y-3"}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border bg-card/40 p-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border bg-card/40 p-4">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}
