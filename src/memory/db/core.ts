import * as fs from "node:fs";
import * as path from "node:path";
import { getMemoryConfig } from "@/memory/config.js";
import { migrateFromJsonl } from "@/memory/db/migration.js";
import Database from "better-sqlite3";

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
