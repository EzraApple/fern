import { createSchedulerSchema } from "@/scheduler/db.js";
import { startSchedulerLoop, stopSchedulerLoop } from "@/scheduler/loop.js";

export function initScheduler(): void {
  createSchedulerSchema();
  startSchedulerLoop();
}

export function stopScheduler(): void {
  stopSchedulerLoop();
}

export { createSchedulerSchema } from "@/scheduler/db.js";
export {
  deleteJob,
  generateJobId,
  getDueJobs,
  getJobById,
  insertJob,
  listJobs,
  updateJobStatus,
} from "@/scheduler/db.js";
export { getSchedulerConfig } from "@/scheduler/config.js";
export type {
  CreateJobInput,
  JobStatus,
  JobType,
  ScheduledJob,
  SchedulerConfig,
} from "@/scheduler/types.js";
