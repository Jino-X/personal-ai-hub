import { Hono } from "hono";
import {
  folderCreateSchema,
  folderUpdateSchema,
  knowledgeAskSchema,
  knowledgeCreateSchema,
  knowledgeListQuery,
  knowledgeSearchSchema,
  knowledgeUpdateSchema,
  type IntelligenceFeed,
  type KnowledgeDocType,
  type KnowledgeDocument,
  type KnowledgeDocumentSummary,
  type KnowledgeFolder,
  type KnowledgeMatch,
} from "@hub/shared";
import { answerFromKnowledge, enqueueIndex, retrieveKnowledge } from "../agents/knowledge";
import { importUrl } from "../agents/knowledge/importers";
import { resolveAI, tryResolveAI } from "../ai/service";
import { sha256 } from "../lib/crypto";
import { AppError, errorMessage, ExternalServiceError, notFound, unwrap } from "../lib/errors";
import { fetchAndExtract } from "../lib/extract";
import { UnsafeUrlError } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { definedOnly, escapeLike, idParam, parseBody, parseQuery } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const SUMMARY_COLUMNS =
  "id, user_id, folder_id, type, title, url, source_item_id, excerpt, ai_summary, auto_category, tags, metadata, index_status, index_error, indexed_at, embedding_model, chunk_count, created_at, updated_at";

const FEED_DOC_TYPE: Record<IntelligenceFeed, KnowledgeDocType> = {
  ai_news: "article",
  models: "url",
  products: "url",
  developer: "documentation",
  github_trending: "repository",
  research: "paper",
};

export const knowledgeRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  // ── Folders ──
  .get("/folders", async (c) => {
    const db = c.get("db");
    const [folders, docs] = await Promise.all([
      db.from("knowledge_folders").select("*").order("name"),
      db.from("knowledge_documents").select("folder_id").limit(20_000),
    ]);
    const counts = new Map<string | null, number>();
    for (const d of unwrap<{ folder_id: string | null }[]>(docs)) counts.set(d.folder_id, (counts.get(d.folder_id) ?? 0) + 1);
    return c.json({
      items: unwrap<KnowledgeFolder[]>(folders).map((f) => ({ ...f, document_count: counts.get(f.id) ?? 0 })),
      unfiled_count: counts.get(null) ?? 0,
      total: [...counts.values()].reduce((a, b) => a + b, 0),
    });
  })
  .post("/folders", async (c) => {
    const body = await parseBody(c, folderCreateSchema);
    return c.json(unwrap<KnowledgeFolder>(await c.get("db").from("knowledge_folders").insert({ ...definedOnly(body), user_id: c.get("user").id }).select("*").single()), 201);
  })
  .patch("/folders/:id", async (c) => {
    const body = definedOnly(await parseBody(c, folderUpdateSchema));
    return c.json(unwrap<KnowledgeFolder>(await c.get("db").from("knowledge_folders").update(body).eq("id", idParam(c)).select("*").single(), "Folder"));
  })
  .delete("/folders/:id", async (c) => {
    unwrap(await c.get("db").from("knowledge_folders").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  })
  // ── Documents ──
  .get("/documents", async (c) => {
    const q = parseQuery(c, knowledgeListQuery);
    let query = c.get("db").from("knowledge_documents").select(SUMMARY_COLUMNS, { count: "exact" });
    if (q.folder_id) query = query.eq("folder_id", q.folder_id);
    if (q.type) query = query.eq("type", q.type);
    if (q.tag) query = query.contains("tags", [q.tag.toLowerCase()]);
    if (q.q) {
      // Quote values so commas/parentheses in user input can't alter the PostgREST filter.
      const term = q.q.replace(/["\\]/g, " ");
      query = query.or(`title.ilike."%${escapeLike(term)}%",search.wfts(english)."${term}"`);
    }
    const { data, count, error } = await query.order("created_at", { ascending: false }).range(q.offset, q.offset + q.limit - 1);
    return c.json({ items: unwrap<KnowledgeDocumentSummary[]>({ data, error }), total: count ?? 0, limit: q.limit, offset: q.offset });
  })
  .get("/documents/:id", async (c) => {
    return c.json(unwrap<KnowledgeDocument>(await c.get("db").from("knowledge_documents").select("*").eq("id", idParam(c)).maybeSingle(), "Document"));
  })
  .post("/documents", rateLimit({ name: "knowledge-create", capacity: 60, windowMs: 60 * 60_000 }), async (c) => {
    const body = await parseBody(c, knowledgeCreateSchema);
    const db = c.get("db");
    const userId = c.get("user").id;
    let row: Record<string, unknown>;

    if (body.mode === "note") {
      row = { type: body.type ?? "note", title: body.title, content: body.content, url: body.url ?? null, excerpt: body.content.slice(0, 300) };
    } else if (body.mode === "url") {
      try {
        const imported = await importUrl(body.url, body.type);
        row = { ...imported };
      } catch (err) {
        if (err instanceof UnsafeUrlError) throw new AppError(422, "unsafe_url", err.message);
        if (err instanceof ExternalServiceError) throw new AppError(422, "import_failed", `Couldn't import this URL: ${err.message.replace(/^\w+: /, "")}`);
        throw err;
      }
    } else {
      const item = unwrap<{ id: string; feed: IntelligenceFeed; title: string; url: string; source_excerpt: string | null; ai_summary: string | null; source_name: string; published_at: string | null } | null>(
        await db.from("intelligence_items").select("id, feed, title, url, source_excerpt, ai_summary, source_name, published_at").eq("id", body.item_id).maybeSingle(),
      );
      if (!item) throw notFound("Intelligence item");
      let content = item.source_excerpt ?? "";
      if (item.feed === "ai_news" || item.feed === "developer") {
        try {
          const page = await fetchAndExtract(item.url);
          if (page.text.length > content.length) content = page.text;
        } catch {
          /* keep the excerpt */
        }
      }
      row = {
        type: FEED_DOC_TYPE[item.feed],
        title: item.title.slice(0, 300),
        url: item.url,
        source_item_id: item.id,
        content: content || item.title,
        excerpt: (item.source_excerpt ?? "").slice(0, 500) || null,
        metadata: { source_name: item.source_name, published_at: item.published_at, saved_from: "intelligence" },
      };
    }

    const doc = unwrap<KnowledgeDocumentSummary>(
      await db
        .from("knowledge_documents")
        .insert({
          ...row,
          user_id: userId,
          folder_id: body.folder_id ?? null,
          tags: body.tags ?? [],
          content_hash: sha256(String(row.content ?? "")),
          index_status: "pending",
        })
        .select(SUMMARY_COLUMNS)
        .single(),
    );
    await enqueueIndex(doc.id, userId, 3);
    return c.json(doc, 201);
  })
  .patch("/documents/:id", async (c) => {
    const id = idParam(c);
    const body = definedOnly(await parseBody(c, knowledgeUpdateSchema));
    const db = c.get("db");
    const patch: Record<string, unknown> = { ...body };
    const reindex = body.content !== undefined || body.title !== undefined;
    if (body.content !== undefined) patch.content_hash = sha256(body.content);
    if (reindex) patch.index_status = "pending";
    const doc = unwrap<KnowledgeDocumentSummary>(await db.from("knowledge_documents").update(patch).eq("id", id).select(SUMMARY_COLUMNS).single(), "Document");
    if (reindex) await enqueueIndex(id, c.get("user").id, 3);
    return c.json(doc);
  })
  .delete("/documents/:id", async (c) => {
    unwrap(await c.get("db").from("knowledge_documents").delete().eq("id", idParam(c)));
    return c.body(null, 204);
  })
  .post("/documents/:id/reindex", async (c) => {
    const id = idParam(c);
    const doc = unwrap<{ id: string } | null>(await c.get("db").from("knowledge_documents").update({ index_status: "pending" }).eq("id", id).select("id").maybeSingle());
    if (!doc) throw notFound("Document");
    await enqueueIndex(id, c.get("user").id, 3);
    return c.json({ ok: true });
  })
  .get("/tags", async (c) => {
    const rows = unwrap<{ tags: string[] }[]>(await c.get("db").from("knowledge_documents").select("tags").limit(5000));
    const counts = new Map<string, number>();
    for (const r of rows) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return c.json({ items: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([tag, count]) => ({ tag, count })) });
  })
  // ── Search & Q&A ──
  .post("/search", rateLimit({ name: "knowledge-search", capacity: 60, windowMs: 60_000 }), async (c) => {
    const body = await parseBody(c, knowledgeSearchSchema);
    const ai = body.mode === "fulltext" ? null : await tryResolveAI(c.get("user").id, { requireEmbeddings: true });
    const { matches, mode } = await retrieveKnowledge(c.get("db"), ai, body.q, { limit: body.limit * 2, folderId: body.folder_id, mode: body.mode });
    // Best chunk per document.
    const best = new Map<string, KnowledgeMatch>();
    for (const m of matches) if (!best.has(m.document_id)) best.set(m.document_id, m);
    return c.json({
      items: [...best.values()].slice(0, body.limit),
      mode_used: mode,
      note: mode !== body.mode ? "Semantic search is unavailable while local AI is offline — showing keyword results." : null,
    });
  })
  .post("/ask", rateLimit({ name: "knowledge-ask", capacity: 15, windowMs: 60_000 }), async (c) => {
    const body = await parseBody(c, knowledgeAskSchema);
    const ai = await resolveAI(c.get("user").id);
    try {
      return c.json(await answerFromKnowledge(c.get("db"), ai, body.question, body.folder_id));
    } catch (err) {
      throw err instanceof AppError ? err : new AppError(502, "ai_error", `The local model couldn't answer: ${errorMessage(err)}`);
    }
  });
