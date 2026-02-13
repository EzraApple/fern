import { getLastResponse, listTools, subscribeToEvents } from "@/core/opencode/queries.js";
import { AgentTimeoutError, getOrCreateSession, prompt } from "@/core/opencode/session.js";
import { buildSystemPrompt } from "@/core/prompt.js";
import type { AgentInput, AgentResult, ToolCallRecord } from "@/core/types.js";
import { onTurnComplete } from "@/memory/index.js";

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3000;

/** Check if an error message indicates a transient/retryable failure */
function isTransientError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("socket hang up")
  );
}

/**
 * Run the agent loop using OpenCode SDK
 * Maps Fern channel sessions to OpenCode sessions for conversation continuity
 * Retries once on transient errors (e.g., OpenCode server temporarily unreachable)
 */
export async function runAgentLoop(input: AgentInput): Promise<AgentResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let unsubscribe: (() => void) | undefined;
    const toolCalls: ToolCallRecord[] = [];

    try {
      // 1. Get or create OpenCode session (maps phone → threadId)
      const { sessionId } = await getOrCreateSession({
        threadId: input.sessionId, // e.g., "whatsapp_+1234567890"
        title: `${input.channelName}: ${input.message.slice(0, 30)}`,
      });

      // 2. Build system prompt with tool list and channel context
      const tools = await listTools();
      const systemPrompt = buildSystemPrompt(
        tools,
        input.channelName,
        input.channelUserId,
        input.sessionId
      );

      // 3. Subscribe to events for progress tracking
      unsubscribe = await subscribeToEvents(sessionId, (event) => {
        if (event.type === "tool_start") {
        } else if (event.type === "tool_complete") {
          if (event.tool) {
            toolCalls.push({
              tool: event.tool,
              input: {},
              output: event.message || "",
            });
          }
        } else if (event.type === "tool_error") {
          console.error(`[Agent] Tool error: ${event.tool} - ${event.message}`);
        }
      });

      // 4. Send prompt and wait for completion
      await prompt(sessionId, input.message, {
        system: systemPrompt,
        agent: input.agentType ?? "fern",
        images: input.images,
      });

      // 5. Get response from OpenCode
      const response = await getLastResponse(sessionId);

      // 6. Fire archival observer (non-blocking)
      void onTurnComplete(input.sessionId, sessionId).catch((err) => {
        console.warn("[Memory] Archival observer error:", err);
      });

      return {
        sessionId: input.sessionId, // Return original channel session ID
        response,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      // Don't retry timeouts — they're definitive
      if (error instanceof AgentTimeoutError) {
        console.error(
          `[Agent] Turn timed out — threadId: ${input.sessionId}, openCodeSession: ${error.sessionId}, elapsed: ${error.elapsedMs}ms`
        );
        return {
          sessionId: input.sessionId,
          response:
            "Sorry, I took too long to respond and timed out. Please try again or simplify your request.",
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
      }

      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Retry transient errors (OpenCode server temporarily unreachable)
      if (isTransientError(errorMessage) && attempt < MAX_ATTEMPTS) {
        console.warn(
          `[Agent] Transient error (attempt ${attempt}/${MAX_ATTEMPTS}): ${errorMessage} — retrying in ${RETRY_DELAY_MS / 1000}s`
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }

      const isMoonshotFailure =
        errorMessage.includes("moonshot") ||
        errorMessage.includes("api.moonshot.ai") ||
        errorMessage.includes("ProviderAuth");
      if (isMoonshotFailure) {
        console.error("[Agent] Moonshot provider failure detected:", errorMessage);
      } else {
        console.error("[Agent] Error:", errorMessage);
      }

      return {
        sessionId: input.sessionId,
        response: `I encountered an error: ${errorMessage}`,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } finally {
      unsubscribe?.();
    }
  }

  // Unreachable — loop always returns or continues — but TypeScript requires it
  return {
    sessionId: input.sessionId,
    response: "I encountered an unexpected error. Please try again.",
    toolCalls: undefined,
  };
}
