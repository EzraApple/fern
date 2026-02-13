import { getClient } from "@/core/opencode/server.js";
import {
  deleteStaleThreadSessions,
  getThreadSession,
  saveThreadSession,
} from "@/memory/db/thread-sessions.js";

const THREAD_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// Agent turn timeout (default 8 minutes)
const AGENT_TURN_TIMEOUT_MS = Number(process.env.FERN_AGENT_TURN_TIMEOUT_MS) || 480_000;

// Event types for progress tracking
export interface ProgressEvent {
  type:
    | "tool_start"
    | "tool_complete"
    | "tool_error"
    | "text"
    | "thinking"
    | "session_idle"
    | "session_error";
  tool?: string;
  status?: string;
  message?: string;
  sessionId?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void | Promise<void>;

/**
 * Get or create a session for a thread
 * If threadId is provided, reuses existing session for that thread
 */
export interface SessionInfo {
  sessionId: string;
  shareUrl?: string;
}

export async function getOrCreateSession(options: {
  title?: string;
  threadId?: string; // e.g., "whatsapp_+1234567890"
}): Promise<SessionInfo> {
  const { title, threadId } = options;

  // Clean up stale sessions and check for existing mapping in SQLite
  try {
    deleteStaleThreadSessions(THREAD_SESSION_TTL_MS);
  } catch {
    // DB may not be initialized yet during early startup
  }

  if (threadId) {
    try {
      const entry = getThreadSession(threadId);
      if (entry) {
        return { sessionId: entry.sessionId, shareUrl: entry.shareUrl };
      }
    } catch {
      // DB may not be initialized yet
    }
  }

  const client = await getClient();

  // Create session
  const result = await client.session.create({
    body: title ? { title } : undefined,
  });

  const sessionId = result.data?.id ?? (result as unknown as { id?: string })?.id;

  if (!sessionId) {
    throw new Error("Failed to create OpenCode session - no ID returned");
  }

  // Share the session for debugging
  let shareUrl: string | undefined;
  try {
    const shareResult = await client.session.share({
      path: { id: sessionId },
    });
    shareUrl = shareResult.data?.share?.url;
  } catch (shareError) {
    console.warn("[OpenCode] Failed to share session:", shareError);
  }

  // Store session mapping in SQLite
  if (threadId) {
    try {
      const now = Date.now();
      saveThreadSession({
        threadId,
        sessionId,
        shareUrl,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // DB may not be initialized yet
    }
  }

  return { sessionId, shareUrl };
}

// Track completion promises for sessions
const sessionCompletionCallbacks = new Map<
  string,
  { resolve: () => void; reject: (err: Error) => void }
>();

/**
 * Typed error for agent turn timeouts
 */
export class AgentTimeoutError extends Error {
  public readonly sessionId: string;
  public readonly elapsedMs: number;

  constructor(sessionId: string, elapsedMs: number) {
    super(`Agent turn timed out after ${Math.round(elapsedMs / 1000)}s (session: ${sessionId})`);
    this.name = "AgentTimeoutError";
    this.sessionId = sessionId;
    this.elapsedMs = elapsedMs;
  }
}

/**
 * Signal that a session has completed (called from event handler)
 */
export function signalSessionComplete(sessionId: string): void {
  const callback = sessionCompletionCallbacks.get(sessionId);
  if (callback) {
    callback.resolve();
    sessionCompletionCallbacks.delete(sessionId);
  }
}

/**
 * Signal that a session has an error (called from event handler)
 */
export function signalSessionError(sessionId: string, error: string): void {
  const callback = sessionCompletionCallbacks.get(sessionId);
  if (callback) {
    callback.reject(new Error(error));
    sessionCompletionCallbacks.delete(sessionId);
  }
}

/**
 * Send a prompt to a session and wait for completion
 * Completion is detected via session.idle event in the event stream
 */
export async function prompt(
  sessionId: string,
  text: string,
  options?: {
    agent?: string; // Specify which agent to use
    system?: string; // Override system prompt
  }
): Promise<void> {
  const client = await getClient();
  const startTime = Date.now();

  // Create completion promise
  const completionPromise = new Promise<void>((resolve, reject) => {
    sessionCompletionCallbacks.set(sessionId, { resolve, reject });
  });

  // Create timeout promise
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      sessionCompletionCallbacks.delete(sessionId);
      const elapsed = Date.now() - startTime;
      console.error(
        `[OpenCode] Agent turn timed out — session: ${sessionId}, elapsed: ${Math.round(elapsed / 1000)}s`
      );
      reject(new AgentTimeoutError(sessionId, elapsed));
    }, AGENT_TURN_TIMEOUT_MS);
  });

  const agentToUse = options?.agent ?? "fern";

  try {
    // Submit the prompt
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text }],
        agent: agentToUse,
        system: options?.system,
      },
    });

    // Wait for completion or timeout
    await Promise.race([completionPromise, timeoutPromise]);
  } catch (error) {
    console.error("[OpenCode] Prompt failed:", error);
    sessionCompletionCallbacks.delete(sessionId);
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Send a prompt with multiple parts (text + files) to a session and wait for completion
 * Completion is detected via session.idle event in the event stream
 */
export async function promptWithParts(
  sessionId: string,
  parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }>,
  options?: {
    agent?: string; // Specify which agent to use
    system?: string; // Override system prompt
  }
): Promise<void> {
  const client = await getClient();
  const startTime = Date.now();

  // Create completion promise
  const completionPromise = new Promise<void>((resolve, reject) => {
    sessionCompletionCallbacks.set(sessionId, { resolve, reject });
  });

  // Create timeout promise
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      sessionCompletionCallbacks.delete(sessionId);
      const elapsed = Date.now() - startTime;
      console.error(
        `[OpenCode] Agent turn timed out — session: ${sessionId}, elapsed: ${Math.round(elapsed / 1000)}s`
      );
      reject(new AgentTimeoutError(sessionId, elapsed));
    }, AGENT_TURN_TIMEOUT_MS);
  });

  const agentToUse = options?.agent ?? "fern";

  try {
    // Submit the prompt with parts
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts,
        agent: agentToUse,
        system: options?.system,
      },
    });

    // Wait for completion or timeout
    await Promise.race([completionPromise, timeoutPromise]);
  } catch (error) {
    console.error("[OpenCode] Prompt with parts failed:", error);
    sessionCompletionCallbacks.delete(sessionId);
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}
