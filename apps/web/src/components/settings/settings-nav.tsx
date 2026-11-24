"use client";

import { Cpu, Plug, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings", label: "General", icon: UserRound },
  { href: "/settings/ai", label: "AI & devices", icon: Cpu },
  { href: "/settings/integrations", label: "Integrations & sources", icon: Plug },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="glass flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border p-1" aria-label="Settings sections">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-all",
              active
                ? "bg-[linear-gradient(145deg,var(--tile-from),var(--tile-to))] font-medium text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.25),0_8px_20px_-10px_var(--tile-to)]"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <t.icon className="size-4" /> {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
