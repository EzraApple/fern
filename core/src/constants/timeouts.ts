// Note (Kevin, 2026-01-04): Shared timeout constants for Trigger.dev and OpenCode
// Must match Trigger.dev maxDuration to prevent premature timeouts

/** Maximum duration for agent tasks in seconds (5 hours) */
export const MAX_TASK_DURATION_SECONDS = 18000;

/** Maximum duration for agent tasks in milliseconds */
export const MAX_TASK_DURATION_MS = MAX_TASK_DURATION_SECONDS * 1000;
