import { Hono } from "hono";
import { normalizeDashboardWidgets, type NotificationPreferences, type UserPreferences, type UserProfile } from "@hub/shared";
import { unwrap } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const meRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = c.get("db");
    const [profile, prefs, notif] = await Promise.all([
      db.from("users").select("*").single(),
      db.from("user_preferences").select("*").single(),
      db.from("notification_preferences").select("*").single(),
    ]);
    const preferences = unwrap(prefs, "Preferences") as UserPreferences;
    return c.json({
      profile: unwrap(profile, "Profile") as UserProfile,
      preferences: { ...preferences, dashboard_widgets: normalizeDashboardWidgets(preferences.dashboard_widgets) },
      notifications: unwrap(notif, "Notification preferences") as NotificationPreferences,
    });
  });
