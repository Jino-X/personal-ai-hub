import { Hono } from "hono";
import { z } from "zod";
import { accountDeleteSchema, type AuditLog } from "@hub/shared";
import { deviceGateway } from "../devices/gateway";
import { audit } from "../lib/audit";
import { AppError, unwrap } from "../lib/errors";
import { logger } from "../lib/logger";
import { rateLimit } from "../lib/rate-limit";
import { adminDb } from "../lib/supabase";
import { parseBody, parseQuery } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

/** Every user-owned table and the column that scopes it. Secrets and embeddings are excluded. */
const EXPORT_TABLES: [table: string, column: string, select?: string][] = [
  ["users", "id"],
  ["user_preferences", "user_id"],
  ["notification_preferences", "user_id"],
  ["projects", "user_id"],
  ["tasks", "user_id"],
  ["goals", "user_id"],
  ["goal_milestones", "user_id"],
  ["skills", "user_id"],
  ["learning_resources", "user_id"],
  ["calendar_events", "user_id"],
  ["news_sources", "user_id"],
  ["intelligence_items", "owner_user_id", "id, feed, url, title, source_name, published_at, source_excerpt, ai_summary, created_at"],
  ["intelligence_item_states", "user_id"],
  ["bookmarks", "user_id"],
  ["watchlists", "user_id"],
  ["watchlist_items", "user_id"],
  ["watchlist_matches", "user_id"],
  ["knowledge_folders", "user_id"],
  ["knowledge_documents", "user_id", "id, folder_id, type, title, url, content, ai_summary, auto_category, tags, metadata, created_at, updated_at"],
  ["conversations", "user_id"],
  ["messages", "user_id"],
  ["assistant_actions", "user_id"],
  ["briefings", "user_id"],
  ["connected_integrations", "user_id", "id, provider, status, account_label, scopes, last_synced_at, created_at"],
  ["local_ai_devices", "user_id", "id, name, platform, companion_version, status, last_seen_at, created_at, revoked_at"],
  ["notifications", "user_id"],
  ["audit_logs", "user_id"],
];

const PAGE = 1000;

export const accountRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/export", rateLimit({ name: "account-export", capacity: 5, windowMs: 60 * 60_000 }), async (c) => {
    const user = c.get("user");
    const data: Record<string, unknown[]> = {};
    for (const [table, column, select] of EXPORT_TABLES) {
      const rows: unknown[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await adminDb.from(table).select(select ?? "*").eq(column, user.id).range(from, from + PAGE - 1);
        if (error) throw new AppError(500, "export_failed", `Export failed on ${table}`);
        rows.push(...(page ?? []));
        if (!page || page.length < PAGE) break;
      }
      data[table] = rows;
    }
    await audit({ userId: user.id, actor: "user", action: "account.exported", c });
    c.header("Content-Disposition", `attachment; filename="personal-ai-hub-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({ exported_at: new Date().toISOString(), format_version: 1, user_id: user.id, data });
  })
  .get("/audit-logs", async (c) => {
    const { limit } = parseQuery(c, z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }));
    return c.json({ items: unwrap<AuditLog[]>(await c.get("db").from("audit_logs").select("*").order("created_at", { ascending: false }).limit(limit)) });
  })
  .delete("/", rateLimit({ name: "account-delete", capacity: 3, windowMs: 60 * 60_000 }), async (c) => {
    await parseBody(c, accountDeleteSchema);
    const user = c.get("user");
    // The audit trail is deleted with the account, so record the event in the server log too.
    logger.warn({ userId: user.id }, "account deletion requested");
    const { data: devices } = await adminDb.from("local_ai_devices").select("id").eq("user_id", user.id);
    for (const d of devices ?? []) deviceGateway.disconnect(d.id as string, "account_deleted");
    // Deleting the auth user cascades to every user-owned row (foreign keys ON DELETE CASCADE).
    const { error } = await adminDb.auth.admin.deleteUser(user.id);
    if (error) throw new AppError(500, "delete_failed", "Account deletion failed. Please try again.");
    return c.body(null, 204);
  });
