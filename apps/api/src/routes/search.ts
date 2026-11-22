import { Hono } from "hono";
import { z } from "zod";
import { rateLimit } from "../lib/rate-limit";
import { escapeLike, parseQuery } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const searchQuery = z.object({ q: z.string().trim().min(2).max(200) });

/** Global search for the command palette. Every query runs as the user (RLS). */
export const searchRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", rateLimit({ name: "search", capacity: 120, windowMs: 60_000 }), async (c) => {
    const { q } = parseQuery(c, searchQuery);
    const db = c.get("db");
    const like = `%${escapeLike(q)}%`;

    const [tasks, goals, knowledge, intelligence] = await Promise.all([
      db.from("tasks").select("id, title, status").ilike("title", like).neq("status", "cancelled").order("updated_at", { ascending: false }).limit(5),
      db.from("goals").select("id, title").ilike("title", like).neq("status", "archived").limit(3),
      db
        .from("knowledge_documents")
        .select("id, title, type")
        .textSearch("search", q, { type: "websearch", config: "english" })
        .order("updated_at", { ascending: false })
        .limit(6),
      db
        .from("intelligence_items")
        .select("id, title, source_name, feed, published_at")
        .is("duplicate_of", null)
        .textSearch("search", q, { type: "websearch", config: "english" })
        .order("fetched_at", { ascending: false })
        .limit(6),
    ]);

    // Fall back to substring matching for knowledge when full-text finds nothing (e.g. partial words).
    let knowledgeRows = knowledge.data ?? [];
    if (knowledgeRows.length === 0) {
      const { data } = await db.from("knowledge_documents").select("id, title, type").ilike("title", like).limit(6);
      knowledgeRows = data ?? [];
    }

    return c.json({
      tasks: tasks.data ?? [],
      goals: goals.data ?? [],
      knowledge: knowledgeRows,
      intelligence: intelligence.data ?? [],
    });
  });
