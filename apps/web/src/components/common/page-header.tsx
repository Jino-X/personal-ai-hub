"use client";

import type { LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DepthSurface } from "@/components/auth/depth-surface";
import { ALL_NAV_ITEMS, NAVIGATION } from "@/config/navigation";
import { cn } from "@/lib/utils";

/** The navigation entry a path belongs to, and the sidebar group it sits in. */
function navFor(pathname: string) {
  const item = [...ALL_NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  const group = item ? NAVIGATION.find((g) => g.items.includes(item))?.label : undefined;
  return { item, group };
}

/**
 * A page's title band: a glossy icon tile that tilts towards the pointer in 3D, the section it belongs
 * to, the title and description, and the page's actions. The icon and section come from the sidebar's
 * navigation for the current path unless given.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  eyebrow?: string;
}) {
  const pathname = usePathname();
  const nav = navFor(pathname);
  const Icon = icon ?? nav.item?.icon;
  const section = eyebrow ?? nav.group;

  return (
    <DepthSurface maxTilt={18} className="group/header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        {Icon && (
          <div className="depth-perspective hidden shrink-0 sm:block">
            <div className="depth-stage">
              <div className="icon-tile size-12 rounded-2xl">
                <Icon className="size-6" />
              </div>
            </div>
          </div>
        )}
        <div className="min-w-0 space-y-1">
          {section && <p className="text-[11px] font-medium tracking-[0.14em] text-primary/90 uppercase">{section}</p>}
          <h1 className="text-gradient text-2xl font-semibold tracking-tight md:text-[28px] md:leading-9">{title}</h1>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </DepthSurface>
  );
}

export function PageContainer({ children, wide = false, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={cn("page-enter mx-auto w-full space-y-6 p-4 md:p-6 lg:p-8", wide ? "max-w-[1600px]" : "max-w-6xl", className)}>{children}</div>
  );
}
