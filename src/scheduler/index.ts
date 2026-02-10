import { createSchedulerSchema } from "./db.js";
import { startSchedulerLoop, stopSchedulerLoop } from "./loop.js";

export function initScheduler(): void {
  createSchedulerSchema();
  startSchedulerLoop();
}

export function stopScheduler(): void {
  stopSchedulerLoop();
}

export { createSchedulerSchema } from "./db.js";
export {
  deleteJob,
  generateJobId,
  getDueJobs,
  getJobById,
  insertJob,
  listJobs,
  updateJobStatus,
} from "./db.js";
export { getSchedulerConfig } from "./config.js";
export type { CreateJobInput, JobStatus, JobType, ScheduledJob, SchedulerConfig } from "./types.js";
