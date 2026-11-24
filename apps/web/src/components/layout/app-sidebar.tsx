"use client";

import { BrainCircuit } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAVIGATION, SETTINGS_NAV } from "@/config/navigation";

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Personal AI Hub">
              <Link href="/dashboard" onClick={() => setOpenMobile(false)}>
                <div className="icon-tile size-8 shrink-0 rounded-lg">
                  <BrainCircuit className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">Personal AI Hub</span>
                  <span className="truncate text-xs text-muted-foreground">Local-first intelligence</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAVIGATION.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[10.5px] tracking-[0.12em] uppercase">{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                      <Link href={item.href} onClick={() => setOpenMobile(false)}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive(SETTINGS_NAV.href)} tooltip={SETTINGS_NAV.title}>
              <Link href={SETTINGS_NAV.href} onClick={() => setOpenMobile(false)}>
                <SETTINGS_NAV.icon />
                <span>{SETTINGS_NAV.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
