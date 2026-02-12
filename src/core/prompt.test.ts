import { beforeEach, describe, expect, it, vi } from "vitest";

// Use a mutable ref so we can control the mock behavior per-test
const mockReadFileSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

describe("prompt", () => {
  beforeEach(() => {
    vi.resetModules();
    mockReadFileSync.mockReset();
  });

  describe("loadBasePrompt", () => {
    it("should read SYSTEM_PROMPT.md from config directory", async () => {
      mockReadFileSync.mockReturnValue("Hello {{TOOLS}} {{CHANNEL_CONTEXT}}");
      const { loadBasePrompt } = await import("./prompt.js");

      const result = loadBasePrompt();

      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining("SYSTEM_PROMPT.md"),
        "utf-8"
      );
      expect(result).toBe("Hello {{TOOLS}} {{CHANNEL_CONTEXT}}");
    });

    it("should cache the prompt after first load", async () => {
      mockReadFileSync.mockReturnValue("cached prompt");
      const { loadBasePrompt } = await import("./prompt.js");

      const first = loadBasePrompt();
      const second = loadBasePrompt();

      expect(first).toBe("cached prompt");
      expect(second).toBe("cached prompt");
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });

    it("should throw when file does not exist", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT: no such file");
      });
      const { loadBasePrompt } = await import("./prompt.js");

      expect(() => loadBasePrompt()).toThrow("ENOENT");
    });
  });

  describe("generateToolDescriptions", () => {
    it("should format tool names as a bulleted list", async () => {
      mockReadFileSync.mockReturnValue("");
      const { generateToolDescriptions } = await import("./prompt.js");

      const result = generateToolDescriptions(["echo", "time", "bash"]);
      expect(result).toBe("- echo\n- time\n- bash");
    });

    it("should return empty string for empty array", async () => {
      mockReadFileSync.mockReturnValue("");
      const { generateToolDescriptions } = await import("./prompt.js");

      const result = generateToolDescriptions([]);
      expect(result).toBe("");
    });

    it("should handle single tool", async () => {
      mockReadFileSync.mockReturnValue("");
      const { generateToolDescriptions } = await import("./prompt.js");

      const result = generateToolDescriptions(["echo"]);
      expect(result).toBe("- echo");
    });
  });

  describe("getChannelPrompt", () => {
    it("should return whatsapp prompt for 'whatsapp' channel", async () => {
      mockReadFileSync.mockReturnValue("");
      const { getChannelPrompt } = await import("./prompt.js");

      const result = getChannelPrompt("whatsapp");
      expect(result).toContain("WhatsApp");
      expect(result).toContain("plain text only");
    });

    it("should return webchat prompt for 'webchat' channel", async () => {
      mockReadFileSync.mockReturnValue("");
      const { getChannelPrompt } = await import("./prompt.js");

      const result = getChannelPrompt("webchat");
      expect(result).toContain("WebChat");
      expect(result).toContain("markdown");
    });

    it("should return empty string for unknown channel", async () => {
      mockReadFileSync.mockReturnValue("");
      const { getChannelPrompt } = await import("./prompt.js");

      const result = getChannelPrompt("discord");
      expect(result).toBe("");
    });

    it("should return empty string for empty string channel", async () => {
      mockReadFileSync.mockReturnValue("");
      const { getChannelPrompt } = await import("./prompt.js");

      const result = getChannelPrompt("");
      expect(result).toBe("");
    });
  });

  describe("getChannelPrompt — scheduler", () => {
    it("should return scheduler prompt for 'scheduler' channel", async () => {
      mockReadFileSync.mockReturnValue("");
      const { getChannelPrompt } = await import("./prompt.js");

      const result = getChannelPrompt("scheduler");
      expect(result).toContain("Scheduler");
      expect(result).toContain("autonomous");
      expect(result).toContain("send_message");
    });

    it("should include user ID context for scheduler channel", async () => {
      mockReadFileSync.mockReturnValue("");
      const { getChannelPrompt } = await import("./prompt.js");

      const result = getChannelPrompt("scheduler", "job_abc123");
      expect(result).toContain("Scheduler");
      expect(result).toContain("job_abc123");
    });
  });

  describe("getChannelPrompt — session ID injection", () => {
    it("should include session ID when provided", async () => {
      mockReadFileSync.mockReturnValue("");
      const { getChannelPrompt } = await import("./prompt.js");

      const result = getChannelPrompt("whatsapp", "+1234567890", "whatsapp_+1234567890");
      expect(result).toContain("Session ID: whatsapp_+1234567890");
    });

    it("should include both user ID and session ID", async () => {
      mockReadFileSync.mockReturnValue("");
      const { getChannelPrompt } = await import("./prompt.js");

      const result = getChannelPrompt("whatsapp", "+1234567890", "whatsapp_+1234567890");
      expect(result).toContain("User ID: +1234567890");
      expect(result).toContain("Session ID: whatsapp_+1234567890");
    });

    it("should not include session section when no userId or sessionId", async () => {
      mockReadFileSync.mockReturnValue("");
      const { getChannelPrompt } = await import("./prompt.js");

      const result = getChannelPrompt("whatsapp");
      expect(result).not.toContain("Current Session");
    });
  });

  describe("buildSystemPrompt — session ID", () => {
    it("should pass sessionId through to channel prompt", async () => {
      mockReadFileSync.mockReturnValue("{{TOOLS}}\n{{CHANNEL_CONTEXT}}");
      const { buildSystemPrompt } = await import("./prompt.js");

      const result = buildSystemPrompt(["echo"], "whatsapp", "+1234567890", "whatsapp_+1234567890");
      expect(result).toContain("Session ID: whatsapp_+1234567890");
    });
  });

  describe("buildSystemPrompt", () => {
    it("should replace {{TOOLS}} and {{CHANNEL_CONTEXT}} placeholders", async () => {
      mockReadFileSync.mockReturnValue("Tools:\n{{TOOLS}}\n\nChannel:\n{{CHANNEL_CONTEXT}}");
      const { buildSystemPrompt } = await import("./prompt.js");

      const result = buildSystemPrompt(["echo", "time"], "whatsapp");

      expect(result).toContain("- echo\n- time");
      expect(result).toContain("WhatsApp");
      expect(result).not.toContain("{{TOOLS}}");
      expect(result).not.toContain("{{CHANNEL_CONTEXT}}");
    });

    it("should replace {{CHANNEL_CONTEXT}} with empty string when no channel given", async () => {
      mockReadFileSync.mockReturnValue("Base {{TOOLS}} end {{CHANNEL_CONTEXT}}");
      const { buildSystemPrompt } = await import("./prompt.js");

      const result = buildSystemPrompt(["bash"]);

      expect(result).toContain("- bash");
      expect(result).toBe("Base - bash end ");
    });

    it("should replace {{CHANNEL_CONTEXT}} with empty string for unknown channel", async () => {
      mockReadFileSync.mockReturnValue("{{TOOLS}} | {{CHANNEL_CONTEXT}}");
      const { buildSystemPrompt } = await import("./prompt.js");

      const result = buildSystemPrompt(["tool1"], "telegram");

      expect(result).toBe("- tool1 | ");
    });

    it("should handle empty tool list", async () => {
      mockReadFileSync.mockReturnValue("{{TOOLS}}|{{CHANNEL_CONTEXT}}");
      const { buildSystemPrompt } = await import("./prompt.js");

      const result = buildSystemPrompt([]);

      expect(result).toBe("|");
    });

    it("should inject scheduler channel context when channelName is 'scheduler'", async () => {
      mockReadFileSync.mockReturnValue("{{TOOLS}}\n{{CHANNEL_CONTEXT}}");
      const { buildSystemPrompt } = await import("./prompt.js");

      const result = buildSystemPrompt(["echo"], "scheduler");

      expect(result).toContain("Scheduler");
      expect(result).toContain("autonomous");
      expect(result).not.toContain("{{CHANNEL_CONTEXT}}");
    });
  });
});
