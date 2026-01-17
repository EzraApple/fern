import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk";
import { logger } from "@/config/index.js";
import { DEFAULT_MODEL } from "@/constants/models.js";
import { MAX_TASK_DURATION_MS } from "@/constants/timeouts.js";
import { cacheGet, cacheSet, cacheDelete } from "@/services/cache.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Agent } from "undici";

/**
 * OpenCode Service
 *
 * Manages OpenCode client instances for AI agent tasks.
 * Each session runs in the context of a specific working directory.
 * Supports event streaming for real-time progress updates.
 */

// Type for the OpenCode client
type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

// Event types for progress tracking
export interface ProgressEvent {
  type: "tool_start" | "tool_complete" | "tool_error" | "text" | "thinking" | "session_status" | "session_idle" | "session_error";
  tool?: string;
  status?: string;
  message?: string;
  sessionId?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void | Promise<void>;

// Store server and client info (shared across directories)
let serverInfo: { url: string; port: number; close: () => void; client: OpenCodeClient } | null = null;

// Map thread IDs to session IDs for conversation continuity
// Note (Kevin, 2026-01-06): Added TTL to prevent unbounded growth
// Note (Kevin, 2026-01-06): Added shareUrl to return when reusing sessions
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
    logger.info(`[OpenCode] Cleaned up ${cleaned} stale thread sessions`);
  }
}

// Redis key prefix for external session mappings
const EXTERNAL_SESSION_PREFIX = "opencode:session:";

/**
 * Custom undici agent with extended timeouts for long-running OpenCode operations.
 * Note (Kevin, 2026-01-05): Default undici headersTimeout is 300s which causes
 * HeadersTimeoutError on slow OpenCode prompt responses. Extended to match task duration.
 */
const openCodeAgent = new Agent({
  headersTimeout: MAX_TASK_DURATION_MS,
  bodyTimeout: MAX_TASK_DURATION_MS,
});

/**
 * Custom fetch wrapper that logs HTTP requests/responses for debugging
 */
async function loggingFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const startTime = Date.now();
  const urlString = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? "GET";

  // Only log non-event endpoints to reduce noise
  const isEventStream = urlString.includes("/event/");
  if (!isEventStream) {
    logger.info(`[OpenCode] HTTP ${method} ${urlString}`);
  }

  try {
    // Use custom dispatcher with extended timeouts for long-running operations
    const response = await fetch(input, {
      ...init,
      // @ts-expect-error - undici dispatcher option is valid for Node.js native fetch
      dispatcher: openCodeAgent,
      timeout: false,
    });
    const elapsed = Date.now() - startTime;

    if (!isEventStream) {
      logger.info(`[OpenCode] HTTP ${response.status} in ${elapsed}ms: ${urlString}`);
    }

    // Note (Kevin, 2026-01-06): Log response body for 5xx errors to debug tool loading issues
    // Consolidates method, URL, and error body in single log entry for easier debugging
    if (response.status >= 500) {
      try {
        const clonedResponse = response.clone();
        const errorBody = await clonedResponse.text();
        const requestBody = init?.body ? String(init.body).slice(0, 500) : undefined;
        logger.error(`[OpenCode] HTTP ${response.status} ${method} ${urlString}`, {
          error: errorBody.slice(0, 1000),
          requestBody,
        });
      } catch {
        // Ignore if we can't read the body
      }
    }

    return response;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error(`[OpenCode] HTTP ERROR after ${elapsed}ms: ${urlString}`, error);
    throw error;
  }
}

/**
 * Clean up stale OpenCode storage from previous sessions.
 * Note (Kevin, 2026-01-06): OpenCode stores session data in ~/.local/share/opencode/storage/.
 * On Trigger.dev, containers can be reused (Checkpoint-Resume system), causing storage to accumulate.
 * This runs ONLY at startup before any session exists - safe because previous sessions are stale.
 */
function cleanupOpenCodeStorage(): void {
  const storagePath = path.join(os.homedir(), ".local", "share", "opencode", "storage");

  try {
    if (fs.existsSync(storagePath)) {
      const items = fs.readdirSync(storagePath);
      logger.info(`[OpenCode] Cleaning up storage: ${storagePath} (${items.length} items)`);
      fs.rmSync(storagePath, { recursive: true, force: true });
      logger.info(`[OpenCode] Storage cleanup complete`);
    }
  } catch (error) {
    logger.warn(`[OpenCode] Failed to clean storage:`, error);
  }
}

/**
 * Ensure the OpenCode server is running and return the client
 * Retries with different ports if the initial port is in use
 */
async function ensureOpenCode(): Promise<{ url: string; port: number; client: OpenCodeClient }> {
  if (serverInfo) {
    return { url: serverInfo.url, port: serverInfo.port, client: serverInfo.client };
  }

  // Note (Kevin, 2026-01-06): Clean up stale storage from previous Trigger.dev runs
  // Must happen before any session is created (serverInfo check above ensures this)
  cleanupOpenCodeStorage();

  // Note (Kevin, 2026-01-06): Set OPENCODE_CONFIG_DIR so OpenCode auto-discovers tools from our runtime directory
  // Tools are pre-bundled .js files in src/.opencode-runtime/tool/
  // Note (Kevin, 2026-01-08): In Trigger.dev production, additionalFiles strips ".." from paths,
  // so "src/.opencode-runtime" ends up at ".opencode-runtime" in the container root.
  // See: https://replohq.slack.com/archives/C08N6PJTK2Q/p1756405171439939
  const cwd = process.cwd();
  const isTriggerProduction = process.env.IS_TRIGGER && process.env.NODE_ENV === "production";
  const runtimeDir = path.join(
    cwd,
    isTriggerProduction ? "" : "src",
    ".opencode-runtime"
  );
  process.env.OPENCODE_CONFIG_DIR = runtimeDir;
  logger.info(`[OpenCode] Set OPENCODE_CONFIG_DIR to ${runtimeDir} (IS_TRIGGER=${process.env.IS_TRIGGER}, NODE_ENV=${process.env.NODE_ENV})`);


  const toolDir = path.join(runtimeDir, "tool");

  // Note (Kevin, 2026-01-06): Detailed file system diagnostics for tool loading
  // Check runtime tool directory (where OpenCode auto-discovers tools)
  if (fs.existsSync(toolDir)) {
    try {
      const toolFiles = fs.readdirSync(toolDir);
      logger.info(`[OpenCode] Runtime tool directory contents: ${toolFiles.join(", ")}`);
      logger.info(`[OpenCode] Tool count: ${toolFiles.filter(f => f.endsWith(".js")).length}`);
    } catch (err) {
      logger.error(`[OpenCode] Failed to read tool directory:`, err);
    }
  } else {
    logger.warn(`[OpenCode] Tool directory NOT FOUND at ${toolDir}`);
  }

  const config = getOpenCodeConfig();
  logger.info(`[OpenCode] Using config with agents: ${Object.keys(config.agent).join(", ")}`);
  // Note (Kevin, 2026-01-07): Try up to 100 different ports for more resilience
  const MAX_RETRIES = 100;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const port = findAvailablePort();
    usedPorts.add(port);

    logger.info(`[OpenCode] Starting server on port ${port} (attempt ${attempt + 1}/${MAX_RETRIES})...`);

    try {
      // Note (Kevin, 2026-01-06): Create server and client separately to pass custom fetch
      // with extended timeouts that prevent HeadersTimeoutError on long-running prompts
      const server = await createOpencodeServer({
        hostname: "127.0.0.1",
        port,
        timeout: 30000,
        config,
      });

      const client = createOpencodeClient({
        baseUrl: server.url,
        fetch: loggingFetch,
      });

      serverInfo = { url: server.url, port, close: server.close, client };
      logger.info(`[OpenCode] Server started at ${server.url}`);

      // Note (Kevin, 2026-01-05): Call /global/health to check server state
      try {
        const healthResponse = await loggingFetch(`${server.url}/global/health`);
        const healthData = await healthResponse.json();
        logger.info(`[OpenCode] Health check:`, JSON.stringify(healthData));
      } catch (err) {
        logger.error(`[OpenCode] Health check failed:`, err);
      }

      // Note (Kevin, 2026-01-06): Check MCP status after server starts for debugging
      try {
        const mcpStatus = await client.mcp.status();
        logger.info(`[OpenCode] MCP status:`, JSON.stringify(mcpStatus.data));
      } catch (err) {
        logger.warn(`[OpenCode] Failed to get MCP status:`, err);
      }

      // Note (Kevin, 2026-01-06): Wait for tools with retry - race condition fix
      const waitForTools = async (): Promise<string[]> => {
        const maxAttempts = 10;
        const delayMs = 300;
        for (let i = 1; i <= maxAttempts; i++) {
          const result = await client.tool.ids();
          const tools = result.data ?? [];
          if (tools.length > 0) {
            logger.info(`[OpenCode] Tools ready after ${i} attempt(s): ${tools.length} tools`);
            return tools;
          }
          if (i < maxAttempts) {
            logger.info(`[OpenCode] Waiting for tools (attempt ${i}/${maxAttempts})...`);
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
        return [];
      };

      const tools = await waitForTools();
      if (tools.length > 0) {
        logger.info(`[OpenCode] Tool names: ${tools.slice(0, 20).join(", ")}${tools.length > 20 ? "..." : ""}`);
      } else {
        logger.error(`[OpenCode] NO TOOLS after 10 attempts - will cause empty responses`);
      }

      return { url: server.url, port, client };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`[OpenCode] Failed to start on port ${port}: ${lastError.message}`);
      // Port is in use externally, mark it and try the next one
      // Keep it in usedPorts so we don't try it again
    }
  }

  throw new Error(`Failed to start OpenCode server after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}


/**
 * Get or create an OpenCode client
 */
export async function getClient(_cwd?: string): Promise<OpenCodeClient> {
  const { client } = await ensureOpenCode();
  return client;
}

// Port range for parallel agents
const PORT_START = 4096;
const PORT_END = 4300; // Note (Kevin, 2026-01-07): Expanded to support 100+ server restart attempts

/**
 * Load the replee agent system prompt
 */
function loadRepleePrompt(): string {
  // Default prompt if file not found
  const defaultPrompt = `# Replee Agent

You are Replee, an AI assistant for software teams.

## CRITICAL: Git/GitHub Operations

**NEVER use bash/shell for git or GitHub operations.** The repo_* tools handle everything including authentication.

NEVER DO THIS:
- bash: git clone ...
- bash: git push ...
- bash: gh pr create ...
- bash: ssh-keygen ...
- Trying to configure git credentials

ALWAYS USE THESE TOOLS:
- repo_setup_workspace - Clone and create branch (handles auth automatically)
- repo_commit_and_push - Commit and push changes
- repo_create_pr - Create pull request
- github_* tools - For PR reviews, comments, etc.

The repo tools use pre-configured GitHub tokens. You do NOT need to set up SSH keys, configure git, or handle authentication yourself.

## When to Clone the Repository

Only clone if you need to read/modify code. Don't clone for simple questions.

## How to Access Code

1. Call \`repo_setup_workspace\` with the repo URL and branch name
2. Get the workspace path from the response
3. Use ABSOLUTE paths for all file operations

### Example

\`\`\`
repo_setup_workspace({ repoUrl: "https://github.com/org/repo", branchName: "fix-bug" })
→ { workspace: "/tmp/replee-abc123" }

grep "login" /tmp/replee-abc123/
read /tmp/replee-abc123/src/auth/login.ts
\`\`\`

## Available Tools

### Repository
- \`repo_setup_workspace\` - Clone repo, returns workspace path
- \`repo_commit_and_push\` - Commit and push
- \`repo_create_pr\` - Create PR
- \`repo_cleanup_workspace\` - Clean up

### Code (use absolute paths)
- \`read\`, \`grep\`, \`glob\`, \`edit\`, \`bash\`

## Rules
- NEVER use bash for git operations - use repo_* tools
- Only clone if needed
- Use absolute paths with workspace
- Never guess - read actual code`;

  try {
    // Try to read from runtime directory first (production), then source directory (development)
    // Note (Kevin, 2026-01-08): In Trigger.dev production, additionalFiles strips ".." from paths,
    // so "src/.opencode-runtime" ends up at ".opencode-runtime" in the container root.
    const isTriggerProduction = process.env.IS_TRIGGER && process.env.NODE_ENV === "production";
    const runtimePath = path.join(
      process.cwd(),
      isTriggerProduction ? "" : "src",
      ".opencode-runtime",
      "agent",
      "replee.md"
    );
    const sourcePath = path.join(process.cwd(), "src", ".opencode", "agent", "replee.md");

    const promptPath = fs.existsSync(runtimePath) ? runtimePath : sourcePath;
    if (fs.existsSync(promptPath)) {
      const content = fs.readFileSync(promptPath, "utf-8");
      logger.info(`[OpenCode] Loaded replee agent prompt from ${promptPath}`);
      return content;
    }
  } catch (error) {
    logger.warn(`[OpenCode] Failed to load replee.md, using default prompt:`, error);
  }

  return defaultPrompt;
}

// Note (Kevin, 2026-01-06): Tools are now auto-discovered by OpenCode from ${OPENCODE_CONFIG_DIR}/tool/
// We set OPENCODE_CONFIG_DIR in ensureOpenCode() to point to src/.opencode-runtime/
// No need for plugin config or explicit tool paths

/**
 * OpenCode base configuration
 * Note (Kevin, 2026-01-06): Inlined from opencode.jsonc to avoid file parsing issues in Trigger.dev
 */
const OPENCODE_CONFIG = {
  // Auto-share all sessions so we can watch them
  share: "auto" as const,

  // Provider configuration - using OpenAI for initial setup
  provider: {
    openai: {
      options: {
        apiKey: process.env.OPENAI_API_KEY,
      },
    },
  },

  // Default agent for all requests
  default_agent: "replee",

  // Enable all built-in tools globally
  tools: {
    bash: true,
    edit: true,
    write: true,
    read: true,
    grep: true,
    glob: true,
    list: true,
    patch: true,
    todowrite: true,
    todoread: true,
    webfetch: true,
  },
};

/**
 * Get OpenCode configuration with our custom agent
 * Note (Kevin, 2026-01-06): Tools are auto-discovered from ${OPENCODE_CONFIG_DIR}/tool/
 * No need for plugin config - OpenCode finds .js files in the tool directory automatically
 */
function getOpenCodeConfig() {
  const repleePrompt = loadRepleePrompt();

  return {
    ...OPENCODE_CONFIG,

    model: DEFAULT_MODEL,

    // Custom agents
    agent: {
      replee: {
        description: "AI assistant that explores codebases and uses tools to answer questions",
        prompt: repleePrompt,
      },
      general: {
        description: "General purpose agent that explores codebases",
        prompt: repleePrompt,
      },
    },
    // Auto-approve all tool permissions (we're running as an automated agent)
    permission: {
      edit: "allow" as const,
      bash: "allow" as const,
      webfetch: "allow" as const,
      doom_loop: "allow" as const,
      external_directory: "allow" as const,
    },
  };
}

// Track which ports are currently in use by our agents
const usedPorts = new Set<number>();

/**
 * Find an available port for a new agent
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
 * Release the client and close the server
 * Note (Kevin, 2026-01-06): Also closes the Undici agent to release sockets
 */
export async function releaseClient(_cwd?: string): Promise<void> {
  if (serverInfo) {
    try {
      logger.info(`[OpenCode] Closing server on port ${serverInfo.port}...`);
      serverInfo.close();
      usedPorts.delete(serverInfo.port);
      serverInfo = null;

      // Close the Undici agent to release socket pool
      await openCodeAgent.close();
      logger.info(`[OpenCode] Server and agent closed`);
    } catch (error) {
      logger.warn(`[OpenCode] Error closing server/agent:`, error);
    }
  }
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
  cwd?: string;
  threadId?: string;  // Slack threadTs or Linear issueId
}): Promise<SessionInfo> {
  const { title, cwd, threadId } = options;

  // Check if we have an existing session for this thread
  // Run cleanup on each session lookup to prevent unbounded growth
  cleanupStaleThreadSessions();
  if (threadId && threadSessions.has(threadId)) {
    const entry = threadSessions.get(threadId)!;
    logger.info(`[OpenCode] Reusing existing session ${entry.sessionId} for thread ${threadId}`);
    return { sessionId: entry.sessionId, shareUrl: entry.shareUrl };
  }

  logger.info(`[OpenCode] Creating new session: title="${title ?? "none"}", threadId="${threadId ?? "none"}"`);

  // Note (Kevin, 2026-01-07): Retry session creation aggressively - each failure resets the server
  const MAX_RETRIES = 10;
  const SESSION_CREATE_TIMEOUT_MS = 30000; // 30 seconds to create a session

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = await getClient(cwd);

      // Wrap session.create with a timeout
      const createPromise = client.session.create({
        body: title ? { title } : undefined,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Session creation timed out after ${SESSION_CREATE_TIMEOUT_MS / 1000}s`)), SESSION_CREATE_TIMEOUT_MS);
      });

      const result = await Promise.race([createPromise, timeoutPromise]);
      const sessionId = result.data?.id ?? (result as unknown as { id?: string })?.id;

      if (!sessionId) {
        logger.error("[OpenCode] Session create returned no ID:", JSON.stringify(result));
        throw new Error("Failed to create OpenCode session - no ID returned");
      }

      // Share the session so we can watch it (do this before storing)
      // Note (Kevin, 2026-01-07): Retry sharing 10 times - if all fail, throw to trigger server restart
      let shareUrl: string | undefined;
      const SHARE_MAX_RETRIES = 10;
      const SHARE_RETRY_DELAY_MS = 1000;

      for (let shareAttempt = 1; shareAttempt <= SHARE_MAX_RETRIES; shareAttempt++) {
        try {
          const shareResult = await client.session.share({
            path: { id: sessionId },
          });
          shareUrl = shareResult.data?.share?.url;
          if (shareUrl) {
            logger.info(`[OpenCode] 🔗 Watch session: ${shareUrl}`);
            break;
          }
          logger.warn(`[OpenCode] session.share() returned no URL (attempt ${shareAttempt}/${SHARE_MAX_RETRIES})`);
        } catch (shareError) {
          logger.warn(`[OpenCode] Failed to share session (attempt ${shareAttempt}/${SHARE_MAX_RETRIES}):`, shareError);
        }

        if (shareAttempt < SHARE_MAX_RETRIES) {
          await new Promise(r => setTimeout(r, SHARE_RETRY_DELAY_MS));
        }
      }

      if (!shareUrl) {
        // Note (Kevin, 2026-01-07): If we can't get shareUrl after 10 attempts, throw to trigger server restart
        throw new Error(`Could not get shareUrl after ${SHARE_MAX_RETRIES} attempts - server may be unhealthy`);
      }

      // Store session for this thread with TTL tracking (include shareUrl)
      if (threadId) {
        threadSessions.set(threadId, { sessionId, shareUrl, createdAt: Date.now() });
        logger.info(`[OpenCode] Mapped thread ${threadId} -> session ${sessionId}`);
      }

      return { sessionId, shareUrl };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[OpenCode] Session create failed (attempt ${attempt}/${MAX_RETRIES}): ${errorMsg}`);

      if (attempt < MAX_RETRIES) {
        // Reset the server and retry
        logger.info(`[OpenCode] Resetting server and retrying in 2s...`);
        resetClient();
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw new Error(`Failed to create OpenCode session after ${MAX_RETRIES} attempts: ${errorMsg}`);
      }
    }
  }

  // This should never be reached but TypeScript needs it
  throw new Error("Failed to create OpenCode session");
}

/**
 * Create a new session (legacy, prefer getOrCreateSession)
 */
export async function createSession(title?: string, cwd?: string): Promise<string> {
  const { sessionId } = await getOrCreateSession({ title, cwd });
  return sessionId;
}

/**
 * Get the last assistant response text from a session
 * Note (Kevin, 2026-01-06): Fetches messages after session completes instead of accumulating
 * during streaming to reduce memory usage on Trigger.dev
 */
export async function getLastAssistantResponse(sessionId: string, cwd?: string): Promise<string> {
  const client = await getClient(cwd);

  try {
    const result = await client.session.messages({
      path: { id: sessionId },
    });

    const messages = result.data ?? [];
    // Find the last assistant message and extract text parts
    // Note: messages response is Array<{ info: Message; parts: Part[] }>
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.info.role === "assistant" && msg.parts) {
        const textParts: string[] = [];
        for (const part of msg.parts) {
          if (part.type === "text" && "text" in part && typeof part.text === "string") {
            textParts.push(part.text);
          }
        }
        if (textParts.length > 0) {
          const response = textParts.join("");
          logger.info(`[OpenCode] Got last assistant response (${response.length} chars)`);
          return response;
        }
      }
    }

    logger.warn(`[OpenCode] No assistant response found in session ${sessionId}`);
    return "";
  } catch (error) {
    logger.error(`[OpenCode] Failed to get messages for session ${sessionId}:`, error);
    return "";
  }
}

/**
 * Delete a session and remove from thread mapping
 */
export async function deleteSession(sessionId: string, cwd?: string): Promise<void> {
  const client = await getClient(cwd);

  try {
    await client.session.delete({
      path: { id: sessionId },
    });
    logger.info(`[OpenCode] Deleted session ${sessionId}`);

    // Remove from thread mapping
    for (const [threadId, entry] of threadSessions.entries()) {
      if (entry.sessionId === sessionId) {
        threadSessions.delete(threadId);
        logger.info(`[OpenCode] Removed thread mapping for ${threadId}`);
        break;
      }
    }

    // Note: External session mappings are cleaned up via Redis TTL or explicit cleanup
  } catch (error) {
    logger.warn(`[OpenCode] Failed to delete session ${sessionId}:`, error);
  }
}

/**
 * Link an external ID (e.g., Linear agentSessionId) to an OpenCode session
 * This allows cancellation from external triggers
 * Stored in Redis with 1 hour TTL (sessions shouldn't run longer)
 */
export async function linkExternalSession(externalId: string, openCodeSessionId: string): Promise<void> {
  const key = `${EXTERNAL_SESSION_PREFIX}${externalId}`;
  await cacheSet(key, openCodeSessionId, 3600); // 1 hour TTL
  logger.info(`[OpenCode] Linked external ${externalId} -> OpenCode session ${openCodeSessionId}`);
}

/**
 * Cancel a session by its external ID (e.g., Linear agentSessionId)
 * This forcibly stops the running agent
 * 
 * Note (Replee, 2026-01-14, REPL-22293): We no longer delete sessions from OpenCode server
 * when cancelling. This preserves share links so users can view what happened before cancellation.
 * The session.abort() API will stop execution without deleting session data.
 */
export async function cancelByExternalId(externalId: string): Promise<boolean> {
  const key = `${EXTERNAL_SESSION_PREFIX}${externalId}`;
  const sessionId = await cacheGet<string>(key);

  if (!sessionId) {
    logger.warn(`[OpenCode] No session found for external ID: ${externalId}`);
    return false;
  }

  logger.info(`[OpenCode] Cancelling session ${sessionId} (external: ${externalId})`);

  try {
    // Signal error to break out of any waiting prompts
    signalSessionError(sessionId, "Session cancelled by user");

    // Note (Replee, 2026-01-14, REPL-22293): Do NOT delete the session from OpenCode server.
    // This was causing share links to immediately stop working when sessions were cancelled.
    // OpenCode's servers will handle cleanup/expiration of old sessions automatically.
    // The signalSessionError above will break out of any waiting operations.
    // await deleteSession(sessionId);

    // Clean up the Redis mapping
    await cacheDelete(key);

    logger.info(`[OpenCode] Successfully cancelled session ${sessionId} (session preserved for share link)`);
    return true;
  } catch (error) {
    logger.error(`[OpenCode] Failed to cancel session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Get the OpenCode session ID for an external ID
 */
export async function getSessionByExternalId(externalId: string): Promise<string | null> {
  const key = `${EXTERNAL_SESSION_PREFIX}${externalId}`;
  return cacheGet<string>(key);
}

/**
 * Clean up the external session mapping (call when session completes normally)
 */
export async function unlinkExternalSession(externalId: string): Promise<void> {
  const key = `${EXTERNAL_SESSION_PREFIX}${externalId}`;
  await cacheDelete(key);
  logger.info(`[OpenCode] Unlinked external session ${externalId}`);
}

// Track completion promises for sessions
const sessionCompletionCallbacks = new Map<
  string,
  { resolve: () => void; reject: (err: Error) => void; timeoutHandle: NodeJS.Timeout }
>();

// Track whether a session has received any activity events (tool calls, text, etc.)
// Used to determine if a prompt was accepted before timeout
const sessionActivityFlags = new Map<string, boolean>();

/**
 * Mark a session as having received activity (called from event handler)
 */
export function markSessionActivity(sessionId: string): void {
  sessionActivityFlags.set(sessionId, true);
}

/**
 * Check if a session has received any activity events
 */
export function hasSessionActivity(sessionId: string): boolean {
  return sessionActivityFlags.get(sessionId) ?? false;
}

/**
 * Clear session activity flag (called when session completes or is cleaned up)
 */
export function clearSessionActivity(sessionId: string): void {
  sessionActivityFlags.delete(sessionId);
}

/**
 * Pre-register a completion callback for a session
 * Call this BEFORE setting promptSent to avoid race conditions
 * Returns a promise that resolves when the session completes
 */
export function registerCompletionCallback(sessionId: string, timeoutMs: number = MAX_TASK_DURATION_MS): Promise<void> {
  logger.info(`[OpenCode] Pre-registering completion callback for session ${sessionId}`);
  return new Promise<void>((resolve, reject) => {
    // Set timeout and store handle for cleanup
    const timeoutHandle = setTimeout(() => {
      if (sessionCompletionCallbacks.has(sessionId)) {
        const timeoutHours = (timeoutMs / 1000 / 60 / 60).toFixed(1);
        logger.error(`[OpenCode] Session ${sessionId} timed out after ${timeoutHours}h - callback was never resolved (no session.idle event received)`);
        sessionCompletionCallbacks.delete(sessionId);
        reject(new Error(`OpenCode prompt timed out after ${timeoutHours} hours - session never became idle`));
      }
    }, timeoutMs);

    sessionCompletionCallbacks.set(sessionId, { resolve, reject, timeoutHandle });
  });
}

/**
 * Signal that a session has completed (called from event handler)
 */
export function signalSessionComplete(sessionId: string): void {
  const callback = sessionCompletionCallbacks.get(sessionId);
  if (callback) {
    logger.info(`[OpenCode] Session ${sessionId} signaled complete - resolving promise`);
    clearTimeout(callback.timeoutHandle);
    callback.resolve();
    sessionCompletionCallbacks.delete(sessionId);
    clearSessionActivity(sessionId);
  } else {
    logger.warn(`[OpenCode] Session ${sessionId} signaled complete but NO callback registered (race condition?)`);
  }
}

/**
 * Signal that a session has an error (called from event handler)
 */
export function signalSessionError(sessionId: string, error: string): void {
  const callback = sessionCompletionCallbacks.get(sessionId);
  if (callback) {
    logger.info(`[OpenCode] Session ${sessionId} signaled error: ${error}`);
    clearTimeout(callback.timeoutHandle);
    callback.reject(new Error(error));
    sessionCompletionCallbacks.delete(sessionId);
    clearSessionActivity(sessionId);
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
    images?: { base64: string; mediaType: string }[];
    files?: { uri: string; mimeType: string }[];  // Gemini FileManager URIs for videos
    cwd?: string;
    agent?: string;  // Specify which agent to use (e.g., "build", "plan", "replee")
    system?: string; // Override system prompt
    model?: {        // Override model for this prompt
      provider: string;  // e.g., "anthropic", "openai"
      model: string;     // e.g., "claude-sonnet-4-5", "gpt-4o"
    };
  }
): Promise<void> {
  logger.info(`[OpenCode] Sending prompt to session ${sessionId} (${text.slice(0, 50)}...)`);

  const client = await getClient(options?.cwd);

  // Build parts array using OpenCode's FilePartInput format for images
  // Note (Kevin, 2026-01-04): OpenCode uses FilePartInput with data URLs, not Claude's inline base64 format
  const parts: { type: string; text?: string; mime?: string; url?: string; filename?: string }[] = [];

  // Add images first if provided (as FilePartInput with data URLs)
  if (options?.images) {
    for (let i = 0; i < options.images.length; i++) {
      const img = options.images[i];
      // Convert base64 to data URL format
      const dataUrl = `data:${img.mediaType};base64,${img.base64}`;
      parts.push({
        type: "file",
        mime: img.mediaType,
        url: dataUrl,
        filename: `image_${i + 1}.${img.mediaType.split("/")[1] ?? "png"}`,
      });
    }
    logger.info(`[OpenCode] Including ${options.images.length} images as FilePartInput`);
  }

  // Add Gemini file references (for videos uploaded to FileManager)
  if (options?.files) {
    for (let i = 0; i < options.files.length; i++) {
      const file = options.files[i];
      parts.push({
        type: "file",
        mime: file.mimeType,
        url: file.uri,
        filename: `video_${i + 1}.${file.mimeType.split("/")[1] ?? "mp4"}`,
      });
    }
    logger.info(`[OpenCode] Including ${options.files.length} Gemini file references`);
  }

  // Add text prompt
  parts.push({ type: "text", text });

  // Use "build" agent by default for tool usage, or custom agent if specified
  const agentToUse = options?.agent ?? "build";
  const modelToUse = options?.model;
  logger.info(`[OpenCode] Calling session.prompt() with agent: ${agentToUse}, model: ${modelToUse ? `${modelToUse.provider}/${modelToUse.model}` : "default"}...`);
  const startTime = Date.now();

  // Match Trigger.dev maxDuration
  const PROMPT_TIMEOUT_MS = MAX_TASK_DURATION_MS;

  // Check if callback was pre-registered, otherwise create one now
  let completionPromise: Promise<void>;
  if (sessionCompletionCallbacks.has(sessionId)) {
    logger.info(`[OpenCode] Using pre-registered completion callback for session ${sessionId}`);
    // The promise was already created by registerCompletionCallback
    // We need to create a new promise that waits for the same resolution
    completionPromise = new Promise<void>((resolve, reject) => {
      const existingCallback = sessionCompletionCallbacks.get(sessionId)!;
      const originalResolve = existingCallback.resolve;
      const originalReject = existingCallback.reject;
      existingCallback.resolve = () => {
        originalResolve();
        resolve();
      };
      existingCallback.reject = (err: Error) => {
        originalReject(err);
        reject(err);
      };
    });
  } else {
    // Create completion promise (legacy path)
    completionPromise = new Promise<void>((resolve, reject) => {
      logger.info(`[OpenCode] Registering completion callback for session ${sessionId}`);

      // Set timeout and store handle for cleanup
      const timeoutHandle = setTimeout(() => {
        if (sessionCompletionCallbacks.has(sessionId)) {
          logger.error(`[OpenCode] Session ${sessionId} timed out after ${PROMPT_TIMEOUT_MS / 1000}s - callback was never resolved`);
          sessionCompletionCallbacks.delete(sessionId);
          reject(new Error(`OpenCode prompt timed out after ${PROMPT_TIMEOUT_MS / 1000}s`));
        }
      }, PROMPT_TIMEOUT_MS);

      sessionCompletionCallbacks.set(sessionId, { resolve, reject, timeoutHandle });
    });
  }

  // Note (Kevin, 2026-01-08): Clear activity flag at start to track this specific prompt
  clearSessionActivity(sessionId);

  try {
    // Submit the prompt
    logger.info(`[OpenCode] Submitting prompt with ${parts.length} parts: ${parts.map(p => p.type).join(", ")}`);
    const promptResponse = await client.session.prompt({
      path: { id: sessionId },
      body: {
        // Cast to SDK types - parts can be TextPartInput or FilePartInput
        parts: parts as Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }>,
        agent: agentToUse,
        system: options?.system,
        model: modelToUse ? { providerID: modelToUse.provider, modelID: modelToUse.model } : undefined,
      },
    });
    logger.info(`[OpenCode] Prompt API response: ${JSON.stringify(promptResponse.data ?? promptResponse).slice(0, 500)}`);
    logger.info(`[OpenCode] Prompt submitted, waiting for session.idle event...`);

    // Wait for completion (signaled by event handler when session.idle is received)
    await completionPromise;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[OpenCode] Prompt completed in ${elapsed}s`);
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.error(`[OpenCode] Prompt failed after ${elapsed}s:`, error);
    sessionCompletionCallbacks.delete(sessionId);
    clearSessionActivity(sessionId);
    throw error;
  }
}

/**
 * Health check - verify OpenCode is available
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const client = await getClient();
    await client.session.list();
    return true;
  } catch (error) {
    logger.error("[OpenCode] Health check failed:", error);
    return false;
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
    // Note (Kevin, 2026-01-06): Log full error details for debugging tool loading issues
    const errorDetails = error instanceof Error ? {
      message: error.message,
      name: error.name,
      stack: error.stack?.split("\n").slice(0, 5).join("\n"),
      // Try to extract response body if it's a fetch error
      response: (error as { response?: { status?: number; body?: unknown } }).response,
    } : error;
    logger.error("[OpenCode] Tool list failed with details:", JSON.stringify(errorDetails, null, 2));
    return [];
  }
}

/**
 * Reset server/client (for testing or reconnection)
 */
export function resetClient(): void {
  if (serverInfo) {
    try {
      serverInfo.close();
      usedPorts.delete(serverInfo.port);
    } catch {
      // Ignore close errors
    }
    serverInfo = null;
  }
  logger.info("[OpenCode] Client reset");
}

/**
 * Subscribe to real-time events from OpenCode
 * Returns an unsubscribe function
 */
export async function subscribeToEvents(
  sessionId: string,
  callback: ProgressCallback,
  cwd?: string
): Promise<() => void> {
  const client = await getClient(cwd);
  let aborted = false;
  let receivedSessionIdle = false;
  // Note (Kevin, 2026-01-06): Track stream reference for proper cleanup
  let eventsStream: AsyncIterable<unknown> | null = null;

  // Start listening to real-time events in the background
  (async () => {
    try {
      logger.info(`[OpenCode] Starting event subscription for session ${sessionId}...`);
      const events = await client.event.subscribe();
      eventsStream = events.stream;
      logger.info(`[OpenCode] Event stream started, waiting for events...`);

      let eventCount = 0;
      for await (const event of events.stream) {
        if (aborted) break;
        eventCount++;
        const eventType = (event as Record<string, unknown>).type as string;

        // Log ALL events to debug what's coming through
        if (eventCount <= 5 || eventType === "session.idle" || eventType === "session.error") {
          logger.info(`[OpenCode] Event #${eventCount}: ${eventType}`);
        } else if (eventCount % 50 === 0) {
          logger.info(`[OpenCode] Event stream alive, ${eventCount} events received so far...`);
        }

        try {
          // Filter events for our session
          const eventSessionId = getSessionIdFromEvent(event);

          // Note (Kevin, 2026-01-06): Only log critical session events to reduce noise
          // Skip verbose events like message.part.updated, message.updated, session.status, session.diff
          if (eventType === "session.idle" || eventType === "session.error") {
            logger.info(`[OpenCode] Session event: ${eventType} (eventSessionId=${eventSessionId ?? "none"}, expected=${sessionId})`);
          }

          // Note (Kevin, 2026-01-08, REPL-21680): Stricter session filtering to prevent cross-talk
          // For critical events (session.idle, session.error), we MUST have a matching session ID
          // These events control completion and error handling - wrong attribution causes bugs
          const isCriticalEvent = eventType === "session.idle" || eventType === "session.error";
          if (isCriticalEvent && !eventSessionId) {
            logger.warn(`[OpenCode] Filtering out ${eventType} with no session ID (could belong to different session)`);
            continue;
          }

          if (eventSessionId && eventSessionId !== sessionId) {
            // Note (Kevin, 2026-01-06): Only log filtered critical events, skip verbose message.* events
            if (isCriticalEvent) {
              logger.info(`[OpenCode] Filtering out ${eventType} for different session: ${eventSessionId} (wanted ${sessionId})`);
            }
            continue;
          }

          // Auto-approve permission requests (we're an automated agent)
          if (eventType === "permission.updated") {
            const props = (event as Record<string, unknown>).properties as Record<string, unknown>;
            const permissionID = props?.id as string;
            if (permissionID) {
              try {
                await client.postSessionIdPermissionsPermissionId({
                  path: { id: sessionId, permissionID },
                  body: { response: "always" },
                });
              } catch (permErr) {
                logger.warn(`[OpenCode] Failed to approve permission:`, permErr);
              }
            }
          }

          // Map event types to progress events
          const progressEvent = mapToProgressEvent(event, sessionId);
          if (progressEvent) {
            // Note (Kevin, 2026-01-08): Mark session as active when we receive work events
            // This is used to detect if a prompt was accepted before HTTP timeout
            if (progressEvent.type === "tool_start" || progressEvent.type === "tool_complete" ||
                progressEvent.type === "text" || progressEvent.type === "thinking") {
              markSessionActivity(sessionId);
            }

            await callback(progressEvent);

            // Note (Kevin, 2026-01-07): Track session_idle for stream end detection only
            // The actual signalSessionComplete call is handled by the chat-agent callback
            // to avoid race conditions with stale idle events before prompt is sent
            if (progressEvent.type === "session_idle") {
              receivedSessionIdle = true;
            }
          }
        } catch (error) {
          logger.error("[OpenCode] Error processing event:", error);
        }
      }
      logger.info(`[OpenCode] Event stream ended after ${eventCount} events`);

      // Note (Kevin, 2026-01-06): Signal error if stream ended without session.idle
      // This prevents hanging when OpenCode is killed (e.g., OOM) before completing
      if (!aborted && !receivedSessionIdle) {
        logger.error(`[OpenCode] Event stream ended without session.idle for session ${sessionId}`);
        signalSessionError(sessionId, "Session ended unexpectedly - the task may have run out of memory. Retrying...");
      }
    } catch (error) {
      if (!aborted) {
        logger.error("[OpenCode] Event stream error:", error);
        // Note (Kevin, 2026-01-06): Also signal error on stream exception
        signalSessionError(sessionId, "Connection to OpenCode was interrupted. Retrying...");
      }
    }
  })();

  logger.info(`[OpenCode] Subscribed to events for session ${sessionId}`);

  // Return unsubscribe function
  return () => {
    aborted = true;
    // Note (Kevin, 2026-01-06): Close the async iterator if it supports it
    // This prevents connection/buffer leaks from orphaned streams
    const streamWithReturn = eventsStream as unknown as { return?: () => void } | null;
    if (streamWithReturn && typeof streamWithReturn.return === "function") {
      streamWithReturn.return();
    }
    logger.info(`[OpenCode] Unsubscribed from events for session ${sessionId}`);
  };
}

/**
 * Extract session ID from an event
 * Events have structure: { type: string, properties: { ... } }
 */
function getSessionIdFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  const eventType = e.type as string;
  const props = e.properties as Record<string, unknown> | undefined;

  if (!props) {
    // Log if this is an important event without properties
    if (eventType === "session.idle" || eventType === "session.error") {
      logger.info(`[OpenCode] ${eventType} event has no properties`);
    }
    return null;
  }

  // Direct sessionID in properties
  if (props.sessionID) return String(props.sessionID);

  // Also check for session_id (snake_case variant)
  if (props.session_id) return String(props.session_id);

  // SessionID in part
  if (props.part && typeof props.part === "object") {
    const part = props.part as Record<string, unknown>;
    if (part.sessionID) return String(part.sessionID);
    if (part.session_id) return String(part.session_id);
  }

  // Log if this is an important event without a session ID
  if (eventType === "session.idle" || eventType === "session.error") {
    logger.info(`[OpenCode] ${eventType} event has properties but no session ID: ${JSON.stringify(Object.keys(props))}`);
  }

  return null;
}

/**
 * Map OpenCode event to our ProgressEvent type
 * Events have structure: { type: string, properties: { ... } }
 */
function mapToProgressEvent(event: unknown, sessionId: string): ProgressEvent | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  const type = e.type as string;
  const props = e.properties as Record<string, unknown> | undefined;

  switch (type) {
    case "message.part.updated": {
      const part = props?.part as Record<string, unknown>;
      if (!part) return null;

      const partType = part.type as string;

      if (partType === "tool") {
        const state = part.state as Record<string, unknown>;
        const stateType = state?.type as string;
        const toolName = part.tool as string;

        if (stateType === "running") {
          return {
            type: "tool_start",
            tool: toolName,
            sessionId,
            message: `Using ${toolName}...`,
          };
        }
        if (stateType === "completed") {
          return {
            type: "tool_complete",
            tool: toolName,
            sessionId,
            message: `Completed ${toolName}`,
          };
        }
        if (stateType === "error") {
          return {
            type: "tool_error",
            tool: toolName,
            sessionId,
            message: `Error in ${toolName}`,
          };
        }
      }

      if (partType === "text") {
        const delta = props?.delta as string;
        if (delta) {
          return {
            type: "text",
            sessionId,
            message: delta,
          };
        }
      }

      if (partType === "reasoning") {
        const delta = props?.delta as string;
        if (delta) {
          return {
            type: "thinking",
            sessionId,
            message: delta,
          };
        }
      }
      break;
    }

    case "session.status": {
      return {
        type: "session_status",
        status: props?.status as string,
        sessionId,
      };
    }

    case "session.idle": {
      // Check if the idle event has a session ID in properties (check both camelCase and snake_case)
      const idleSessionId = (props?.sessionID ?? props?.session_id) as string | undefined;
      logger.info(`[OpenCode] Received session.idle event (idleSessionId=${idleSessionId ?? "none"}, targetSessionId=${sessionId})`);
      // Note (Kevin, 2026-01-08, REPL-21680): ONLY process if session ID is specified AND matches
      // Previously, events without a session ID were attributed to the current session, which
      // caused cross-talk between concurrent sessions (user could receive another session's response)
      if (!idleSessionId) {
        logger.warn(`[OpenCode] Ignoring session.idle with no session ID (could belong to different session)`);
        return null;
      }
      if (idleSessionId !== sessionId) {
        logger.info(`[OpenCode] Ignoring session.idle for different session: ${idleSessionId}`);
        return null;
      }
      return {
        type: "session_idle",
        sessionId: idleSessionId,
        message: "Session completed",
      };
    }

    case "session.error": {
      // Note (Kevin, 2026-01-08, REPL-21680): Check session ID to prevent cross-session error attribution
      const errorSessionId = (props?.sessionID ?? props?.session_id) as string | undefined;
      if (!errorSessionId) {
        logger.warn(`[OpenCode] Ignoring session.error with no session ID`);
        return null;
      }
      if (errorSessionId !== sessionId) {
        logger.info(`[OpenCode] Ignoring session.error for different session: ${errorSessionId}`);
        return null;
      }
      return {
        type: "session_error",
        sessionId: errorSessionId,
        message: (props?.error as string) ?? "Unknown error",
      };
    }
  }

  return null;
}

/**
 * Task definition for parallel execution
 */
export interface ParallelTask {
  prompt: string;
  title?: string;
  model?: {
    provider: string;  // e.g., "anthropic", "openai"
    model: string;     // e.g., "claude-sonnet-4-5", "gpt-4o"
  };
  agent?: string;
  system?: string;
}

/**
 * Result from parallel execution
 */
export interface ParallelResult {
  sessionId: string;
  response: string;
  error?: string;
}

/**
 * Run multiple sessions in parallel with different models
 *
 * Example usage:
 * ```typescript
 * const results = await runParallel([
 *   { prompt: "Analyze the auth code", model: { provider: "anthropic", model: "claude-sonnet-4-5" } },
 *   { prompt: "Review the tests", model: { provider: "openai", model: "gpt-4o" } },
 *   { prompt: "Check for security issues", model: { provider: "anthropic", model: "claude-opus-4" } },
 * ]);
 * ```
 */
export async function runParallel(tasks: ParallelTask[]): Promise<ParallelResult[]> {
  logger.info(`[OpenCode] Running ${tasks.length} tasks in parallel`);

  const results = await Promise.all(
    tasks.map(async (task, index) => {
      const { sessionId } = await getOrCreateSession({
        title: task.title ?? `Parallel task ${index + 1}`
      });

      let response = "";
      let error: string | undefined;

      try {
        // Subscribe to capture response
        const unsubscribe = await subscribeToEvents(sessionId, (event) => {
          if (event.type === "text" && event.message) {
            response += event.message;
          }
        });

        // Run the prompt with the specified model
        await prompt(sessionId, task.prompt, {
          agent: task.agent ?? "replee",
          system: task.system,
          model: task.model,
        });

        unsubscribe();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        logger.error(`[OpenCode] Task ${index + 1} failed:`, err);
      }

      return { sessionId, response, error };
    })
  );

  logger.info(`[OpenCode] Parallel execution complete: ${results.filter(r => !r.error).length}/${tasks.length} succeeded`);
  return results;
}

// Re-export models for backward compatibility
export { DEFAULT_MODEL } from "@/constants/models.js";
