/**
 * Shared utilities for OpenCode tools
 * Note (Kevin, 2026-01-06): Centralized timeout handling to prevent tool hangs
 */

// Default timeout for tool operations (30 seconds)
export const TOOL_TIMEOUT_MS = 30000;

// Longer timeout for operations that may take more time (60 seconds)
export const LONG_TOOL_TIMEOUT_MS = 60000;

// Note (Kevin, 2026-01-07): Extra long timeout for workspace setup (clone + install = 2 minutes)
export const SETUP_TIMEOUT_MS = 120000;

// Note (Kevin, 2026-01-08): Video download timeout - 15 minutes for large videos (Fathom ~170MB takes 10+ min)
export const VIDEO_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Wrap a promise with a hard timeout to prevent hanging
 * Returns a JSON error string on timeout instead of throwing
 */
export async function withToolTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = TOOL_TIMEOUT_MS,
  operation: string = "Tool operation"
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Wrap an async function to add timeout handling
 * Returns JSON error string on timeout
 */
export function withTimeout<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  timeoutMs: number = TOOL_TIMEOUT_MS,
  operationName?: string
): (args: TArgs) => Promise<TResult | string> {
  return async (args: TArgs) => {
    try {
      return await withToolTimeout(
        fn(args),
        timeoutMs,
        operationName ?? fn.name ?? "Tool operation"
      );
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
