import { getClient } from "@/core/opencode/server.js";
import { signalSessionComplete, signalSessionError } from "@/core/opencode/session.js";
import type { ProgressCallback, ProgressEvent } from "@/core/opencode/session.js";

/**
 * Get the last assistant response text from a session
 */
export async function getLastResponse(sessionId: string): Promise<string> {
  const client = await getClient();

  try {
    const result = await client.session.messages({
      path: { id: sessionId },
    });

    const messages = result.data ?? [];
    // Find the last assistant message and extract text parts
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.info.role === "assistant" && msg.parts) {
        const textParts: string[] = [];
        for (const part of msg.parts) {
          if (part.type === "text" && "text" in part && typeof part.text === "string") {
            textParts.push(part.text);
          }
        }
        if (textParts.length > 0) {
          const response = textParts.join("");
          return response;
        }
      }
    }

    console.warn(`[OpenCode] No assistant response found in session ${sessionId}`);
    return "";
  } catch (error) {
    console.error(`[OpenCode] Failed to get messages for session ${sessionId}:`, error);
    return "";
  }
}

/**
 * Get all messages in a session (for memory archival observer)
 */
export async function getSessionMessages(sessionId: string): Promise<unknown[]> {
  const client = await getClient();

  try {
    const result = await client.session.messages({
      path: { id: sessionId },
    });
    return result.data ?? [];
  } catch (error) {
    console.error(`[OpenCode] Failed to get messages for session ${sessionId}:`, error);
    return [];
  }
}

/**
 * List all sessions
 */
export async function listSessions(): Promise<unknown[]> {
  try {
    const client = await getClient();
    const result = await client.session.list();
    return result.data ?? [];
  } catch (error) {
    console.error("[OpenCode] Failed to list sessions:", error);
    return [];
  }
}

/**
 * Get a session by ID
 */
export async function getSession(sessionId: string): Promise<unknown | null> {
  try {
    const client = await getClient();
    const result = await client.session.get({
      path: { id: sessionId },
    });
    return result.data ?? null;
  } catch (error) {
    console.error(`[OpenCode] Failed to get session ${sessionId}:`, error);
    return null;
  }
}

/**
 * List available tools
 */
export async function listTools(): Promise<string[]> {
  try {
    const client = await getClient();
    const result = await client.tool.ids();
    const tools = result.data ?? [];
    return tools;
  } catch (error) {
    console.error("[OpenCode] Tool list failed:", error);
    return [];
  }
}

/**
 * Subscribe to real-time events from OpenCode
 * Returns an unsubscribe function
 */
export async function subscribeToEvents(
  sessionId: string,
  callback: ProgressCallback
): Promise<() => void> {
  const client = await getClient();
  let aborted = false;
  let receivedSessionIdle = false;

  // Start listening to real-time events in the background
  (async () => {
    try {
      const events = await client.event.subscribe();

      for await (const event of events.stream) {
        if (aborted) break;

        const eventType = (event as Record<string, unknown>).type as string;

        // Filter events for our session
        const eventSessionId = getSessionIdFromEvent(event);

        // Critical events must match our session
        const isCriticalEvent = eventType === "session.idle" || eventType === "session.error";
        if (isCriticalEvent && eventSessionId !== sessionId) {
          continue;
        }

        // Map event types to progress events
        const progressEvent = mapToProgressEvent(event, sessionId);
        if (progressEvent) {
          await callback(progressEvent);

          if (progressEvent.type === "session_idle") {
            receivedSessionIdle = true;
          }
        }
      }

      // Signal error if stream ended without session.idle
      if (!aborted && !receivedSessionIdle) {
        console.error(
          `[OpenCode] Event stream ended without session.idle for session ${sessionId}`
        );
        signalSessionError(sessionId, "Session ended unexpectedly");
      }
    } catch (error) {
      if (!aborted) {
        console.error("[OpenCode] Event stream error:", error);
        signalSessionError(sessionId, "Event stream error");
      }
    }
  })();

  // Return unsubscribe function
  return () => {
    aborted = true;
  };
}

/**
 * Extract session ID from an OpenCode event
 */
function getSessionIdFromEvent(event: unknown): string | undefined {
  const evt = event as Record<string, unknown>;
  const properties = evt.properties as Record<string, unknown> | undefined;
  return properties?.sessionID as string | undefined;
}

/**
 * Map OpenCode events to progress events
 */
function mapToProgressEvent(event: unknown, sessionId: string): ProgressEvent | null {
  const evt = event as Record<string, unknown>;
  const eventType = evt.type as string;
  const properties = evt.properties as Record<string, unknown> | undefined;

  switch (eventType) {
    case "session.idle":
      // Signal completion via callback
      signalSessionComplete(sessionId);
      return { type: "session_idle", sessionId };

    case "session.error": {
      const message = (properties?.message as string) || "Unknown error";
      signalSessionError(sessionId, message);
      return { type: "session_error", message, sessionId };
    }

    case "message.part.updated": {
      const part = properties?.part as Record<string, unknown> | undefined;
      if (part?.type === "tool") {
        const state = part.state as Record<string, unknown> | undefined;
        const status = state?.status as string | undefined;
        const tool = part.tool as string | undefined;

        if (status === "running") {
          return { type: "tool_start", tool, sessionId };
        }
        if (status === "completed") {
          return { type: "tool_complete", tool, sessionId };
        }
        if (status === "error") {
          return { type: "tool_error", tool, sessionId };
        }
      }
      if (part?.type === "text") {
        const text = part.text as string | undefined;
        return { type: "text", message: text, sessionId };
      }
      return null;
    }

    default:
      return null;
  }
}
