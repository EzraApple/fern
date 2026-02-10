import { ulid } from "ulid";
import { getDb } from "../memory/db.js";
import type { JobStatus, JobType, ScheduledJob } from "./types.js";

// ── Row type from SQLite ──────────────────────────────────────────────────

interface JobRow {
  id: string;
  type: string;
  status: string;
  prompt: string;
  scheduled_at: string;
  cron_expr: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  last_run_response: string | null;
  last_error: string | null;
  metadata: string;
}

function rowToJob(row: JobRow): ScheduledJob {
  return {
    id: row.id,
    type: row.type as JobType,
    status: row.status as JobStatus,
    prompt: row.prompt,
    scheduledAt: row.scheduled_at,
    cronExpr: row.cron_expr ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    lastRunResponse: row.last_run_response ?? undefined,
    lastError: row.last_error ?? undefined,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}

// ── Schema ────────────────────────────────────────────────────────────────

export function createSchedulerSchema(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      prompt          TEXT NOT NULL,
      scheduled_at    TEXT NOT NULL,
      cron_expr       TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      completed_at    TEXT,
      last_run_response TEXT,
      last_error      TEXT,
      metadata        TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled ON scheduled_jobs(status, scheduled_at);
  `);
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export function insertJob(job: ScheduledJob): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO scheduled_jobs (id, type, status, prompt, scheduled_at, cron_expr, created_at, updated_at, completed_at, last_run_response, last_error, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    job.id,
    job.type,
    job.status,
    job.prompt,
    job.scheduledAt,
    job.cronExpr ?? null,
    job.createdAt,
    job.updatedAt,
    job.completedAt ?? null,
    job.lastRunResponse ?? null,
    job.lastError ?? null,
    JSON.stringify(job.metadata)
  );
}

export function getJobById(id: string): ScheduledJob | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM scheduled_jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

/** Get jobs that are due for execution (status=pending and scheduled_at <= now) */
export function getDueJobs(now: string, limit: number): ScheduledJob[] {
  const d = getDb();
  const rows = d
    .prepare(
      "SELECT * FROM scheduled_jobs WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT ?"
    )
    .all(now, limit) as JobRow[];
  return rows.map(rowToJob);
}

/** Update a job's status and optional fields */
export function updateJobStatus(
  id: string,
  status: JobStatus,
  fields?: {
    completedAt?: string;
    lastRunResponse?: string;
    lastError?: string;
    metadata?: Record<string, unknown>;
  }
): void {
  const d = getDb();
  const now = new Date().toISOString();

  if (fields?.completedAt || fields?.lastRunResponse || fields?.lastError || fields?.metadata) {
    d.prepare(
      `UPDATE scheduled_jobs
       SET status = ?, updated_at = ?,
           completed_at = COALESCE(?, completed_at),
           last_run_response = COALESCE(?, last_run_response),
           last_error = COALESCE(?, last_error),
           metadata = COALESCE(?, metadata)
       WHERE id = ?`
    ).run(
      status,
      now,
      fields.completedAt ?? null,
      fields.lastRunResponse ?? null,
      fields.lastError ?? null,
      fields.metadata ? JSON.stringify(fields.metadata) : null,
      id
    );
  } else {
    d.prepare("UPDATE scheduled_jobs SET status = ?, updated_at = ? WHERE id = ?").run(
      status,
      now,
      id
    );
  }
}

/** Advance a recurring job to its next scheduled time */
export function advanceRecurringJob(id: string, nextScheduledAt: string): void {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(
    "UPDATE scheduled_jobs SET status = 'pending', scheduled_at = ?, updated_at = ?, completed_at = NULL, last_error = NULL WHERE id = ?"
  ).run(nextScheduledAt, now, id);
}

/** List jobs with optional filters */
export function listJobs(options?: {
  status?: JobStatus;
  limit?: number;
}): ScheduledJob[] {
  const d = getDb();
  const limit = options?.limit ?? 50;

  let sql = "SELECT * FROM scheduled_jobs";
  const params: (string | number)[] = [];

  if (options?.status) {
    sql += " WHERE status = ?";
    params.push(options.status);
  }
  sql += " ORDER BY scheduled_at ASC LIMIT ?";
  params.push(limit);

  const rows = d.prepare(sql).all(...params) as JobRow[];
  return rows.map(rowToJob);
}

/** Delete a job by ID */
export function deleteJob(id: string): boolean {
  const d = getDb();
  const result = d.prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Atomically claim a job: pending -> running. Returns true if claimed. */
export function claimJob(id: string): boolean {
  const d = getDb();
  const now = new Date().toISOString();
  const result = d
    .prepare(
      "UPDATE scheduled_jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'"
    )
    .run(now, id);
  return result.changes === 1;
}

/** Reset stale running jobs to pending (e.g. after crash recovery) */
export function recoverStaleJobs(): number {
  const d = getDb();
  const now = new Date().toISOString();
  const result = d
    .prepare(
      "UPDATE scheduled_jobs SET status = 'pending', updated_at = ? WHERE status = 'running'"
    )
    .run(now);
  return result.changes;
}

/** Generate a new job ID */
export function generateJobId(): string {
  return `job_${ulid()}`;
}
