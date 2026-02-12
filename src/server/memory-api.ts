import { deleteMemory, listMemories, writeMemory } from "@/memory/persistent.js";
import { searchMemory } from "@/memory/search.js";
import { readChunk } from "@/memory/storage.js";
import { Hono } from "hono";
import { z } from "zod";

const WriteSchema = z.object({
  type: z.enum(["fact", "preference", "learning"]),
  content: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
});

const SearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().optional(),
  threadId: z.string().optional(),
});

const ReadSchema = z.object({
  threadId: z.string().min(1),
  chunkId: z.string().min(1),
});

export function createMemoryApi(): Hono {
  const api = new Hono();

  api.post("/write", async (c) => {
    const body = await c.req.json();
    const parsed = WriteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }
    const memory = await writeMemory(parsed.data);
    return c.json(memory);
  });

  api.post("/search", async (c) => {
    const body = await c.req.json();
    const parsed = SearchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }
    const results = await searchMemory(parsed.data.query, {
      limit: parsed.data.limit,
      threadId: parsed.data.threadId,
    });
    return c.json(results);
  });

  api.post("/read", async (c) => {
    const body = await c.req.json();
    const parsed = ReadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }
    const chunk = readChunk(parsed.data.threadId, parsed.data.chunkId);
    if (!chunk) {
      return c.json({ error: "Chunk not found" }, 404);
    }
    return c.json(chunk);
  });

  api.get("/list", async (c) => {
    const type = c.req.query("type") as "fact" | "preference" | "learning" | undefined;
    const limitStr = c.req.query("limit");
    const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;
    const memories = listMemories({ type, limit });
    return c.json(memories);
  });

  api.delete("/delete/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = deleteMemory(id);
    return c.json({ deleted });
  });

  return api;
}
