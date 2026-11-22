import { Hono } from "hono";
import {
  normalizeDashboardWidgets,
  notificationPrefsUpdateSchema,
  preferencesUpdateSchema,
  profileUpdateSchema,
  type NotificationPreferences,
  type UserPreferences,
  type UserProfile,
} from "@hub/shared";
import { audit } from "../lib/audit";
import { unwrap } from "../lib/errors";
import { definedOnly, parseBody } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

function withWidgets(prefs: UserPreferences): UserPreferences {
  return { ...prefs, dashboard_widgets: normalizeDashboardWidgets(prefs.dashboard_widgets) };
}

export const meRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = c.get("db");
    const [profile, prefs, notif] = await Promise.all([
      db.from("users").select("*").single(),
      db.from("user_preferences").select("*").single(),
      db.from("notification_preferences").select("*").single(),
    ]);
    return c.json({
      profile: unwrap<UserProfile>(profile, "Profile"),
      preferences: withWidgets(unwrap<UserPreferences>(prefs, "Preferences")),
      notifications: unwrap<NotificationPreferences>(notif, "Notification preferences"),
    });
  })
  .patch("/profile", async (c) => {
    const body = definedOnly(await parseBody(c, profileUpdateSchema));
    const user = c.get("user");
    const row = unwrap<UserProfile>(await c.get("db").from("users").update(body).eq("id", user.id).select("*").single(), "Profile");
    if (body.timezone) await audit({ userId: user.id, actor: "user", action: "profile.timezone_updated", metadata: { timezone: body.timezone }, c });
    return c.json(row);
  })
  .patch("/preferences", async (c) => {
    const body = definedOnly(await parseBody(c, preferencesUpdateSchema));
    const row = unwrap<UserPreferences>(
      await c.get("db").from("user_preferences").update(body).eq("user_id", c.get("user").id).select("*").single(),
      "Preferences",
    );
    return c.json(withWidgets(row));
  })
  .patch("/notifications", async (c) => {
    const body = definedOnly(await parseBody(c, notificationPrefsUpdateSchema));
    const row = unwrap<NotificationPreferences>(
      await c.get("db").from("notification_preferences").update(body).eq("user_id", c.get("user").id).select("*").single(),
      "Notification preferences",
    );
    return c.json(row);
  });
