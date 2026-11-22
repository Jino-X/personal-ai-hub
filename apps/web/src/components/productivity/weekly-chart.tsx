"use client";

import { format, parseISO } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Single-series bar chart: tasks completed per day.
 * One hue (no legend — the title names the series), bars anchored to the baseline with
 * 4px rounded data-ends, 2px gaps, per-bar hover tooltip and a screen-reader table.
 */
export function CompletedPerDayChart({ data, title = "Tasks completed per day" }: { data: { date: string; count: number }[]; title?: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const peak = data.reduce((best, d) => (d.count > best.count ? d : best), data[0] ?? { date: "", count: 0 });

  return (
    <figure className="space-y-2">
      <figcaption className="text-xs font-medium text-muted-foreground">{title}</figcaption>
      <div className="relative h-28" aria-hidden>
        <div className="absolute inset-x-0 bottom-0 h-px bg-border" />
        <div className="flex h-full items-end gap-[2px]">
          {data.map((d) => (
            <Tooltip key={d.date}>
              <TooltipTrigger asChild>
                <div className="flex h-full flex-1 cursor-default flex-col justify-end" tabIndex={-1}>
                  {d.count > 0 && d.date === peak.date && (
                    <span className="mb-1 text-center text-[10px] text-muted-foreground tabular-nums">{d.count}</span>
                  )}
                  <div
                    className="mx-auto w-full max-w-7 rounded-t-[4px] bg-chart-1 transition-opacity hover:opacity-80"
                    style={{ height: d.count > 0 ? `${Math.max(4, (d.count / max) * 88)}%` : "2px", opacity: d.count > 0 ? 1 : 0.35 }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {format(parseISO(d.date), "EEE d MMM")}: <span className="font-medium tabular-nums">{d.count}</span> completed
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="flex gap-[2px] text-center text-[10px] text-muted-foreground" aria-hidden>
        {data.map((d) => (
          <span key={d.date} className="flex-1 truncate">
            {data.length <= 7 ? format(parseISO(d.date), "EEE") : format(parseISO(d.date), "d")}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
