import * as fs from "node:fs";
import * as path from "node:path";
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import { getMoonshotApiKey, loadConfig } from "../config/config.js";

/**
 * OpenCode Service for Fern
 *
 * Manages the embedded OpenCode server and client for AI agent operations.
 * Based on replee's implementation with Fern-specific simplifications.
 */

// Type for the OpenCode client
type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

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

// Store server and client info (shared, single instance)
let serverInfo: {
  url: string;
  port: number;
  close: () => void;
  client: OpenCodeClient;
} | null = null;

// Map thread IDs to session IDs for conversation continuity
interface ThreadSessionEntry {
  sessionId: string;
  shareUrl?: string;
  createdAt: number;
}
const threadSessions = new Map<string, ThreadSessionEntry>();
const THREAD_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Clean up stale thread sessions older than TTL
 */
function cleanupStaleThreadSessions(): void {
  const cutoff = Date.now() - THREAD_SESSION_TTL_MS;
  let cleaned = 0;
  for (const [threadId, entry] of threadSessions) {
    if (entry.createdAt < cutoff) {
      threadSessions.delete(threadId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
  }
}

// Agent turn timeout (default 8 minutes)
const AGENT_TURN_TIMEOUT_MS = Number(process.env.FERN_AGENT_TURN_TIMEOUT_MS) || 480_000;

// Port range for server
const PORT_START = 4096;
const PORT_END = 4300;

// Track which ports are currently in use
const usedPorts = new Set<number>();

/**
 * Find an available port for the server
 */
function findAvailablePort(): number {
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }
  throw new Error(`No available ports in range ${PORT_START}-${PORT_END}`);
}

/**
 * OpenCode configuration for Fern
 *
 * Supports multiple LLM providers via env vars:
 *   FERN_MODEL_PROVIDER=moonshot|openai (default: openai)
 *   FERN_MODEL=kimi-k2.5|gpt-4o-mini|... (default: gpt-4o-mini)
 *   MOONSHOT_API_KEY — required when provider is moonshot
 *   OPENAI_API_KEY — always required (embeddings + fallback)
 */
function getOpenCodeConfig() {
  const config = loadConfig();
  const moonshotKey = getMoonshotApiKey();

  // Build provider configurations
  const providerConfig: Record<
    string,
    {
      api?: string;
      options?: { apiKey?: string; baseURL?: string; [key: string]: unknown };
      models?: Record<
        string,
        {
          name?: string;
          tool_call?: boolean;
          attachment?: boolean;
          reasoning?: boolean;
          temperature?: boolean;
          limit?: { context: number; output: number };
        }
      >;
    }
  > = {};

  // Always register OpenAI (needed for embeddings + fallback)
  providerConfig.openai = {
    options: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  };

  // Register Moonshot as OpenAI-compatible provider if API key is present
  if (moonshotKey) {
    providerConfig.moonshot = {
      api: "openai",
      options: {
        apiKey: moonshotKey,
        baseURL: "https://api.moonshot.ai/v1",
      },
      models: {
        "kimi-k2.5": {
          name: "Kimi K2.5 Preview",
          tool_call: true,
          attachment: false,
          reasoning: false,
          temperature: true,
          limit: {
            context: 131072,
            output: 8192,
          },
        },
      },
    };
  }

  // Determine active model in "provider/model" format
  const provider = config.model.provider;
  const model = config.model.model;
  const activeModel =
    provider !== "openai" && moonshotKey ? `${provider}/${model}` : `openai/${model}`;

  return {
    // Auto-share sessions for debugging
    share: "auto" as const,

    // Provider configuration
    provider: providerConfig,

    // Active model
    model: activeModel,

    // Default agent
    default_agent: "fern",

    // Custom agent definition — prompt.ts is the source of truth for prompt
    // composition; this is just a fallback for the OpenCode agent config.
    agent: {
      fern: {
        description: "Fern AI assistant with multi-channel support",
        prompt: "You are Fern, a helpful AI assistant.",
      },
    },

    // Tool configuration
    // Phase 1: Custom tools (echo, time) - complete
    // Phase 2: Built-in coding tools - ENABLED!
    tools: {
      bash: true,
      edit: true,
      write: true,
      read: true,
      grep: true,
      glob: true,
    },

    // Auto-approve all tool permissions (we're running as automated agent)
    permission: {
      skill: {
        "*": "allow" as const,
      },
      edit: "allow" as const,
      bash: "allow" as const,
      webfetch: "allow" as const,
      doom_loop: "allow" as const,
      external_directory: "allow" as const,
    },
  };
}

/**
 * Ensure the OpenCode server is running and return the client
 * Retries with different ports if initial port is in use
 */
export async function ensureOpenCode(): Promise<{
  url: string;
  port: number;
  client: OpenCodeClient;
}> {
  if (serverInfo) {
    return {
      url: serverInfo.url,
      port: serverInfo.port,
      client: serverInfo.client,
    };
  }

  // Set OPENCODE_CONFIG_DIR so OpenCode auto-discovers tools
  const toolDir = path.join(process.cwd(), "src", ".opencode", "tool");
  process.env.OPENCODE_CONFIG_DIR = path.join(process.cwd(), "src", ".opencode");

  // Check if tool directory exists
  if (fs.existsSync(toolDir)) {
    try {
      const _toolFiles = fs.readdirSync(toolDir);
    } catch (err) {
      console.error("[OpenCode] Failed to read tool directory:", err);
    }
  } else {
    console.warn(`[OpenCode] Tool directory NOT FOUND at ${toolDir}`);
  }

  const config = getOpenCodeConfig();
  const MAX_RETRIES = 100;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const port = findAvailablePort();
    usedPorts.add(port);

    try {
      const server = await createOpencodeServer({
        hostname: "127.0.0.1",
        port,
        timeout: 30000,
        config,
      });

      const client = createOpencodeClient({
        baseUrl: server.url,
      });

      serverInfo = { url: server.url, port, close: server.close, client };

      // Wait for tools to be available
      const waitForTools = async (): Promise<string[]> => {
        const maxAttempts = 10;
        const delayMs = 300;
        for (let i = 1; i <= maxAttempts; i++) {
          const result = await client.tool.ids();
          const tools = result.data ?? [];
          if (tools.length > 0) {
            return tools;
          }
          if (i < maxAttempts) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
        return [];
      };

      const tools = await waitForTools();
      if (tools.length > 0) {
      } else {
        console.error("[OpenCode] NO TOOLS after 10 attempts - check tool directory");
      }

      return { url: server.url, port, client };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[OpenCode] Failed to start on port ${port}: ${lastError.message}`);
      // Port is in use, try next one
    }
  }

  throw new Error(
    `Failed to start OpenCode server after ${MAX_RETRIES} attempts: ${lastError?.message}`
  );
}

/**
 * Get or create an OpenCode client
 */
export async function getClient(): Promise<OpenCodeClient> {
  const { client } = await ensureOpenCode();
  return client;
}

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

  // Check if we have an existing session for this thread
  cleanupStaleThreadSessions();
  if (threadId && threadSessions.has(threadId)) {
    const entry = threadSessions.get(threadId);
    if (entry) {
      return { sessionId: entry.sessionId, shareUrl: entry.shareUrl };
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
    if (shareUrl) {
    }
  } catch (shareError) {
    console.warn("[OpenCode] Failed to share session:", shareError);
  }

  // Store session for this thread with TTL tracking
  if (threadId) {
    threadSessions.set(threadId, {
      sessionId,
      shareUrl,
      createdAt: Date.now(),
    });
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

/**
 * Clean up and release resources
 */
export async function cleanup(): Promise<void> {
  if (serverInfo) {
    try {
      serverInfo.close();
      usedPorts.delete(serverInfo.port);
      serverInfo = null;
    } catch (error) {
      console.warn("[OpenCode] Error closing server:", error);
    }
  }
}
