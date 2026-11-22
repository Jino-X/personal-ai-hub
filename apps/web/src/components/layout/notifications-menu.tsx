"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/lib/api/hooks/system";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function NotificationsMenu() {
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const seen = useRef<Set<string> | null>(null);

  // Toast newly-arrived unread notifications (but not the backlog on first load).
  useEffect(() => {
    if (!data) return;
    const unread = data.items.filter((n) => !n.read_at);
    if (seen.current) {
      for (const n of unread) if (!seen.current.has(n.id)) toast(n.title, { description: n.body ?? undefined });
    }
    seen.current = new Set(data.items.map((n) => n.id));
  }, [data]);

  const unread = data?.unread ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unread} unread)`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          <Button variant="ghost" size="xs" disabled={unread === 0} onClick={() => markAll.mutate()}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {!data || data.items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            <ul className="divide-y">
              {data.items.map((n) => {
                const body = (
                  <div className="space-y-0.5">
                    <p className={cn("text-sm", !n.read_at && "font-medium")}>{n.title}</p>
                    {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                    <p className="text-[11px] text-muted-foreground">{relativeTime(n.created_at)}</p>
                  </div>
                );
                return (
                  <li key={n.id} className={cn("px-3 py-2.5", !n.read_at && "bg-accent/40")}>
                    {n.link ? (
                      <Link href={n.link} onClick={() => !n.read_at && markRead.mutate(n.id)} className="block">
                        {body}
                      </Link>
                    ) : (
                      <button type="button" className="block w-full text-left" onClick={() => !n.read_at && markRead.mutate(n.id)}>
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
