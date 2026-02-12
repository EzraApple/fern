// Internal barrel for test convenience (vi.resetModules + dynamic import pattern).
// External consumers should import from specific files (core.js, summaries.js, etc.).
export { initMemoryDb, closeDb, getDb, isVectorReady, vectorToBlob } from "@/memory/db/core.js";
export { insertSummary, listSummaries } from "@/memory/db/summaries.js";
export {
  insertMemory,
  deleteMemory,
  getMemoryById,
  listMemories,
} from "@/memory/db/memories.js";
export {
  saveThreadSession,
  getThreadSession,
  deleteStaleThreadSessions,
} from "@/memory/db/thread-sessions.js";
export type { ThreadSessionRow } from "@/memory/db/thread-sessions.js";
