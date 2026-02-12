import { getDb, isVectorReady, vectorToBlob } from "@/memory/db/core.js";
import { embedText } from "@/memory/embeddings.js";
import type { UnifiedSearchResult } from "@/memory/types.js";

type SqlParam = null | number | bigint | string | Buffer;

const VECTOR_WEIGHT = 0.7;
const TEXT_WEIGHT = 0.3;
const RECENCY_WEIGHT = 0.15; // blended in: final = (1 - RECENCY_WEIGHT) * relevance + RECENCY_WEIGHT * recency
const RECENCY_HALFLIFE_DAYS = 30; // score halves every 30 days

// ── FTS5 query building (from openclaw hybrid.ts) ──────────────────────────

function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[A-Za-z0-9_]+/g)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  if (tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" AND ");
}

/** Normalize BM25 rank to 0-1 score (from openclaw hybrid.ts) */
function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

/** Exponential decay: 1.0 for now, 0.5 after halflife days, 0.25 after 2x halflife, etc. */
function recencyScore(timestampMs: number): number {
  const ageMs = Math.max(0, Date.now() - timestampMs);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return 0.5 ** (ageDays / RECENCY_HALFLIFE_DAYS);
}

// ── Intermediate types ─────────────────────────────────────────────────────

interface ScoredEntry {
  id: string;
  source: "archive" | "memory";
  text: string;
  vectorScore: number;
  textScore: number;
  // Archive fields
  threadId?: string;
  tokenCount?: number;
  timeStart?: number;
  timeEnd?: number;
  // Memory fields
  memoryType?: "fact" | "preference" | "learning";
  tags?: string[];
  // Timestamp for recency boost (epoch ms)
  timestamp?: number;
}

// ── Main search ────────────────────────────────────────────────────────────

/** Search archived memory and persistent memories using hybrid vector + FTS5 search */
export async function searchMemory(
  query: string,
  options?: {
    threadId?: string;
    limit?: number;
    minScore?: number;
  }
): Promise<UnifiedSearchResult[]> {
  const limit = options?.limit ?? 5;
  const minScore = options?.minScore ?? 0.05;

  // Embed the query
  let queryVec: number[] = [];
  try {
    queryVec = await embedText(query);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Memory] Failed to embed query (using FTS-only): ${msg}`);
  }

  const byId = new Map<string, ScoredEntry>();

  // Vector search
  if (isVectorReady() && queryVec.length > 0) {
    vectorSearchSummaries(queryVec, limit, options?.threadId, byId);
    vectorSearchMemories(queryVec, limit, byId);
  }

  // FTS5 keyword search
  const ftsQuery = buildFtsQuery(query);
  if (ftsQuery) {
    ftsSearchSummaries(ftsQuery, limit, options?.threadId, byId);
    ftsSearchMemories(ftsQuery, limit, byId);
  }

  // Merge scores and sort
  const results: UnifiedSearchResult[] = [];
  for (const entry of byId.values()) {
    const relevance = VECTOR_WEIGHT * entry.vectorScore + TEXT_WEIGHT * entry.textScore;
    const recency = entry.timestamp != null ? recencyScore(entry.timestamp) : 0.5;
    const score = (1 - RECENCY_WEIGHT) * relevance + RECENCY_WEIGHT * recency;
    if (score < minScore) continue;

    results.push({
      id: entry.id,
      source: entry.source,
      text: entry.text,
      relevanceScore: score,
      threadId: entry.threadId,
      tokenCount: entry.tokenCount,
      timeRange:
        entry.timeStart !== undefined && entry.timeEnd !== undefined
          ? { start: entry.timeStart, end: entry.timeEnd }
          : undefined,
      memoryType: entry.memoryType,
      tags: entry.tags,
    });
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results.slice(0, limit);
}

// ── Vector search helpers ──────────────────────────────────────────────────

function vectorSearchSummaries(
  queryVec: number[],
  limit: number,
  threadId: string | undefined,
  byId: Map<string, ScoredEntry>
): void {
  const d = getDb();
  let sql = `
    SELECT s.id, s.summary, s.thread_id, s.token_count, s.time_start, s.time_end,
           vec_distance_cosine(v.embedding, ?) AS dist
      FROM summaries_vec v
      JOIN summaries s ON s.id = v.id`;
  const params: SqlParam[] = [vectorToBlob(queryVec)];

  if (threadId) {
    sql += " WHERE s.thread_id = ?";
    params.push(threadId);
  }
  sql += " ORDER BY dist ASC LIMIT ?";
  params.push(limit);

  const rows = d.prepare(sql).all(...params) as Array<{
    id: string;
    summary: string;
    thread_id: string;
    token_count: number;
    time_start: number;
    time_end: number;
    dist: number;
  }>;

  for (const row of rows) {
    const score = 1 - row.dist;
    const existing = byId.get(row.id);
    if (existing) {
      existing.vectorScore = Math.max(existing.vectorScore, score);
    } else {
      byId.set(row.id, {
        id: row.id,
        source: "archive",
        text: row.summary,
        vectorScore: score,
        textScore: 0,
        threadId: row.thread_id,
        tokenCount: row.token_count,
        timeStart: row.time_start,
        timeEnd: row.time_end,
        timestamp: row.time_end,
      });
    }
  }
}

function vectorSearchMemories(
  queryVec: number[],
  limit: number,
  byId: Map<string, ScoredEntry>
): void {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT m.id, m.content, m.type, m.tags, m.created_at,
              vec_distance_cosine(v.embedding, ?) AS dist
         FROM memories_vec v
         JOIN memories m ON m.id = v.id
        ORDER BY dist ASC LIMIT ?`
    )
    .all(vectorToBlob(queryVec), limit) as Array<{
    id: string;
    content: string;
    type: string;
    tags: string;
    created_at: string;
    dist: number;
  }>;

  for (const row of rows) {
    const score = 1 - row.dist;
    const existing = byId.get(row.id);
    if (existing) {
      existing.vectorScore = Math.max(existing.vectorScore, score);
    } else {
      byId.set(row.id, {
        id: row.id,
        source: "memory",
        text: row.content,
        vectorScore: score,
        textScore: 0,
        memoryType: row.type as "fact" | "preference" | "learning",
        tags: JSON.parse(row.tags) as string[],
        timestamp: new Date(row.created_at).getTime(),
      });
    }
  }
}

// ── FTS5 search helpers ────────────────────────────────────────────────────

function ftsSearchSummaries(
  ftsQuery: string,
  limit: number,
  threadId: string | undefined,
  byId: Map<string, ScoredEntry>
): void {
  const d = getDb();
  let sql = `
    SELECT f.id, f.summary, f.thread_id, bm25(summaries_fts) AS rank
      FROM summaries_fts f`;
  const params: SqlParam[] = [];

  if (threadId) {
    sql += " WHERE summaries_fts MATCH ? AND f.thread_id = ?";
    params.push(ftsQuery, threadId);
  } else {
    sql += " WHERE summaries_fts MATCH ?";
    params.push(ftsQuery);
  }
  sql += " ORDER BY rank ASC LIMIT ?";
  params.push(limit);

  const rows = d.prepare(sql).all(...params) as Array<{
    id: string;
    summary: string;
    thread_id: string;
    rank: number;
  }>;

  for (const row of rows) {
    const score = bm25RankToScore(row.rank);
    const existing = byId.get(row.id);
    if (existing) {
      existing.textScore = Math.max(existing.textScore, score);
    } else {
      // Need to get full summary data from main table
      const full = d
        .prepare("SELECT token_count, time_start, time_end FROM summaries WHERE id = ?")
        .get(row.id) as { token_count: number; time_start: number; time_end: number } | undefined;

      byId.set(row.id, {
        id: row.id,
        source: "archive",
        text: row.summary,
        vectorScore: 0,
        textScore: score,
        threadId: row.thread_id,
        tokenCount: full?.token_count,
        timeStart: full?.time_start,
        timeEnd: full?.time_end,
        timestamp: full?.time_end,
      });
    }
  }
}

function ftsSearchMemories(ftsQuery: string, limit: number, byId: Map<string, ScoredEntry>): void {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT f.id, f.content, f.type, bm25(memories_fts) AS rank
         FROM memories_fts f
        WHERE memories_fts MATCH ?
        ORDER BY rank ASC LIMIT ?`
    )
    .all(ftsQuery, limit) as Array<{
    id: string;
    content: string;
    type: string;
    rank: number;
  }>;

  for (const row of rows) {
    const score = bm25RankToScore(row.rank);
    const existing = byId.get(row.id);
    if (existing) {
      existing.textScore = Math.max(existing.textScore, score);
    } else {
      // Get tags and timestamp from main table
      const full = d.prepare("SELECT tags, created_at FROM memories WHERE id = ?").get(row.id) as
        | { tags: string; created_at: string }
        | undefined;

      byId.set(row.id, {
        id: row.id,
        source: "memory",
        text: row.content,
        vectorScore: 0,
        textScore: score,
        memoryType: row.type as "fact" | "preference" | "learning",
        tags: full ? (JSON.parse(full.tags) as string[]) : [],
        timestamp: full ? new Date(full.created_at).getTime() : undefined,
      });
    }
  }
}
