import { Hono } from "hono";
import { z } from "zod";
import { listMemories, listSummaries } from "../memory/db.js";
import { searchMemory } from "../memory/search.js";
import { readChunk } from "../memory/storage.js";
import {
  getSession,
  getSessionMessages,
  listSessions,
  listTools,
} from "../core/opencode-service.js";
import { getPRStatus, listPRs } from "../core/github-service.js";

const SearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().optional(),
  threadId: z.string().optional(),
});

export function createDashboardApi(): Hono {
  const api = new Hono();

  // ── Sessions ─────────────────────────────────────────────────────────────

  api.get("/sessions", async (c) => {
    const sessions = await listSessions();
    return c.json({ sessions });
  });

  api.get("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const session = await getSession(id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json(session);
  });

  api.get("/sessions/:id/messages", async (c) => {
    const id = c.req.param("id");
    const messages = await getSessionMessages(id);
    return c.json({ messages });
  });

  // ── Memories ─────────────────────────────────────────────────────────────

  api.get("/memories", (c) => {
    const type = c.req.query("type") as "fact" | "preference" | "learning" | undefined;
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
    const memories = listMemories({ type, limit });
    return c.json({ memories });
  });

  api.post("/memories/search", async (c) => {
    const body = await c.req.json();
    const parsed = SearchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }
    const results = await searchMemory(parsed.data.query, {
      limit: parsed.data.limit,
      threadId: parsed.data.threadId,
    });
    return c.json({ results });
  });

  // ── Archives ─────────────────────────────────────────────────────────────

  api.get("/archives", (c) => {
    const threadId = c.req.query("threadId") || undefined;
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
    const summaries = listSummaries({ threadId, limit });
    return c.json({ summaries });
  });

  api.get("/archives/:threadId/:chunkId", (c) => {
    const threadId = c.req.param("threadId");
    const chunkId = c.req.param("chunkId");
    const chunk = readChunk(threadId, chunkId);
    if (!chunk) {
      return c.json({ error: "Chunk not found" }, 404);
    }
    return c.json(chunk);
  });

  // ── GitHub ───────────────────────────────────────────────────────────────

  api.get("/github/prs", async (c) => {
    const repo = c.req.query("repo") || "EzraApple/fern";
    const state = (c.req.query("state") || "all") as "open" | "closed" | "all";
    try {
      const prs = await listPRs(repo, state);
      return c.json({ prs });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to fetch PRs";
      return c.json({ error: msg }, 500);
    }
  });

  api.get("/github/prs/:number", async (c) => {
    const prNumber = Number(c.req.param("number"));
    const repo = c.req.query("repo") || "EzraApple/fern";
    try {
      const status = await getPRStatus(prNumber, repo);
      return c.json(status);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to fetch PR status";
      return c.json({ error: msg }, 500);
    }
  });

  // ── Tools ────────────────────────────────────────────────────────────────

  api.get("/tools", async (c) => {
    const tools = await listTools();
    return c.json({ tools });
  });

  return api;
}
