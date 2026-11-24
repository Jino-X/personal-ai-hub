"use client";

import type { CalendarEvent } from "@hub/shared";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  setHours,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ExternalLink, MapPin, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useCalendarEvents, useEventMutations } from "@/lib/api/hooks/productivity";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { cn } from "@/lib/utils";

function eventOnDay(e: CalendarEvent, day: Date) {
  const start = new Date(e.starts_at);
  const end = e.ends_at ? new Date(e.ends_at) : start;
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return start < dayEnd && end >= dayStart;
}

function timeLabel(e: CalendarEvent) {
  if (e.all_day) return "All day";
  const start = format(new Date(e.starts_at), "HH:mm");
  return e.ends_at ? `${start}–${format(new Date(e.ends_at), "HH:mm")}` : start;
}

export function CalendarView() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [creating, setCreating] = useState(false);

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const events = useCalendarEvents(gridStart.toISOString(), addDays(gridEnd, 1).toISOString());
  const list = events.data ?? [];
  const dayEvents = list.filter((e) => eventOnDay(e, selected));
  const hasGoogle = list.some((e) => e.source === "google");

  return (
    <PageContainer wide>
      <PageHeader
        title="Calendar"
        description={
          hasGoogle ? (
            "Local events and your synced Google Calendar."
          ) : (
            <>
              Local events. <Link className="text-primary underline-offset-4 hover:underline" href="/settings/integrations">Connect Google Calendar</Link> to sync yours.
            </>
          )
        }
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New event
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="gap-0 py-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-medium">{format(month, "MMMM yyyy")}</h2>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setMonth(startOfMonth(new Date()));
                  setSelected(startOfDay(new Date()));
                }}
              >
                Today
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
                <ChevronRight />
              </Button>
            </div>
          </div>
          {events.isError ? (
            <div className="p-4">
              <ErrorState compact error={events.error} onRetry={() => void events.refetch()} />
            </div>
          ) : (
            <div className="grid grid-cols-7 text-xs">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="border-b px-2 py-1.5 text-center font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
              {days.map((day) => {
                const items = list.filter((e) => eventOnDay(e, day));
                return (
                  <button
                    type="button"
                    key={day.toISOString()}
                    onClick={() => setSelected(day)}
                    className={cn(
                      "min-h-20 border-r border-b p-1.5 text-left align-top transition-colors hover:bg-accent/40 md:min-h-24 [&:nth-child(7n)]:border-r-0",
                      !isSameMonth(day, month) && "bg-muted/30 text-muted-foreground",
                      isSameDay(day, selected) && "bg-[radial-gradient(120%_100%_at_0%_0%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_35%,transparent)]",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded-full text-xs",
                        isToday(day) && "bg-[linear-gradient(145deg,var(--tile-from),var(--tile-to))] font-semibold text-white shadow-[0_0_14px_-2px_var(--primary)]",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    <div className="mt-1 space-y-0.5">
                      {events.isPending ? null : items.slice(0, 3).map((e) => (
                        <div
                          key={e.id}
                          className={cn(
                            "truncate rounded px-1 py-0.5 text-[11px]",
                            e.source === "google" ? "bg-chart-2/20 text-foreground" : "bg-primary/15 text-foreground",
                          )}
                        >
                          {!e.all_day && <span className="mr-1 tabular-nums opacity-70">{format(new Date(e.starts_at), "HH:mm")}</span>}
                          {e.title}
                        </div>
                      ))}
                      {items.length > 3 && <div className="px-1 text-[11px] text-muted-foreground">+{items.length - 3} more</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{format(selected, "EEEE d MMMM")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {events.isPending ? (
              <>
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </>
            ) : dayEvents.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
                <CalendarDays className="size-6" />
                Nothing scheduled.
                <Button size="xs" variant="outline" onClick={() => setCreating(true)}>
                  <Plus /> Add event
                </Button>
              </div>
            ) : (
              dayEvents.map((e) => <EventItem key={e.id} event={e} />)
            )}
          </CardContent>
        </Card>
      </div>

      <EventDialog open={creating} onOpenChange={setCreating} day={selected} />
    </PageContainer>
  );
}

function EventItem({ event: e }: { event: CalendarEvent }) {
  const { remove } = useEventMutations();
  return (
    <div data-slot="card" className="lift group space-y-1 rounded-xl border bg-card/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{e.title}</p>
        {e.source === "google" ? (
          <Badge variant="outline" className="text-[10px]">
            Google
          </Badge>
        ) : (
          <Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100" aria-label="Delete event" onClick={() => remove.mutate(e.id)}>
            <Trash2 />
          </Button>
        )}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3" /> {timeLabel(e)}
      </p>
      {e.location && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" /> {e.location}
        </p>
      )}
      {e.url && (
        <a href={e.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary">
          <ExternalLink className="size-3" /> Open link
        </a>
      )}
      {e.description && <p className="line-clamp-3 text-xs text-muted-foreground">{e.description}</p>}
    </div>
  );
}

function EventDialog({ open, onOpenChange, day }: { open: boolean; onOpenChange: (o: boolean) => void; day: Date }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open && <EventForm day={day} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function EventForm({ day, onDone }: { day: Date; onDone: () => void }) {
  const { create } = useEventMutations();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(toLocalInput(setHours(day, 9).toISOString()));
  const [end, setEnd] = useState(toLocalInput(setHours(day, 10).toISOString()));
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const startsAt = allDay ? startOfDay(new Date(start)).toISOString() : fromLocalInput(start);
    if (!startsAt) return;
    await create.mutateAsync({
      title: title.trim(),
      starts_at: startsAt,
      ends_at: allDay ? null : fromLocalInput(end),
      all_day: allDay,
      location: location.trim() || null,
      description: description.trim() || null,
    });
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>New event</DialogTitle>
        <DialogDescription>Stored in Personal AI Hub (not synced back to Google).</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="ev-title">Title</Label>
        <Input id="ev-title" autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="ev-allday" checked={allDay} onCheckedChange={(v) => setAllDay(Boolean(v))} />
        <Label htmlFor="ev-allday">All day</Label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="ev-start">Starts</Label>
          <Input id="ev-start" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        {!allDay && (
          <div className="space-y-2">
            <Label htmlFor="ev-end">Ends</Label>
            <Input id="ev-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="ev-loc">Location</Label>
        <Input id="ev-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ev-desc">Notes</Label>
        <Textarea id="ev-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending || !title.trim()}>
          {create.isPending && <Spinner />} Add event
        </Button>
      </DialogFooter>
    </form>
  );
}
