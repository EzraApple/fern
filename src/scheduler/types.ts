/** Status lifecycle: pending → running → completed | failed; pending → cancelled */
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** One-shot fires once; recurring fires on cron schedule */
export type JobType = "one_shot" | "recurring";

/** A scheduled job in the database */
export interface ScheduledJob {
  id: string;
  type: JobType;
  status: JobStatus;
  prompt: string;
  scheduledAt: string; // ISO 8601
  cronExpr?: string; // Cron expression (recurring only)
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastRunResponse?: string;
  lastError?: string;
  metadata: Record<string, unknown>;
}

/** Input for creating a new job */
export interface CreateJobInput {
  prompt: string;
  /** Absolute time in ISO 8601 */
  scheduledAt?: string;
  /** Relative delay in milliseconds */
  delayMs?: number;
  /** Cron expression for recurring jobs */
  cronExpr?: string;
  metadata?: Record<string, unknown>;
}

/** Scheduler configuration */
export interface SchedulerConfig {
  enabled: boolean;
  pollIntervalMs: number;
  maxConcurrentJobs: number;
}
