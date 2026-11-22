"use client";

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { usePlanDay } from "@/lib/api/hooks/productivity";
import { relativeTime } from "@/lib/format";

/** AI daily planning suggestions from the Personal Productivity Agent. */
export function PlanPanel() {
  const plan = usePlanDay();
  const data = plan.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-primary" /> Plan my day
        </CardTitle>
        <CardDescription>Your local AI suggests a focus list from your tasks, calendar and goals.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data ? (
          <>
            <p className="text-sm">{data.summary}</p>
            {data.focus.length > 0 && (
              <ol className="space-y-2">
                {data.focus.map((f, i) => (
                  <li key={f.task_id} className="flex gap-2 text-sm">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-medium">{f.title}</p>
                      <p className="text-xs text-muted-foreground">{f.reason}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {data.defer.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Can wait</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {data.defer.map((d) => (
                    <li key={d.task_id}>
                      <span className="text-foreground">{d.title}</span> — {d.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.tips.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {data.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-[10px]">
                AI-generated{data.model ? ` · ${data.model}` : ""} · {relativeTime(data.generated_at)}
              </Badge>
              <Button size="xs" variant="ghost" disabled={plan.isPending} onClick={() => plan.mutate()}>
                Regenerate
              </Button>
            </div>
          </>
        ) : (
          <Button className="w-full" variant="outline" disabled={plan.isPending} onClick={() => plan.mutate()}>
            {plan.isPending ? <Spinner /> : <Sparkles />}
            {plan.isPending ? "Thinking…" : "Suggest a plan"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
