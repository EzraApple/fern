import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { getMemoryConfig } from "./config.js";
import { embedBatch } from "./embeddings.js";
import type { PersistentMemory, SummaryIndexEntry } from "./types.js";

// ── Singleton state ────────────────────────────────────────────────────────

let db: Database.Database | null = null;
let vectorReady = false;

// ── Public API ─────────────────────────────────────────────────────────────

/** Synchronous DB init (opens DB, loads sqlite-vec, creates schema). Used by lazy getDb(). */
function initMemoryDbSync(): void {
  if (db) return;

  const config = getMemoryConfig();
  if (!config.enabled) return;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);

  // Load sqlite-vec extension
  try {
    const sqliteVec = require("sqlite-vec");
    sqliteVec.load(db);
    vectorReady = true;
  } catch {
    vectorReady = false;
  }

  createSchema(db);
}

/** Initialize the SQLite database, load extensions, create schema, migrate JSONL */
export async function initMemoryDb(): Promise<void> {
  if (db) return;

  const config = getMemoryConfig();
  if (!config.enabled) return;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);

  // Load sqlite-vec extension
  try {
    const sqliteVec = await import("sqlite-vec");
    sqliteVec.load(db);
    vectorReady = true;
    console.info("[Memory] sqlite-vec loaded successfully");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Memory] sqlite-vec unavailable (FTS-only mode): ${msg}`);
    vectorReady = false;
  }

  createSchema(db);

  // One-time JSONL migration
  await migrateFromJsonl();
}

/** Get the database instance, auto-initializing if needed */
export function getDb(): Database.Database {
  if (!db) {
    // Lazy init for cases where tools run in a separate process (e.g., OpenCode)
    initMemoryDbSync();
  }
  if (!db) throw new Error("[Memory] Database not initialized and lazy init failed");
  return db;
}

/** Whether sqlite-vec loaded successfully */
export function isVectorReady(): boolean {
  return vectorReady;
}

/** Close the database */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    vectorReady = false;
  }
}

/** Convert a float array to a Buffer for sqlite-vec */
export function vectorToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

// ── CRUD: Summaries ────────────────────────────────────────────────────────

/** Insert a summary entry + embedding into SQLite */
export function insertSummary(entry: SummaryIndexEntry, embedding: number[]): void {
  const d = getDb();

  d.prepare(
    `INSERT OR REPLACE INTO summaries (id, thread_id, summary, token_count, created_at, time_start, time_end)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.chunkId,
    entry.threadId,
    entry.summary,
    entry.tokenCount,
    entry.createdAt,
    entry.timeRange.start,
    entry.timeRange.end
  );

  // FTS5 insert
  d.prepare("INSERT OR REPLACE INTO summaries_fts (id, thread_id, summary) VALUES (?, ?, ?)").run(
    entry.chunkId,
    entry.threadId,
    entry.summary
  );

  // Vector insert (if available)
  if (vectorReady && embedding.length > 0) {
    d.prepare("INSERT OR REPLACE INTO summaries_vec (id, embedding) VALUES (?, ?)").run(
      entry.chunkId,
      vectorToBlob(embedding)
    );
  }
}

// ── CRUD: Persistent memories ──────────────────────────────────────────────

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
  if (vectorReady && embedding.length > 0) {
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
  if (vectorReady) {
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

/** List summaries with optional thread filter */
export function listSummaries(options?: {
  threadId?: string;
  limit?: number;
}): Array<{
  id: string;
  threadId: string;
  summary: string;
  tokenCount: number;
  createdAt: string;
  timeStart: number;
  timeEnd: number;
}> {
  const d = getDb();
  const limit = options?.limit ?? 100;

  let sql = "SELECT * FROM summaries";
  const params: (string | number | null)[] = [];

  if (options?.threadId) {
    sql += " WHERE thread_id = ?";
    params.push(options.threadId);
  }
  sql += " ORDER BY time_end DESC LIMIT ?";
  params.push(limit);

  const rows = d.prepare(sql).all(...params) as Array<{
    id: string;
    thread_id: string;
    summary: string;
    token_count: number;
    created_at: string;
    time_start: number;
    time_end: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    summary: row.summary,
    tokenCount: row.token_count,
    createdAt: row.created_at,
    timeStart: row.time_start,
    timeEnd: row.time_end,
  }));
}

// ── Schema creation ────────────────────────────────────────────────────────

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      time_start INTEGER NOT NULL,
      time_end INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_summaries_thread ON summaries(thread_id);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

    CREATE TABLE IF NOT EXISTS thread_sessions (
      thread_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      share_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // FTS5 tables (separate exec calls — virtual tables can't be in multi-statement exec)
  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
      summary,
      id UNINDEXED,
      thread_id UNINDEXED
    );
  `);

  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      id UNINDEXED,
      type UNINDEXED
    );
  `);

  // Vector tables (only if sqlite-vec loaded)
  if (vectorReady) {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS summaries_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[1536]
      );
    `);
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[1536]
      );
    `);
  }
}

// ── CRUD: Thread sessions ────────────────────────────────────────────────

export interface ThreadSessionRow {
  threadId: string;
  sessionId: string;
  shareUrl?: string;
  createdAt: number;
  updatedAt: number;
}

/** Save or update a thread-session mapping */
export function saveThreadSession(entry: ThreadSessionRow): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO thread_sessions (thread_id, session_id, share_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(entry.threadId, entry.sessionId, entry.shareUrl ?? null, entry.createdAt, entry.updatedAt);
}

/** Get a thread-session mapping by thread ID */
export function getThreadSession(threadId: string): ThreadSessionRow | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM thread_sessions WHERE thread_id = ?").get(threadId) as
    | {
        thread_id: string;
        session_id: string;
        share_url: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    threadId: row.thread_id,
    sessionId: row.session_id,
    shareUrl: row.share_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Delete thread sessions older than the given TTL */
export function deleteStaleThreadSessions(ttlMs: number): number {
  const d = getDb();
  const cutoff = Date.now() - ttlMs;
  const result = d.prepare("DELETE FROM thread_sessions WHERE updated_at < ?").run(cutoff);
  return result.changes;
}

// ── JSONL migration ────────────────────────────────────────────────────────

async function migrateFromJsonl(): Promise<void> {
  const config = getMemoryConfig();
  const jsonlPath = path.join(config.storagePath, "index", "summaries.jsonl");

  if (!fs.existsSync(jsonlPath)) return;

  // Check if DB already has summaries (already migrated)
  const d = getDb();
  const count = d.prepare("SELECT COUNT(*) as cnt FROM summaries").get() as { cnt: number };
  if (count.cnt > 0) {
    // Already migrated, clean up JSONL
    fs.unlinkSync(jsonlPath);
    console.info("[Memory] JSONL already migrated, removed stale file");
    return;
  }

  // Read JSONL entries
  const content = fs.readFileSync(jsonlPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const entries: SummaryIndexEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as SummaryIndexEntry);
    } catch {
      console.warn("[Memory] Skipping malformed JSONL line during migration");
    }
  }

  if (entries.length === 0) {
    fs.unlinkSync(jsonlPath);
    return;
  }

  console.info(`[Memory] Migrating ${entries.length} summaries from JSONL to SQLite...`);

  // Batch embed all summaries
  const summaryTexts = entries.map((e) => e.summary);
  let embeddings: number[][] = [];
  try {
    embeddings = await embedBatch(summaryTexts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Memory] Failed to embed during migration (inserting without vectors): ${msg}`);
    embeddings = summaryTexts.map(() => []);
  }

  // Insert all entries
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as SummaryIndexEntry;
    const embedding = embeddings[i] ?? [];
    insertSummary(entry, embedding);
  }

  // Remove JSONL file
  fs.unlinkSync(jsonlPath);
  console.info(`[Memory] Migration complete: ${entries.length} summaries moved to SQLite`);
}
