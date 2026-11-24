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
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 bg-background/70 px-3 backdrop-blur-xl backdrop-saturate-150 md:px-4">
      {/* A hairline that brightens in the middle, like light catching an edge */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,var(--border)_15%,color-mix(in_oklch,var(--primary)_45%,transparent)_50%,var(--border)_85%,transparent)]" />
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <button
        type="button"
        onClick={palette.open}
        className="group flex h-9 w-full max-w-sm items-center gap-2 rounded-xl border bg-muted/30 px-3 text-sm text-muted-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.04)] transition-all hover:border-primary/40 hover:bg-muted/60 hover:shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_10%,transparent)]"
      >
        <Search className="size-4 transition-transform group-hover:scale-110 group-hover:text-primary" />
        <span className="flex-1 truncate text-left">Search or jump to…</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" className="mr-1 hidden shadow-[0_8px_20px_-8px_var(--primary)] sm:inline-flex" onClick={() => quick.open("task")}>
          <Plus /> New task
        </Button>
        <AIStatusIndicator />
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  );
}
