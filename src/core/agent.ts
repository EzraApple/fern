import { createOpenAI } from "@ai-sdk/openai";
import { type CoreMessage, generateText } from "ai";
import { getOpenAIApiKey, loadConfig } from "../config/index.js";
import { Session } from "../storage/index.js";
import { executeTool, getAITools } from "../tools/index.js";
import { buildSystemPrompt } from "./prompt.js";
import type { AgentInput, AgentResult, ToolCallRecord } from "./types.js";

const MAX_ITERATIONS = 10;

export async function runAgentLoop(input: AgentInput): Promise<AgentResult> {
  const config = loadConfig();
  const apiKey = getOpenAIApiKey();

  // Initialize OpenAI provider
  const openai = createOpenAI({ apiKey });
  const model = openai(config.model.model);

  // Get or create session
  const session = await Session.getOrCreate(input.sessionId);

  // Append user message
  await session.appendUserMessage(input.message);

  // Get tools and build system prompt
  const tools = getAITools();
  const systemPrompt = buildSystemPrompt(tools, input.channelName);

  // Track tool calls for response
  const toolCallsHistory: ToolCallRecord[] = [];

  // Agent loop
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // Build messages from session history
    const sessionMessages = await session.getMessages();

    // Convert to CoreMessage format
    const messages: CoreMessage[] = sessionMessages.map((msg) => {
      if (msg.role === "user") {
        return { role: "user" as const, content: msg.content as string };
      }
      if (msg.role === "assistant") {
        if (typeof msg.content === "string") {
          return { role: "assistant" as const, content: msg.content };
        }
        // Tool call message
        return {
          role: "assistant" as const,
          content: msg.content as Array<{
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            args: unknown;
          }>,
        };
      }
      // Tool result message
      return {
        role: "tool" as const,
        content: (
          msg.content as Array<{
            type: "tool-result";
            toolCallId: string;
            result: string;
          }>
        ).map((c) => ({
          type: "tool-result" as const,
          toolCallId: c.toolCallId,
          toolName: "", // Will be filled by AI SDK
          result: c.result,
        })),
      };
    });

    try {
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools,
        maxSteps: 5, // Allow multiple tool calls per iteration
      });

      // Check if there were tool calls in this result
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const call of result.toolCalls) {
          // Execute the tool
          const output = await executeTool(call.toolName, call.args);

          // Record tool call
          toolCallsHistory.push({
            tool: call.toolName,
            input: call.args,
            output,
          });

          // Append to session
          await session.appendToolCall(call.toolCallId, call.toolName, call.args);
          await session.appendToolResult(call.toolCallId, output);
        }
      }

      // Check if we have a final text response
      if (result.text) {
        // Append assistant response to session
        await session.appendAssistantMessage(result.text);

        return {
          sessionId: session.id,
          response: result.text,
          toolCalls: toolCallsHistory.length > 0 ? toolCallsHistory : undefined,
        };
      }

      // If no text and no tool calls, something went wrong
      if (!result.toolCalls || result.toolCalls.length === 0) {
        const errorMsg = "I apologize, but I was unable to generate a response.";
        await session.appendAssistantMessage(errorMsg);
        return {
          sessionId: session.id,
          response: errorMsg,
          toolCalls: toolCallsHistory.length > 0 ? toolCallsHistory : undefined,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Agent loop error:", errorMessage);

      const errorResponse = `I encountered an error: ${errorMessage}`;
      await session.appendAssistantMessage(errorResponse);

      return {
        sessionId: session.id,
        response: errorResponse,
        toolCalls: toolCallsHistory.length > 0 ? toolCallsHistory : undefined,
      };
    }
  }

  // Max iterations reached
  const maxIterResponse =
    "I apologize, but I reached the maximum number of processing steps. Please try a simpler request.";
  await session.appendAssistantMessage(maxIterResponse);

  return {
    sessionId: session.id,
    response: maxIterResponse,
    toolCalls: toolCallsHistory.length > 0 ? toolCallsHistory : undefined,
  };
}
