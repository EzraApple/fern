import { onTurnComplete } from "../memory/index.js";
import * as opencodeService from "./opencode-service.js";
import { AgentTimeoutError } from "./opencode-service.js";
import { buildSystemPrompt } from "./prompt.js";
import type { AgentInput, AgentResult, ToolCallRecord } from "./types.js";

/**
 * Run the agent loop using OpenCode SDK
 * Maps Fern channel sessions to OpenCode sessions for conversation continuity
 */
export async function runAgentLoop(input: AgentInput): Promise<AgentResult> {
  // 1. Get or create OpenCode session (maps phone → threadId)
  const { sessionId, shareUrl } = await opencodeService.getOrCreateSession({
    threadId: input.sessionId, // e.g., "whatsapp_+1234567890"
    title: `${input.channelName}: ${input.message.slice(0, 30)}`,
  });
  if (shareUrl) {
  }

  // 2. Build system prompt with tool list and channel context
  const tools = await opencodeService.listTools();
  const systemPrompt = buildSystemPrompt(tools, input.channelName, input.channelUserId);

  // 3. Subscribe to events for progress tracking
  const toolCalls: ToolCallRecord[] = [];
  const unsubscribe = await opencodeService.subscribeToEvents(sessionId, (event) => {
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

  try {
    // 4. Send prompt and wait for completion
    await opencodeService.prompt(sessionId, input.message, {
      system: systemPrompt,
      agent: "fern",
    });

    // 5. Get response from OpenCode
    const response = await opencodeService.getLastResponse(sessionId);

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
    if (error instanceof AgentTimeoutError) {
      console.error(
        `[Agent] Turn timed out — threadId: ${input.sessionId}, openCodeSession: ${sessionId}, elapsed: ${error.elapsedMs}ms`
      );
      return {
        sessionId: input.sessionId,
        response:
          "Sorry, I took too long to respond and timed out. Please try again or simplify your request.",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Agent] Error:", errorMessage);

    return {
      sessionId: input.sessionId,
      response: `I encountered an error: ${errorMessage}`,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  } finally {
    // Cleanup event subscription
    unsubscribe();
  }
}
