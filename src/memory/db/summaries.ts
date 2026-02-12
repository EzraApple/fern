import { getDb, isVectorReady, vectorToBlob } from "@/memory/db/core.js";
import type { SummaryIndexEntry } from "@/memory/types.js";

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
  if (isVectorReady() && embedding.length > 0) {
    d.prepare("INSERT OR REPLACE INTO summaries_vec (id, embedding) VALUES (?, ?)").run(
      entry.chunkId,
      vectorToBlob(embedding)
    );
  }
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
