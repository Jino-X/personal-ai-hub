"use client";

import type { BriefingKind } from "@hub/shared";
import { Newspaper, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBriefing, useBriefings, useDeleteBriefing, useGenerateBriefing } from "@/lib/api/hooks/briefings";
import { friendlyDate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BriefingContentView } from "./briefing-content";

export function BriefingsView() {
  const params = useSearchParams();
  const [kind, setKind] = useState<BriefingKind>("daily");
  const list = useBriefings(kind);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"));
  const effectiveId = selectedId ?? list.data?.[0]?.id ?? null;
  const briefing = useBriefing(effectiveId);
  const generate = useGenerateBriefing();
  const remove = useDeleteBriefing();

  return (
    <PageContainer wide>
      <PageHeader
        title="Briefings"
        description="Daily and weekly briefings built from your tasks, calendar, goals, saved research and the latest AI developments."
        actions={
          <Button
            disabled={generate.isPending}
            onClick={() =>
              generate.mutate(kind, {
                onSuccess: (b) => setSelectedId(b.id),
              })
            }
          >
            {generate.isPending ? <Spinner /> : <RefreshCw />} Generate {kind} briefing
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Tabs
            value={kind}
            onValueChange={(v) => {
              setKind(v as BriefingKind);
              setSelectedId(null);
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="daily" className="flex-1">
                Daily
              </TabsTrigger>
              <TabsTrigger value="weekly" className="flex-1">
                Weekly
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {list.isPending ? (
            <ListSkeleton rows={4} />
          ) : (
            <nav className="space-y-1" aria-label="Briefing history">
              {(list.data ?? []).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  className={cn("flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent", effectiveId === b.id && "bg-accent font-medium")}
                >
                  <span>{b.kind === "daily" ? friendlyDate(b.period_start) : `Week of ${friendlyDate(b.period_start)}`}</span>
                  {b.ai_status === "done" && <Sparkles className="size-3 text-primary" aria-label="Includes AI summary" />}
                </button>
              ))}
              {(list.data ?? []).length === 0 && <p className="px-2 text-sm text-muted-foreground">No {kind} briefings yet.</p>}
            </nav>
          )}
        </div>

        <div className="min-w-0">
          {!effectiveId ? (
            <EmptyState
              icon={Newspaper}
              title={`No ${kind} briefing yet`}
              description={
                kind === "daily"
                  ? "Briefings are generated automatically each morning at the time set in Settings. You can also generate one now."
                  : "Weekly briefings arrive on your chosen day. You can generate this week's now."
              }
              action={
                <Button size="sm" onClick={() => generate.mutate(kind, { onSuccess: (b) => setSelectedId(b.id) })} disabled={generate.isPending}>
                  {generate.isPending && <Spinner />} Generate now
                </Button>
              }
            />
          ) : briefing.isPending ? (
            <ListSkeleton rows={5} />
          ) : briefing.isError || !briefing.data ? (
            <ErrorState error={briefing.error} onRetry={() => void briefing.refetch()} />
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-lg">{briefing.data.title}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{briefing.data.kind}</Badge>
                    {briefing.data.generated_at && <span>Generated {relativeTime(briefing.data.generated_at)}</span>}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete briefing"
                  onClick={() => {
                    remove.mutate(briefing.data!.id);
                    setSelectedId(null);
                  }}
                >
                  <Trash2 />
                </Button>
              </CardHeader>
              <CardContent>
                <BriefingContentView briefing={briefing.data} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
