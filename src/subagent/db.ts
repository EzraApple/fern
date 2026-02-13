import { getDb } from "@/memory/db/core.js";
import type { SubagentTask, SubagentTaskStatus, SubagentType } from "@/subagent/types.js";
import { ulid } from "ulid";

// ── Row type from SQLite ──────────────────────────────────────────────────

interface TaskRow {
  id: string;
  agent_type: string;
  status: string;
  prompt: string;
  parent_session_id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  result: string | null;
  error: string | null;
}

function rowToTask(row: TaskRow): SubagentTask {
  return {
    id: row.id,
    agentType: row.agent_type as SubagentType,
    status: row.status as SubagentTaskStatus,
    prompt: row.prompt,
    parentSessionId: row.parent_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
  };
}

// ── Schema ────────────────────────────────────────────────────────────────

export function createSubagentSchema(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS subagent_tasks (
      id                TEXT PRIMARY KEY,
      agent_type        TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      prompt            TEXT NOT NULL,
      parent_session_id TEXT NOT NULL,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      completed_at      TEXT,
      result            TEXT,
      error             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_subagent_status ON subagent_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_subagent_parent ON subagent_tasks(parent_session_id, status);
  `);
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export function insertSubagentTask(task: SubagentTask): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO subagent_tasks (id, agent_type, status, prompt, parent_session_id, created_at, updated_at, completed_at, result, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.id,
    task.agentType,
    task.status,
    task.prompt,
    task.parentSessionId,
    task.createdAt,
    task.updatedAt,
    task.completedAt ?? null,
    task.result ?? null,
    task.error ?? null
  );
}

export function getSubagentTaskById(id: string): SubagentTask | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM subagent_tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

/** Update a task's status and optional fields */
export function updateSubagentTaskStatus(
  id: string,
  status: SubagentTaskStatus,
  fields?: {
    completedAt?: string;
    result?: string;
    error?: string;
  }
): void {
  const d = getDb();
  const now = new Date().toISOString();

  if (fields?.completedAt || fields?.result || fields?.error) {
    d.prepare(
      `UPDATE subagent_tasks
       SET status = ?, updated_at = ?,
           completed_at = COALESCE(?, completed_at),
           result = COALESCE(?, result),
           error = COALESCE(?, error)
       WHERE id = ?`
    ).run(status, now, fields.completedAt ?? null, fields.result ?? null, fields.error ?? null, id);
  } else {
    d.prepare("UPDATE subagent_tasks SET status = ?, updated_at = ? WHERE id = ?").run(
      status,
      now,
      id
    );
  }
}

/** Atomically claim a task: pending → running. Returns true if claimed. */
export function claimSubagentTask(id: string): boolean {
  const d = getDb();
  const now = new Date().toISOString();
  const result = d
    .prepare(
      "UPDATE subagent_tasks SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'"
    )
    .run(now, id);
  return result.changes === 1;
}

/** List tasks for a parent session */
export function listSubagentTasks(parentSessionId: string): SubagentTask[] {
  const d = getDb();
  const rows = d
    .prepare("SELECT * FROM subagent_tasks WHERE parent_session_id = ? ORDER BY created_at DESC")
    .all(parentSessionId) as TaskRow[];
  return rows.map(rowToTask);
}

/** Mark stale running tasks as failed (crash recovery — NOT pending, since tasks are one-shot) */
export function recoverStaleTasks(): number {
  const d = getDb();
  const now = new Date().toISOString();
  const result = d
    .prepare(
      "UPDATE subagent_tasks SET status = 'failed', error = 'Process restarted during execution', updated_at = ? WHERE status = 'running'"
    )
    .run(now);
  return result.changes;
}

/** Clean up old completed/failed/cancelled tasks (7-day TTL) */
export function cleanupOldSubagentTasks(): number {
  const d = getDb();
  const result = d
    .prepare(
      "DELETE FROM subagent_tasks WHERE status IN ('completed', 'failed', 'cancelled') AND updated_at < datetime('now', '-7 days')"
    )
    .run();
  return result.changes;
}

/** Generate a new task ID */
export function generateSubagentTaskId(): string {
  return `sub_${ulid()}`;
}
