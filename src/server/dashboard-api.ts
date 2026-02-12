import { getPRStatus, listPRs } from "@/core/github/pr.js";
import {
  getSession,
  getSessionMessages,
  listSessions,
  listTools,
} from "@/core/opencode/queries.js";
import { getDb } from "@/memory/db/core.js";
import { listMemories } from "@/memory/db/memories.js";
import { listSummaries } from "@/memory/db/summaries.js";
import { searchMemory } from "@/memory/search.js";
import { readChunk } from "@/memory/storage.js";
import { Hono } from "hono";
import { z } from "zod";

const SearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().optional(),
  threadId: z.string().optional(),
});

function errorMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDashboardApi(): Hono {
  const api = new Hono();

  // ── Debug / Diagnostics ────────────────────────────────────────────────

  api.get("/debug", async (c) => {
    const result: Record<string, unknown> = {
      server: { ok: true, uptime: process.uptime(), pid: process.pid, cwd: process.cwd() },
    };

    // Test OpenCode client — sessions
    try {
      const sessions = await listSessions();
      result.opencode = { ok: true, sessionCount: sessions.length };
    } catch (error) {
      console.error("[Dashboard API] Debug: OpenCode sessions failed:", error);
      result.opencode = { ok: false, error: errorMsg(error) };
    }

    // Test OpenCode client — tools
    try {
      const tools = await listTools();
      (result.opencode as Record<string, unknown>).toolCount = tools.length;
    } catch (error) {
      console.error("[Dashboard API] Debug: OpenCode tools failed:", error);
      (result.opencode as Record<string, unknown>).toolError = errorMsg(error);
    }

    // Test memory DB
    try {
      getDb(); // throws if DB not available
      const memories = listMemories({ limit: 1 });
      const archives = listSummaries({ limit: 1 });
      result.memory = {
        ok: true,
        memoryCount: memories.length > 0 ? "1+" : 0,
        archiveCount: archives.length > 0 ? "1+" : 0,
      };
    } catch (error) {
      console.error("[Dashboard API] Debug: Memory DB failed:", error);
      result.memory = { ok: false, error: errorMsg(error) };
    }

    return c.json(result);
  });

  // ── Sessions ─────────────────────────────────────────────────────────────

  api.get("/sessions", async (c) => {
    try {
      const sessions = await listSessions();
      return c.json({ sessions });
    } catch (error) {
      console.error("[Dashboard API] GET /sessions failed:", error);
      return c.json({ error: errorMsg(error), sessions: [] }, 500);
    }
  });

  api.get("/sessions/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const session = await getSession(id);
      if (!session) {
        return c.json({ error: "Session not found" }, 404);
      }
      return c.json(session);
    } catch (error) {
      console.error("[Dashboard API] GET /sessions/:id failed:", error);
      return c.json({ error: errorMsg(error) }, 500);
    }
  });

  api.get("/sessions/:id/messages", async (c) => {
    try {
      const id = c.req.param("id");
      const messages = await getSessionMessages(id);
      return c.json({ messages });
    } catch (error) {
      console.error("[Dashboard API] GET /sessions/:id/messages failed:", error);
      return c.json({ error: errorMsg(error), messages: [] }, 500);
    }
  });

  // ── Memories ─────────────────────────────────────────────────────────────

  api.get("/memories", (c) => {
    try {
      const type = c.req.query("type") as "fact" | "preference" | "learning" | undefined;
      const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
      const memories = listMemories({ type, limit });
      return c.json({ memories });
    } catch (error) {
      console.error("[Dashboard API] GET /memories failed:", error);
      return c.json({ error: errorMsg(error), memories: [] }, 500);
    }
  });

  api.post("/memories/search", async (c) => {
    try {
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
    } catch (error) {
      console.error("[Dashboard API] POST /memories/search failed:", error);
      return c.json({ error: errorMsg(error), results: [] }, 500);
    }
  });

  // ── Archives ─────────────────────────────────────────────────────────────

  api.get("/archives", (c) => {
    try {
      const threadId = c.req.query("threadId") || undefined;
      const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
      const summaries = listSummaries({ threadId, limit });
      return c.json({ summaries });
    } catch (error) {
      console.error("[Dashboard API] GET /archives failed:", error);
      return c.json({ error: errorMsg(error), summaries: [] }, 500);
    }
  });

  api.get("/archives/:threadId/:chunkId", (c) => {
    try {
      const threadId = c.req.param("threadId");
      const chunkId = c.req.param("chunkId");
      const chunk = readChunk(threadId, chunkId);
      if (!chunk) {
        return c.json({ error: "Chunk not found" }, 404);
      }
      return c.json(chunk);
    } catch (error) {
      console.error("[Dashboard API] GET /archives/:threadId/:chunkId failed:", error);
      return c.json({ error: errorMsg(error) }, 500);
    }
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
    try {
      const tools = await listTools();
      return c.json({ tools });
    } catch (error) {
      console.error("[Dashboard API] GET /tools failed:", error);
      return c.json({ error: errorMsg(error), tools: [] }, 500);
    }
  });

  return api;
}
