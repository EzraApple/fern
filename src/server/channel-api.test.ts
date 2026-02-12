import type { ChannelAdapter, ChannelCapabilities, OutboundMessage } from "@/channels/types.js";
import { createChannelApi } from "@/server/channel-api.js";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createMockAdapter(name: string): ChannelAdapter {
  return {
    name,
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockReturnValue({
      markdown: false,
      streaming: false,
      maxMessageLength: 1600,
      supportsAttachments: false,
      supportsReply: false,
    } satisfies ChannelCapabilities),
  };
}

describe("createChannelApi", () => {
  let app: Hono;
  let mockWhatsApp: ChannelAdapter;
  let adapters: Map<string, ChannelAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhatsApp = createMockAdapter("whatsapp");
    adapters = new Map([["whatsapp", mockWhatsApp]]);
    const root = new Hono();
    root.route("/internal/channel", createChannelApi(adapters));
    app = root;
  });

  describe("POST /internal/channel/send", () => {
    it("sends a message via the correct adapter", async () => {
      const res = await app.request("/internal/channel/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "whatsapp",
          to: "+1234567890",
          content: "Hello from scheduler!",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sent).toBe(true);
      expect(body.channel).toBe("whatsapp");
      expect(body.to).toBe("+1234567890");
      expect(mockWhatsApp.send).toHaveBeenCalledWith({
        channelName: "whatsapp",
        channelUserId: "+1234567890",
        content: "Hello from scheduler!",
      } satisfies OutboundMessage);
    });

    it("returns 404 for unknown channel", async () => {
      const res = await app.request("/internal/channel/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          to: "user123",
          content: "Hello",
        }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("No adapter found");
    });

    it("returns 400 for missing channel", async () => {
      const res = await app.request("/internal/channel/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "+1234567890",
          content: "Hello",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
    });

    it("returns 400 for empty content", async () => {
      const res = await app.request("/internal/channel/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "whatsapp",
          to: "+1234567890",
          content: "",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
    });

    it("returns 500 when adapter.send() fails", async () => {
      vi.mocked(mockWhatsApp.send).mockRejectedValue(new Error("Twilio error"));

      const res = await app.request("/internal/channel/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "whatsapp",
          to: "+1234567890",
          content: "Hello",
        }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("Twilio error");
    });
  });
});
