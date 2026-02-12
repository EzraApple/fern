import { getDb } from "@/memory/db/core.js";
import type { Task, TaskStatus } from "@/tasks/types.js";
import { ulid } from "ulid";

// ── Row type from SQLite ──────────────────────────────────────────────────

interface TaskRow {
  id: string;
  thread_id: string;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    threadId: row.thread_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as TaskStatus,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Schema ────────────────────────────────────────────────────────────────

export function createTasksSchema(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      thread_id   TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_thread_status ON tasks(thread_id, status);
  `);
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export function insertTask(task: Task): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO tasks (id, thread_id, title, description, status, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.id,
    task.threadId,
    task.title,
    task.description ?? null,
    task.status,
    task.sortOrder,
    task.createdAt,
    task.updatedAt
  );
}

export function getTaskById(id: string): Task | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

/**
 * List all tasks for a thread, ordered: in_progress first, then pending by sort_order,
 * then done, then cancelled.
 */
export function listTasksByThread(threadId: string): Task[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT * FROM tasks WHERE thread_id = ?
       ORDER BY
         CASE status
           WHEN 'in_progress' THEN 0
           WHEN 'pending' THEN 1
           WHEN 'done' THEN 2
           WHEN 'cancelled' THEN 3
         END,
         sort_order ASC,
         created_at ASC`
    )
    .all(threadId) as TaskRow[];
  return rows.map(rowToTask);
}

/** Update a task's fields. Sets updated_at automatically. */
export function updateTask(
  id: string,
  updates: { status?: TaskStatus; title?: string; description?: string; sortOrder?: number }
): void {
  const d = getDb();
  const now = new Date().toISOString();
  const setClauses: string[] = ["updated_at = ?"];
  const params: (string | number)[] = [now];

  if (updates.status !== undefined) {
    setClauses.push("status = ?");
    params.push(updates.status);
  }
  if (updates.title !== undefined) {
    setClauses.push("title = ?");
    params.push(updates.title);
  }
  if (updates.description !== undefined) {
    setClauses.push("description = ?");
    params.push(updates.description);
  }
  if (updates.sortOrder !== undefined) {
    setClauses.push("sort_order = ?");
    params.push(updates.sortOrder);
  }

  params.push(id);
  d.prepare(`UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);
}

/** Get the next task to work on: first in_progress, then first pending by sort_order. */
export function getNextTask(threadId: string): Task | null {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT * FROM tasks WHERE thread_id = ? AND status IN ('in_progress', 'pending')
       ORDER BY
         CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 END,
         sort_order ASC,
         created_at ASC
       LIMIT 1`
    )
    .get(threadId) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

/** Delete old done/cancelled tasks (older than 7 days). Returns count deleted. */
export function cleanupOldTasks(): number {
  const d = getDb();
  const result = d
    .prepare(
      "DELETE FROM tasks WHERE status IN ('done', 'cancelled') AND updated_at < datetime('now', '-7 days')"
    )
    .run();
  return result.changes;
}

/** Generate a new task ID */
export function generateTaskId(): string {
  return `task_${ulid()}`;
}
