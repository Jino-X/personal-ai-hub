import {
  BookMarked,
  Bot,
  CalendarDays,
  CodeXml,
  Eye,
  FlaskConical,
  LayoutDashboard,
  ListTodo,
  Newspaper,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, description: "Your day at a glance" },
      { title: "Assistant", href: "/assistant", icon: Sparkles, description: "Chat with your local AI" },
      { title: "Briefings", href: "/briefings", icon: Newspaper, description: "Daily and weekly briefings" },
    ],
  },
  {
    label: "Productivity",
    items: [
      { title: "Tasks", href: "/productivity/tasks", icon: ListTodo, description: "Tasks, projects and reminders" },
      { title: "Calendar", href: "/productivity/calendar", icon: CalendarDays, description: "Upcoming events" },
      { title: "Goals & Learning", href: "/productivity/goals", icon: Target, description: "Goals, milestones and skills" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "AI News", href: "/intelligence/ai-news", icon: Bot, description: "Models, launches and announcements" },
      { title: "Developer News", href: "/intelligence/developer-news", icon: CodeXml, description: "Releases and changelogs" },
      { title: "GitHub Trending", href: "/intelligence/github-trending", icon: TrendingUp, description: "Trending repositories" },
      { title: "Research", href: "/intelligence/research", icon: FlaskConical, description: "Papers and research" },
      { title: "Watchlist", href: "/watchlist", icon: Eye, description: "Things you follow" },
    ],
  },
  {
    label: "Knowledge",
    items: [{ title: "Knowledge Vault", href: "/knowledge", icon: BookMarked, description: "Saved notes, articles and repos" }],
  },
];

export const SETTINGS_NAV: NavItem = { title: "Settings", href: "/settings", icon: Settings, description: "Profile, AI and integrations" };

export const ALL_NAV_ITEMS = [...NAVIGATION.flatMap((g) => g.items), SETTINGS_NAV];
