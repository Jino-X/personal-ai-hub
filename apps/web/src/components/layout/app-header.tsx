"use client";

import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AIStatusIndicator } from "./ai-status-indicator";
import { usePalette } from "./command-palette";
import { NotificationsMenu } from "./notifications-menu";
import { useQuickActions } from "./quick-actions";
import { UserMenu } from "./user-menu";

export function AppHeader() {
  const palette = usePalette();
  const quick = useQuickActions();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <button
        type="button"
        onClick={palette.open}
        className="flex h-8 w-full max-w-sm items-center gap-2 rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">Search or jump to…</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" className="hidden sm:inline-flex" onClick={() => quick.open("task")}>
          <Plus /> New task
        </Button>
        <AIStatusIndicator />
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  );
}
