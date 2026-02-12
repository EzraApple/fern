import { getDb } from "@/memory/db/core.js";

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
