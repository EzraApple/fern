import { getDb, isVectorReady, vectorToBlob } from "@/memory/db/core.js";
import type { PersistentMemory } from "@/memory/types.js";

/** Insert a persistent memory + embedding */
export function insertMemory(memory: PersistentMemory, embedding: number[]): void {
  const d = getDb();

  d.prepare(
    `INSERT OR REPLACE INTO memories (id, type, content, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    memory.id,
    memory.type,
    memory.content,
    JSON.stringify(memory.tags),
    memory.createdAt,
    memory.updatedAt
  );

  // FTS5 insert
  d.prepare("INSERT OR REPLACE INTO memories_fts (id, type, content) VALUES (?, ?, ?)").run(
    memory.id,
    memory.type,
    memory.content
  );

  // Vector insert
  if (isVectorReady() && embedding.length > 0) {
    d.prepare("INSERT OR REPLACE INTO memories_vec (id, embedding) VALUES (?, ?)").run(
      memory.id,
      vectorToBlob(embedding)
    );
  }
}

/** Delete a persistent memory from all tables */
export function deleteMemory(id: string): boolean {
  const d = getDb();
  const result = d.prepare("DELETE FROM memories WHERE id = ?").run(id);
  d.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
  if (isVectorReady()) {
    d.prepare("DELETE FROM memories_vec WHERE id = ?").run(id);
  }
  return result.changes > 0;
}

/** Fetch a persistent memory by ID */
export function getMemoryById(id: string): PersistentMemory | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM memories WHERE id = ?").get(id) as
    | {
        id: string;
        type: string;
        content: string;
        tags: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    type: row.type as PersistentMemory["type"],
    content: row.content,
    tags: JSON.parse(row.tags) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** List persistent memories with optional filters */
export function listMemories(options?: {
  type?: PersistentMemory["type"];
  limit?: number;
}): PersistentMemory[] {
  const d = getDb();
  const limit = options?.limit ?? 100;

  let sql = "SELECT * FROM memories";
  const params: (string | number | null)[] = [];

  if (options?.type) {
    sql += " WHERE type = ?";
    params.push(options.type);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const rows = d.prepare(sql).all(...params) as Array<{
    id: string;
    type: string;
    content: string;
    tags: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    type: row.type as PersistentMemory["type"],
    content: row.content,
    tags: JSON.parse(row.tags) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
