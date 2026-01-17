// src/.opencode/tool/utils.ts
var TOOL_TIMEOUT_MS = 3e4;
var LONG_TOOL_TIMEOUT_MS = 6e4;
var SETUP_TIMEOUT_MS = 12e4;
var VIDEO_TIMEOUT_MS = 15 * 60 * 1e3;
async function withToolTimeout(promise, timeoutMs = TOOL_TIMEOUT_MS, operation = "Tool operation") {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}
function withTimeout(fn, timeoutMs = TOOL_TIMEOUT_MS, operationName) {
  return async (args) => {
    try {
      return await withToolTimeout(
        fn(args),
        timeoutMs,
        operationName ?? fn.name ?? "Tool operation"
      );
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
}
export {
  LONG_TOOL_TIMEOUT_MS,
  SETUP_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
  VIDEO_TIMEOUT_MS,
  withTimeout,
  withToolTimeout
};
