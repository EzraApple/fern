import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing
vi.mock("./opencode-service.js", () => ({
  getOrCreateSession: vi.fn(),
  listTools: vi.fn(),
  subscribeToEvents: vi.fn(),
  prompt: vi.fn(),
  getLastResponse: vi.fn(),
  getSessionMessages: vi.fn(),
}));

vi.mock("./prompt.js", () => ({
  buildSystemPrompt: vi.fn(),
}));

vi.mock("../memory/index.js", () => ({
  onTurnComplete: vi.fn(),
}));

import { onTurnComplete } from "../memory/index.js";
import { runAgentLoop } from "./agent.js";
import * as opencodeService from "./opencode-service.js";
import { buildSystemPrompt } from "./prompt.js";
import type { AgentInput } from "./types.js";

const mockGetOrCreateSession = vi.mocked(opencodeService.getOrCreateSession);
const mockListTools = vi.mocked(opencodeService.listTools);
const mockSubscribeToEvents = vi.mocked(opencodeService.subscribeToEvents);
const mockPrompt = vi.mocked(opencodeService.prompt);
const mockGetLastResponse = vi.mocked(opencodeService.getLastResponse);
const mockBuildSystemPrompt = vi.mocked(buildSystemPrompt);
const mockOnTurnComplete = vi.mocked(onTurnComplete);

describe("agent", () => {
  const mockUnsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockGetOrCreateSession.mockResolvedValue({
      sessionId: "oc-session-123",
      shareUrl: "https://share.example.com/123",
    });
    mockListTools.mockResolvedValue(["echo", "time", "bash"]);
    mockSubscribeToEvents.mockResolvedValue(mockUnsubscribe);
    mockPrompt.mockResolvedValue(undefined);
    mockGetLastResponse.mockResolvedValue("Hello from Fern!");
    mockBuildSystemPrompt.mockReturnValue("You are Fern, a helpful assistant.");
    mockOnTurnComplete.mockResolvedValue(undefined);
  });

  describe("runAgentLoop", () => {
    const defaultInput: AgentInput = {
      sessionId: "whatsapp_+1234567890",
      message: "Hello Fern!",
      channelName: "whatsapp",
    };

    it("should create a session with correct thread ID and title", async () => {
      await runAgentLoop(defaultInput);

      expect(mockGetOrCreateSession).toHaveBeenCalledWith({
        threadId: "whatsapp_+1234567890",
        title: "whatsapp: Hello Fern!",
      });
    });

    it("should truncate long messages in session title", async () => {
      const longMessage = "A".repeat(100);
      await runAgentLoop({ ...defaultInput, message: longMessage });

      expect(mockGetOrCreateSession).toHaveBeenCalledWith({
        threadId: "whatsapp_+1234567890",
        title: `whatsapp: ${"A".repeat(30)}`,
      });
    });

    it("should build system prompt with tool list and channel name", async () => {
      await runAgentLoop(defaultInput);

      expect(mockListTools).toHaveBeenCalled();
      expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
        ["echo", "time", "bash"],
        "whatsapp",
        undefined
      );
    });

    it("should subscribe to events for the session", async () => {
      await runAgentLoop(defaultInput);

      expect(mockSubscribeToEvents).toHaveBeenCalledWith("oc-session-123", expect.any(Function));
    });

    it("should send prompt with system prompt and agent name", async () => {
      await runAgentLoop(defaultInput);

      expect(mockPrompt).toHaveBeenCalledWith("oc-session-123", "Hello Fern!", {
        system: "You are Fern, a helpful assistant.",
        agent: "fern",
      });
    });

    it("should return the agent response with original session ID", async () => {
      const result = await runAgentLoop(defaultInput);

      expect(result.sessionId).toBe("whatsapp_+1234567890");
      expect(result.response).toBe("Hello from Fern!");
    });

    it("should return undefined toolCalls when no tools were used", async () => {
      const result = await runAgentLoop(defaultInput);

      expect(result.toolCalls).toBeUndefined();
    });

    it("should capture tool calls from events", async () => {
      // Make subscribeToEvents invoke the callback with tool events
      mockSubscribeToEvents.mockImplementation(async (_sessionId, callback) => {
        await callback({
          type: "tool_start",
          tool: "echo",
        });
        await callback({
          type: "tool_complete",
          tool: "echo",
          message: "hello",
        });
        return mockUnsubscribe;
      });

      const result = await runAgentLoop(defaultInput);

      expect(result.toolCalls).toEqual([{ tool: "echo", input: {}, output: "hello" }]);
    });

    it("should not record tool_complete without a tool name", async () => {
      mockSubscribeToEvents.mockImplementation(async (_sessionId, callback) => {
        await callback({
          type: "tool_complete",
          // no tool property
          message: "orphan output",
        });
        return mockUnsubscribe;
      });

      const result = await runAgentLoop(defaultInput);

      expect(result.toolCalls).toBeUndefined();
    });

    it("should fire memory archival after response (non-blocking)", async () => {
      await runAgentLoop(defaultInput);

      expect(mockOnTurnComplete).toHaveBeenCalledWith("whatsapp_+1234567890", "oc-session-123");
    });

    it("should not throw when memory archival fails", async () => {
      mockOnTurnComplete.mockRejectedValue(new Error("Memory DB error"));

      const result = await runAgentLoop(defaultInput);

      // Should still return a valid response
      expect(result.response).toBe("Hello from Fern!");
    });

    it("should unsubscribe from events after completion", async () => {
      await runAgentLoop(defaultInput);

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it("should handle errors gracefully and return error message", async () => {
      mockPrompt.mockRejectedValue(new Error("LLM timeout"));

      const result = await runAgentLoop(defaultInput);

      expect(result.sessionId).toBe("whatsapp_+1234567890");
      expect(result.response).toContain("I encountered an error: LLM timeout");
    });

    it("should unsubscribe from events even when an error occurs", async () => {
      mockPrompt.mockRejectedValue(new Error("Connection failed"));

      await runAgentLoop(defaultInput);

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it("should handle non-Error exceptions in error path", async () => {
      mockPrompt.mockRejectedValue("string error");

      const result = await runAgentLoop(defaultInput);

      expect(result.response).toContain("Unknown error");
    });

    it("should include tool calls in error result when tools were called before error", async () => {
      mockSubscribeToEvents.mockImplementation(async (_sessionId, callback) => {
        await callback({
          type: "tool_complete",
          tool: "bash",
          message: "ran something",
        });
        return mockUnsubscribe;
      });
      mockPrompt.mockRejectedValue(new Error("Prompt failed"));

      const result = await runAgentLoop(defaultInput);

      expect(result.toolCalls).toEqual([{ tool: "bash", input: {}, output: "ran something" }]);
      expect(result.response).toContain("Prompt failed");
    });

    it("should work without channelName", async () => {
      const inputNoChannel: AgentInput = {
        sessionId: "test-session",
        message: "Hi",
      };

      await runAgentLoop(inputNoChannel);

      expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
        ["echo", "time", "bash"],
        undefined,
        undefined
      );
    });

    it("should handle empty response from getLastResponse", async () => {
      mockGetLastResponse.mockResolvedValue("");

      const result = await runAgentLoop(defaultInput);

      expect(result.response).toBe("");
    });

    it("should handle session creation with no shareUrl", async () => {
      mockGetOrCreateSession.mockResolvedValue({
        sessionId: "oc-session-456",
      });

      const result = await runAgentLoop(defaultInput);

      expect(result.response).toBe("Hello from Fern!");
    });

    it("should handle tool_error events without crashing", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockSubscribeToEvents.mockImplementation(async (_sessionId, callback) => {
        await callback({
          type: "tool_error",
          tool: "bash",
          message: "permission denied",
        });
        return mockUnsubscribe;
      });

      const result = await runAgentLoop(defaultInput);

      expect(result.response).toBe("Hello from Fern!");
      consoleErrorSpy.mockRestore();
    });

    it("should handle multiple tool calls in sequence", async () => {
      mockSubscribeToEvents.mockImplementation(async (_sessionId, callback) => {
        await callback({ type: "tool_complete", tool: "echo", message: "first" });
        await callback({ type: "tool_complete", tool: "time", message: "second" });
        await callback({ type: "tool_complete", tool: "bash", message: "third" });
        return mockUnsubscribe;
      });

      const result = await runAgentLoop(defaultInput);

      expect(result.toolCalls).toHaveLength(3);
      expect(result.toolCalls?.[0]?.tool).toBe("echo");
      expect(result.toolCalls?.[1]?.tool).toBe("time");
      expect(result.toolCalls?.[2]?.tool).toBe("bash");
    });
  });
});
