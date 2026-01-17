import { opencode } from "@/services/integrations/index.js";
import { logger, logMemoryUsage, tryGarbageCollect } from "@/config/index.js";
import type { ProgressEvent } from "@/services/integrations/opencode.js";
import { signalSessionComplete, linkExternalSession, unlinkExternalSession, registerCompletionCallback, getLastAssistantResponse } from "@/services/integrations/opencode.js";
import { StatusThrottler } from "./utils/status-throttler.js";

import type { ProgressHandler, ChatSource } from "./handlers/types.js";
import { createGitHubHandler } from "./handlers/github-handler.js";
import { getSystemPrompt } from "./prompts/system-prompt.js";
import { buildPrompt } from "./prompts/platform-prompts.js";

/**
 * Chat Agent
 *
 * A conversational agent for handling GitHub interactions.
 * Uses OpenCode with custom tools to handle requests.
 */

export interface ChatAgentInput {
  message: string;
  source: ChatSource;
  context?: string;
}

export interface ChatAgentResult {
  success: boolean;
  sessionId: string;
  error?: string;
}

/**
 * Create a progress handler for the given source platform.
 */
function createProgressHandler({
  source,
  getSessionId,
}: {
  source: ChatSource;
  getSessionId?: () => string | undefined;
}): ProgressHandler {
  logger.info(`[ChatAgent] Creating progress handler for ${source.type}`);

  if (source.type === "github" && source.repo && source.prNumber) {
    return createGitHubHandler({
      repo: source.repo,
      prNumber: source.prNumber,
      sourceCommentId: source.commentId,
      isReviewComment: !!source.filePath,
      mentionUser: source.userId,
    });
  }

  return {
    setShareUrl: () => {},
    sendThought: async () => {},
    sendResponse: async () => {},
    sendError: async () => {},
    updateDescription: async () => {},
  };
}


/**
 * Run the chat agent.
 *
 * @param input - The input containing message, source, and optional context
 * @returns Result with success status and session ID
 */
export async function runChatAgent(input: ChatAgentInput): Promise<ChatAgentResult> {
  const { message, source, context } = input;

  logMemoryUsage("ChatAgent start");
  logger.info(`[ChatAgent] Running for ${source.type}: ${message.slice(0, 50)}...`);

  let currentSessionId: string | undefined;
  const getSessionId = () => currentSessionId;

  const progressHandler = createProgressHandler({ source, getSessionId });
  let unsubscribe: (() => void) | null = null;

  const statusThrottler = new StatusThrottler({
    minIntervalMs: 1500,
    onFlush: async (status) => {
      await progressHandler.sendThought(status);
    },
  });

  const branchName = source.issueIdentifier
    ? `${source.issueIdentifier.toLowerCase()}/fix`
    : "jarvis/fix";

  try {
    const threadId = source.threadTs ?? source.issueId ?? undefined;
    const { sessionId, shareUrl } = await opencode.getOrCreateSession({
      title: `${source.type}: ${message.slice(0, 30)}`,
      threadId,
    });
    currentSessionId = sessionId;
    logger.info(`[ChatAgent] Session ${sessionId} created`);

    if (shareUrl) {
      progressHandler.setShareUrl(shareUrl);
    }
    await progressHandler.sendThought("Starting...");

    logger.info(`[ChatAgent] Listing tools...`);
    const listToolsStart = Date.now();
    const allTools = await opencode.listTools();
    logger.info(`[ChatAgent] Listed ${allTools.length} tools in ${Date.now() - listToolsStart}ms`);

    const githubTools = allTools.filter(t => t.startsWith("github_") || t.startsWith("repo_"));
    logger.info(`[ChatAgent] GitHub tools available: ${githubTools.length}`);

    let sawActivity = false;
    let promptSent = false;

    logger.info(`[ChatAgent] Subscribing to events for session ${sessionId}...`);
    const subscribeStart = Date.now();
    unsubscribe = await opencode.subscribeToEvents(sessionId, async (event: ProgressEvent) => {
      try {
        if (event.type === "tool_start") {
          sawActivity = true;
          statusThrottler.flush();
          await progressHandler.sendThought(`Using ${event.tool ?? "tool"}...`);
        } else if (event.type === "tool_error") {
          statusThrottler.flush();
          await progressHandler.sendThought(`Error: ${event.tool ?? "unknown"}`);
        } else if (event.type === "text") {
          sawActivity = true;
          if (event.message) {
            statusThrottler.appendText(event.message);
          }
        } else if (event.type === "thinking") {
          sawActivity = true;
          if (event.message) {
            statusThrottler.appendThinking(event.message);
          }
        } else if (event.type === "session_idle") {
          logger.info(`[ChatAgent] Received session_idle event (promptSent=${promptSent}, sawActivity=${sawActivity})`);
          if (!promptSent) {
            logger.info(`[ChatAgent] Ignoring idle event before prompt was sent`);
            return;
          }
          statusThrottler.flush();
          if (sawActivity) {
            logger.info(`[ChatAgent] Calling signalSessionComplete for session ${sessionId}`);
            signalSessionComplete(sessionId);
          } else {
            logger.warn(`[ChatAgent] Session idle without activity - prompt may have failed`);
            signalSessionComplete(sessionId);
          }
        } else if (event.type === "session_error") {
          statusThrottler.flush();
          logger.error(`[ChatAgent] Session error: ${event.message}`);
          await progressHandler.sendError(event.message ?? "Unknown error");
        }
      } catch (err) {
        logger.warn(`[ChatAgent] Error in event handler:`, err);
      }
    });
    logger.info(`[ChatAgent] Subscribed to events in ${Date.now() - subscribeStart}ms`);

    logger.info(`[ChatAgent] Waiting 100ms for event stream to stabilize...`);
    await new Promise(resolve => setTimeout(resolve, 100));
    logger.info(`[ChatAgent] Wait complete, proceeding to send prompt`);

    const prompt = buildPrompt({
      message,
      source,
      context: context ?? "",
      tools: { githubTools, branchName },
    });

    logger.info(`[ChatAgent] Sending prompt (${prompt.length} chars) to OpenCode...`);

    registerCompletionCallback(sessionId);
    promptSent = true;

    const promptStart = Date.now();
    await opencode.prompt(sessionId, prompt, {
      agent: "replee",
      system: getSystemPrompt({}),
    });
    logger.info(`[ChatAgent] Prompt completed in ${Date.now() - promptStart}ms`);

    const responseText = await getLastAssistantResponse(sessionId);

    if (responseText.trim()) {
      const noResponseMarkers = ["[NO_RESPONSE]", "[SKIP]", "[NO RESPONSE NEEDED]"];
      const shouldSkipResponse = noResponseMarkers.some(marker =>
        responseText.toUpperCase().includes(marker)
      );

      const reactMatch = responseText.match(/\[REACT:([^\]]+)\]/i);

      if (shouldSkipResponse) {
        logger.info(`[ChatAgent] Agent decided no response needed`);
      } else if (reactMatch && progressHandler.addReaction) {
        const emoji = reactMatch[1].trim();
        logger.info(`[ChatAgent] Agent reacting with ${emoji}`);
        await progressHandler.addReaction(emoji);
      } else {
        await progressHandler.sendResponse(responseText.trim());
      }
    } else {
      logger.warn(`[ChatAgent] No text response - agent may have used tools only`);
      await progressHandler.sendResponse("Done! Let me know if you need anything else.");
    }

    await progressHandler.notifyCompletion?.();

    logger.info(`[ChatAgent] Session ${sessionId} completed`);
    return { success: true, sessionId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[ChatAgent] Error: ${errorMessage}`);
    await progressHandler.sendError(errorMessage);
    return { success: false, sessionId: "", error: errorMessage };
  } finally {
    if (unsubscribe) {
      unsubscribe();
    }
    statusThrottler.destroy();
    await opencode.releaseClient();
    tryGarbageCollect();
    logMemoryUsage("ChatAgent end");
  }
}
