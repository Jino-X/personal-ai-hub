"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, type ReactNode } from "react";
import { AuthProvider } from "@/components/auth/auth-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useMe } from "@/lib/api/hooks/me";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { CommandPaletteProvider } from "./command-palette";
import { QuickActionDialogs } from "./quick-action-dialogs";
import { QuickActionsProvider } from "./quick-actions";

/** Applies the theme stored in the user's preferences once, so it follows them across devices. */
function ThemeSync() {
  const { data } = useMe();
  const { setTheme } = useTheme();
  const applied = useRef(false);
  useEffect(() => {
    if (data && !applied.current) {
      applied.current = true;
      setTheme(data.preferences.theme);
    }
  }, [data, setTheme]);
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <QuickActionsProvider>
        <CommandPaletteProvider>
          <SidebarProvider>
            <ThemeSync />
            <AppSidebar />
            <SidebarInset>
              <AppHeader />
              <main className="flex-1">{children}</main>
            </SidebarInset>
            <QuickActionDialogs />
          </SidebarProvider>
        </CommandPaletteProvider>
      </QuickActionsProvider>
    </AuthProvider>
  );
}
