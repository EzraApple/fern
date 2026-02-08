import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendMessage = vi.fn().mockResolvedValue({ sid: "SM_mock_sid" });
const mockValidateRequest = vi.fn().mockReturnValue(true);

// Mock twilio-gateway so we don't need real Twilio credentials
vi.mock("./twilio-gateway.js", () => {
  return {
    TwilioGateway: class MockTwilioGateway {
      sendMessage = mockSendMessage;
      validateRequest = mockValidateRequest;
    },
  };
});

import { WhatsAppAdapter } from "./adapter.js";

describe("WhatsAppAdapter", () => {
  let adapter: WhatsAppAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new WhatsAppAdapter({
      accountSid: "AC_test_sid",
      authToken: "test_auth_token",
      fromNumber: "whatsapp:+14155238886",
    });
  });

  describe("name", () => {
    it("returns 'whatsapp'", () => {
      expect(adapter.name).toBe("whatsapp");
    });
  });

  describe("init", () => {
    it("resolves without error", async () => {
      await expect(adapter.init()).resolves.toBeUndefined();
    });
  });

  describe("shutdown", () => {
    it("resolves without error", async () => {
      await expect(adapter.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("getCapabilities", () => {
    it("returns correct WhatsApp capabilities", () => {
      const caps = adapter.getCapabilities();
      expect(caps).toEqual({
        markdown: false,
        streaming: false,
        maxMessageLength: 1600,
        supportsAttachments: true,
        supportsReply: false,
      });
    });
  });

  describe("deriveSessionId", () => {
    it("normalizes phone number with whatsapp: prefix", () => {
      const sessionId = adapter.deriveSessionId("whatsapp:+15551234567");
      expect(sessionId).toBe("whatsapp_+15551234567");
    });

    it("normalizes plain phone number", () => {
      const sessionId = adapter.deriveSessionId("+15551234567");
      expect(sessionId).toBe("whatsapp_+15551234567");
    });

    it("strips non-digit non-plus characters", () => {
      const sessionId = adapter.deriveSessionId("+1 (555) 123-4567");
      expect(sessionId).toBe("whatsapp_+15551234567");
    });

    it("handles number without plus sign", () => {
      const sessionId = adapter.deriveSessionId("15551234567");
      expect(sessionId).toBe("whatsapp_15551234567");
    });
  });

  describe("send", () => {
    it("sends a short message as a single chunk", async () => {
      await adapter.send({
        channelName: "whatsapp",
        channelUserId: "+15551234567",
        content: "Hello!",
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith({
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
        body: "Hello!",
      });
    });

    it("sends a long message as multiple chunks", async () => {
      // Create a message that exceeds 1600 chars with paragraph boundary
      // "A".repeat(800) + "." = 801 chars, "B".repeat(800) + "." = 801 chars
      // Combined with \n\n = 1604 chars > 1600 limit
      // Each paragraph fits within 1600 individually, so splits into exactly 2 chunks
      const longContent = `${"A".repeat(800)}.\n\n${"B".repeat(800)}.`;
      await adapter.send({
        channelName: "whatsapp",
        channelUserId: "+15551234567",
        content: longContent,
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      // Verify each chunk was sent to the correct recipient
      for (const call of mockSendMessage.mock.calls) {
        expect(call[0].to).toBe("whatsapp:+15551234567");
        expect(call[0].from).toBe("whatsapp:+14155238886");
        expect(call[0].body.length).toBeGreaterThan(0);
        expect(call[0].body.length).toBeLessThanOrEqual(1600);
      }
    });

    it("strips markdown before sending", async () => {
      await adapter.send({
        channelName: "whatsapp",
        channelUserId: "+15551234567",
        content: "**bold** and *italic*",
      });

      expect(mockSendMessage).toHaveBeenCalledWith({
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
        body: "bold and italic",
      });
    });
  });

  describe("validateWebhook", () => {
    it("delegates to gateway.validateRequest", () => {
      const result = adapter.validateWebhook("sig", "https://example.com", { key: "val" });
      expect(result).toBe(true);
      expect(mockValidateRequest).toHaveBeenCalledWith(
        "sig",
        "https://example.com",
        { key: "val" },
      );
    });
  });
});
