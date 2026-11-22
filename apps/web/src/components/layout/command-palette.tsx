"use client";

import { AlarmClock, ListTodo, MessageSquare, Monitor, Moon, Plug, StickyNote, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { ALL_NAV_ITEMS } from "@/config/navigation";
import { useQuickActions } from "./quick-actions";
import { SearchResults } from "./search-results";

const PaletteContext = createContext<{ open: () => void } | null>(null);

export function usePalette() {
  const ctx = use(PaletteContext);
  if (!ctx) throw new Error("usePalette must be used within CommandPaletteProvider");
  return ctx;
}

/** ⌘K / Ctrl+K command palette: navigation, quick actions and global search. */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { setTheme } = useTheme();
  const quick = useQuickActions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    setQuery("");
    fn();
  };

  return (
    <PaletteContext value={{ open: () => setOpen(true) }}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Navigate, create and search">
        <Command shouldFilter={query.trim().length < 2}>
          <CommandInput placeholder="Search or type a command…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[420px]">
            <CommandEmpty>No results.</CommandEmpty>
            {query.trim().length >= 2 ? (
              <SearchResults query={query.trim()} onSelect={(href) => run(() => router.push(href))} />
            ) : (
              <>
                <CommandGroup heading="Create">
                  <CommandItem onSelect={() => run(() => quick.open("task"))}>
                    <ListTodo /> New task
                    <CommandShortcut>T</CommandShortcut>
                  </CommandItem>
                  <CommandItem onSelect={() => run(() => quick.open("reminder"))}>
                    <AlarmClock /> New reminder
                  </CommandItem>
                  <CommandItem onSelect={() => run(() => quick.open("note"))}>
                    <StickyNote /> New note
                  </CommandItem>
                  <CommandItem onSelect={() => run(() => router.push("/assistant"))}>
                    <MessageSquare /> Ask the assistant
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Go to">
                  {ALL_NAV_ITEMS.map((item) => (
                    <CommandItem key={item.href} value={`${item.title} ${item.description}`} onSelect={() => run(() => router.push(item.href))}>
                      <item.icon /> {item.title}
                      <span className="ml-auto truncate text-xs text-muted-foreground">{item.description}</span>
                    </CommandItem>
                  ))}
                  <CommandItem onSelect={() => run(() => router.push("/settings/ai"))}>
                    <Plug /> Pair a local AI device
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Theme">
                  <CommandItem onSelect={() => run(() => setTheme("dark"))}>
                    <Moon /> Dark
                  </CommandItem>
                  <CommandItem onSelect={() => run(() => setTheme("light"))}>
                    <Sun /> Light
                  </CommandItem>
                  <CommandItem onSelect={() => run(() => setTheme("system"))}>
                    <Monitor /> System
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </PaletteContext>
  );
}
