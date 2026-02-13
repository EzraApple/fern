import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing
vi.mock("@/core/opencode/queries.js", () => ({
  getLastResponse: vi.fn(),
  listTools: vi.fn(),
  subscribeToEvents: vi.fn(),
  getSessionMessages: vi.fn(),
}));

vi.mock("@/core/opencode/session.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/opencode/session.js")>();
  return {
    ...actual,
    getOrCreateSession: vi.fn(),
    prompt: vi.fn(),
    promptWithParts: vi.fn(),
  };
});

vi.mock("@/core/prompt.js", () => ({
  buildSystemPrompt: vi.fn(),
}));

vi.mock("@/memory/index.js", () => ({
  onTurnComplete: vi.fn(),
}));

import { attachmentsToFileParts, buildMessageParts, runAgentLoop } from "@/core/agent.js";
import { getLastResponse, listTools, subscribeToEvents } from "@/core/opencode/queries.js";
import { getOrCreateSession, prompt, promptWithParts } from "@/core/opencode/session.js";
import { buildSystemPrompt } from "@/core/prompt.js";
import type { AgentInput } from "@/core/types.js";
import { onTurnComplete } from "@/memory/index.js";

const mockGetOrCreateSession = vi.mocked(getOrCreateSession);
const mockListTools = vi.mocked(listTools);
const mockSubscribeToEvents = vi.mocked(subscribeToEvents);
const mockPrompt = vi.mocked(prompt);
const mockPromptWithParts = vi.mocked(promptWithParts);
const mockGetLastResponse = vi.mocked(getLastResponse);
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
        undefined,
        "whatsapp_+1234567890"
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
        undefined,
        "test-session"
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

    it("should pass channelName to buildSystemPrompt for scheduler", async () => {
      const schedulerInput: AgentInput = {
        sessionId: "scheduler_job-123",
        message: "Run daily cleanup",
        channelName: "scheduler",
      };

      await runAgentLoop(schedulerInput);

      expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
        ["echo", "time", "bash"],
        "scheduler",
        undefined,
        "scheduler_job-123"
      );
    });

    it("should pass agentType to prompt when provided", async () => {
      const subagentInput: AgentInput = {
        sessionId: "subagent_sub_123",
        message: "Find files",
        channelName: "subagent",
        agentType: "explore",
      };

      await runAgentLoop(subagentInput);

      expect(mockPrompt).toHaveBeenCalledWith("oc-session-123", "Find files", {
        system: "You are Fern, a helpful assistant.",
        agent: "explore",
      });
    });

    it("should default agent to fern when agentType not provided", async () => {
      await runAgentLoop(defaultInput);

      expect(mockPrompt).toHaveBeenCalledWith("oc-session-123", "Hello Fern!", {
        system: "You are Fern, a helpful assistant.",
        agent: "fern",
      });
    });

    it("should pass channelUserId when provided", async () => {
      const inputWithUser: AgentInput = {
        sessionId: "whatsapp_+1234567890",
        message: "Hello",
        channelName: "whatsapp",
        channelUserId: "+1234567890",
      };

      await runAgentLoop(inputWithUser);

      expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
        ["echo", "time", "bash"],
        "whatsapp",
        "+1234567890",
        "whatsapp_+1234567890"
      );
    });

    it("should use promptWithParts when attachments are provided", async () => {
      const inputWithAttachments: AgentInput = {
        sessionId: "whatsapp_+1234567890",
        message: "Check this image",
        channelName: "whatsapp",
        attachments: [
          {
            type: "image",
            url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
            mimeType: "image/jpeg",
          },
        ],
      };

      await runAgentLoop(inputWithAttachments);

      expect(mockPromptWithParts).toHaveBeenCalledWith(
        "oc-session-123",
        [
          { type: "text", text: "Check this image" },
          { type: "file", mime: "image/jpeg", url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
        ],
        {
          system: "You are Fern, a helpful assistant.",
          agent: "fern",
        }
      );
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it("should handle image-only messages (no text)", async () => {
      const imageOnlyInput: AgentInput = {
        sessionId: "whatsapp_+1234567890",
        message: "",
        channelName: "whatsapp",
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,iVBORw0KGgo=",
            mimeType: "image/png",
          },
        ],
      };

      await runAgentLoop(imageOnlyInput);

      expect(mockPromptWithParts).toHaveBeenCalledWith(
        "oc-session-123",
        [{ type: "file", mime: "image/png", url: "data:image/png;base64,iVBORw0KGgo=" }],
        {
          system: "You are Fern, a helpful assistant.",
          agent: "fern",
        }
      );
    });

    it("should filter non-image attachments", async () => {
      const inputWithMixedAttachments: AgentInput = {
        sessionId: "whatsapp_+1234567890",
        message: "Check these files",
        channelName: "whatsapp",
        attachments: [
          {
            type: "image",
            url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
            mimeType: "image/jpeg",
          },
          {
            type: "document",
            url: "https://example.com/doc.pdf",
            mimeType: "application/pdf",
          },
          {
            type: "audio",
            url: "https://example.com/audio.mp3",
            mimeType: "audio/mpeg",
          },
        ],
      };

      await runAgentLoop(inputWithMixedAttachments);

      // Only image should be passed to OpenCode
      expect(mockPromptWithParts).toHaveBeenCalledWith(
        "oc-session-123",
        [
          { type: "text", text: "Check these files" },
          { type: "file", mime: "image/jpeg", url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
        ],
        expect.any(Object)
      );
    });

    it("should handle multiple image attachments", async () => {
      const inputWithMultipleImages: AgentInput = {
        sessionId: "whatsapp_+1234567890",
        message: "Compare these",
        channelName: "whatsapp",
        attachments: [
          {
            type: "image",
            url: "data:image/jpeg;base64,abc123",
            mimeType: "image/jpeg",
          },
          {
            type: "image",
            url: "data:image/png;base64,xyz789",
            mimeType: "image/png",
          },
        ],
      };

      await runAgentLoop(inputWithMultipleImages);

      expect(mockPromptWithParts).toHaveBeenCalledWith(
        "oc-session-123",
        [
          { type: "text", text: "Compare these" },
          { type: "file", mime: "image/jpeg", url: "data:image/jpeg;base64,abc123" },
          { type: "file", mime: "image/png", url: "data:image/png;base64,xyz789" },
        ],
        expect.any(Object)
      );
    });
  });

  describe("attachmentsToFileParts", () => {
    it("should convert image attachments to OpenCode FilePart format", () => {
      const attachments = [
        {
          type: "image" as const,
          url: "data:image/jpeg;base64,abc123",
          mimeType: "image/jpeg",
        },
      ];

      const result = attachmentsToFileParts(attachments);

      expect(result).toEqual([
        { type: "file", mime: "image/jpeg", url: "data:image/jpeg;base64,abc123" },
      ]);
    });

    it("should filter out non-image attachments", () => {
      const attachments = [
        { type: "image" as const, url: "data:image/jpeg;base64,abc", mimeType: "image/jpeg" },
        {
          type: "document" as const,
          url: "https://example.com/doc.pdf",
          mimeType: "application/pdf",
        },
        { type: "video" as const, url: "https://example.com/video.mp4", mimeType: "video/mp4" },
      ];

      const result = attachmentsToFileParts(attachments);

      expect(result).toHaveLength(1);
      expect(result[0]?.mime).toBe("image/jpeg");
    });

    it("should use default mime type when not provided", () => {
      const attachments = [
        {
          type: "image" as const,
          url: "data:image/jpeg;base64,abc123",
        },
      ];

      const result = attachmentsToFileParts(attachments);

      expect(result[0]?.mime).toBe("image/jpeg");
    });

    it("should return empty array for undefined attachments", () => {
      expect(attachmentsToFileParts(undefined)).toEqual([]);
    });

    it("should return empty array for empty attachments", () => {
      expect(attachmentsToFileParts([])).toEqual([]);
    });
  });

  describe("buildMessageParts", () => {
    it("should build parts with text and images", () => {
      const message = "Check this";
      const attachments = [
        { type: "image" as const, url: "data:image/jpeg;base64,abc", mimeType: "image/jpeg" },
      ];

      const result = buildMessageParts(message, attachments);

      expect(result).toEqual([
        { type: "text", text: "Check this" },
        { type: "file", mime: "image/jpeg", url: "data:image/jpeg;base64,abc" },
      ]);
    });

    it("should handle image-only messages", () => {
      const message = "";
      const attachments = [
        { type: "image" as const, url: "data:image/jpeg;base64,abc", mimeType: "image/jpeg" },
      ];

      const result = buildMessageParts(message, attachments);

      expect(result).toEqual([
        { type: "file", mime: "image/jpeg", url: "data:image/jpeg;base64,abc" },
      ]);
    });

    it("should handle text-only messages", () => {
      const result = buildMessageParts("Hello", undefined);

      expect(result).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("should trim whitespace from text", () => {
      const result = buildMessageParts("  Hello  ", undefined);

      expect(result).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("should skip empty text parts", () => {
      const result = buildMessageParts("   ", [
        { type: "image" as const, url: "data:abc", mimeType: "image/jpeg" },
      ]);

      expect(result).toEqual([{ type: "file", mime: "image/jpeg", url: "data:abc" }]);
    });
  });
});
