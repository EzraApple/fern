import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the agent loop
vi.mock("@/core/index.js", () => ({
  runAgentLoop: vi.fn(),
}));

// Mock the config
vi.mock("@/config/config.js", () => ({
  getWebhookBaseUrl: vi.fn(),
}));

// Mock the WhatsApp adapter
const mockSend = vi.fn().mockResolvedValue(undefined);
const mockDeriveSessionId = vi.fn((phone: string) => {
  const normalized = phone.replace("whatsapp:", "").replace(/[^+\d]/g, "");
  return `whatsapp_${normalized}`;
});
const mockAdapter = {
  name: "whatsapp",
  send: mockSend,
  deriveSessionId: mockDeriveSessionId,
  getCapabilities: vi.fn().mockReturnValue({
    markdown: false,
    streaming: false,
    maxMessageLength: 1600,
    supportsAttachments: true,
    supportsReply: false,
  }),
  init: vi.fn(),
  shutdown: vi.fn(),
  validateWebhook: vi.fn(),
};

import type { WhatsAppAdapter } from "@/channels/whatsapp/index.js";
import { getWebhookBaseUrl } from "@/config/config.js";
import { runAgentLoop } from "@/core/index.js";
import { createWhatsAppWebhookRoutes } from "@/server/webhooks.js";
import { Hono } from "hono";

const mockRunAgentLoop = vi.mocked(runAgentLoop);
const mockGetWebhookBaseUrl = vi.mocked(getWebhookBaseUrl);

/** Flush pending microtasks so fire-and-forget async work completes */
async function flushAsync() {
  await vi.waitFor(() => {});
}

describe("createWhatsAppWebhookRoutes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWebhookBaseUrl.mockReturnValue(null);
    const root = new Hono();
    root.route(
      "/webhooks/whatsapp",
      createWhatsAppWebhookRoutes(mockAdapter as unknown as WhatsAppAdapter)
    );
    app = root;
  });

  it("returns 202 with empty TwiML immediately", async () => {
    mockRunAgentLoop.mockResolvedValue({
      response: "Hello from Fern!",
      sessionId: "whatsapp_+15551234567",
      toolCalls: [],
    });

    const formData = new URLSearchParams();
    formData.set("From", "whatsapp:+15551234567");
    formData.set("Body", "Hi there");

    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    expect(res.status).toBe(202);
    const text = await res.text();
    expect(text).toBe("<Response></Response>");
    expect(res.headers.get("content-type")).toContain("text/xml");
  });

  it("runs agent loop and sends response in background", async () => {
    mockRunAgentLoop.mockResolvedValue({
      response: "Hello from Fern!",
      sessionId: "whatsapp_+15551234567",
      toolCalls: [],
    });

    const formData = new URLSearchParams();
    formData.set("From", "whatsapp:+15551234567");
    formData.set("Body", "Hi there");

    await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    await flushAsync();

    expect(mockRunAgentLoop).toHaveBeenCalledWith({
      sessionId: "whatsapp_+15551234567",
      message: "Hi there",
      channelName: "whatsapp",
      channelUserId: "+15551234567",
    });

    expect(mockSend).toHaveBeenCalledWith({
      channelName: "whatsapp",
      channelUserId: "+15551234567",
      content: "Hello from Fern!",
    });
  });

  it("strips whatsapp: prefix from phone number for channelUserId", async () => {
    mockRunAgentLoop.mockResolvedValue({
      response: "ok",
      sessionId: "whatsapp_+15551234567",
      toolCalls: [],
    });

    const formData = new URLSearchParams();
    formData.set("From", "whatsapp:+15551234567");
    formData.set("Body", "test");

    await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    await flushAsync();

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ channelUserId: "+15551234567" })
    );
  });

  it("returns 400 when From field is missing", async () => {
    const formData = new URLSearchParams();
    formData.set("Body", "Hello");

    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe("Bad request");
  });

  it("returns 400 when Body field is missing", async () => {
    const formData = new URLSearchParams();
    formData.set("From", "whatsapp:+15551234567");

    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe("Bad request");
  });

  it("returns 400 when both From and Body are missing", async () => {
    const formData = new URLSearchParams();

    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe("Bad request");
  });

  it("sends error message to user when agent loop fails", async () => {
    mockRunAgentLoop.mockRejectedValue(new Error("Agent error"));

    const formData = new URLSearchParams();
    formData.set("From", "whatsapp:+15551234567");
    formData.set("Body", "Hi");

    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    // Still returns 202 immediately
    expect(res.status).toBe(202);

    await flushAsync();

    // Error message sent to user
    expect(mockSend).toHaveBeenCalledWith({
      channelName: "whatsapp",
      channelUserId: "+15551234567",
      content: "[Fern] Error processing your message: Agent error. Try again.",
    });
  });

  it("sends error message to user when adapter send fails", async () => {
    mockRunAgentLoop.mockResolvedValue({
      response: "ok",
      sessionId: "whatsapp_+15551234567",
      toolCalls: [],
    });
    // First send (the response) fails, second send (the error message) succeeds
    mockSend
      .mockRejectedValueOnce(new Error("Twilio send failed"))
      .mockResolvedValueOnce(undefined);

    const formData = new URLSearchParams();
    formData.set("From", "whatsapp:+15551234567");
    formData.set("Body", "test");

    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    expect(res.status).toBe(202);

    await flushAsync();

    // Error message sent as fallback
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenLastCalledWith({
      channelName: "whatsapp",
      channelUserId: "+15551234567",
      content: "[Fern] Error processing your message: Twilio send failed. Try again.",
    });
  });

  it("logs but does not throw when error message send also fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRunAgentLoop.mockRejectedValue(new Error("Agent error"));
    mockSend.mockRejectedValue(new Error("Send also failed"));

    const formData = new URLSearchParams();
    formData.set("From", "whatsapp:+15551234567");
    formData.set("Body", "Hi");

    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    expect(res.status).toBe(202);

    await flushAsync();

    // Both errors logged
    expect(consoleSpy).toHaveBeenCalledWith(
      "[WhatsApp] Background processing error:",
      expect.any(Error)
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "[WhatsApp] Failed to send error message to user:",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("derives session ID using adapter", async () => {
    mockRunAgentLoop.mockResolvedValue({
      response: "ok",
      sessionId: "whatsapp_+15551234567",
      toolCalls: [],
    });

    const formData = new URLSearchParams();
    formData.set("From", "whatsapp:+15551234567");
    formData.set("Body", "test");

    await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    // The webhook strips "whatsapp:" then passes to deriveSessionId
    expect(mockDeriveSessionId).toHaveBeenCalledWith("+15551234567");
  });

  describe("Twilio signature verification", () => {
    it("returns 403 when X-Twilio-Signature header is missing and webhook URL is configured", async () => {
      mockGetWebhookBaseUrl.mockReturnValue("https://example.ngrok.io");

      const formData = new URLSearchParams();
      formData.set("From", "whatsapp:+15551234567");
      formData.set("Body", "Hello");

      const res = await app.request("/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      expect(res.status).toBe(403);
      expect(await res.text()).toBe("Forbidden");
    });

    it("returns 403 when signature is invalid", async () => {
      mockGetWebhookBaseUrl.mockReturnValue("https://example.ngrok.io");
      mockAdapter.validateWebhook.mockReturnValue(false);

      const formData = new URLSearchParams();
      formData.set("From", "whatsapp:+15551234567");
      formData.set("Body", "Hello");

      const res = await app.request("/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": "bad-signature",
        },
        body: formData.toString(),
      });

      expect(res.status).toBe(403);
      expect(await res.text()).toBe("Forbidden");
    });

    it("processes request when signature is valid", async () => {
      mockGetWebhookBaseUrl.mockReturnValue("https://example.ngrok.io");
      mockAdapter.validateWebhook.mockReturnValue(true);
      mockRunAgentLoop.mockResolvedValue({
        response: "ok",
        sessionId: "whatsapp_+15551234567",
        toolCalls: [],
      });

      const formData = new URLSearchParams();
      formData.set("From", "whatsapp:+15551234567");
      formData.set("Body", "Hello");

      const res = await app.request("/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": "valid-signature",
        },
        body: formData.toString(),
      });

      expect(res.status).toBe(202);
      expect(mockAdapter.validateWebhook).toHaveBeenCalledWith(
        "valid-signature",
        "https://example.ngrok.io/webhooks/whatsapp",
        expect.objectContaining({ From: "whatsapp:+15551234567" })
      );
    });

    it("skips verification when webhook URL is not configured", async () => {
      mockGetWebhookBaseUrl.mockReturnValue(null);
      mockRunAgentLoop.mockResolvedValue({
        response: "ok",
        sessionId: "whatsapp_+15551234567",
        toolCalls: [],
      });

      const formData = new URLSearchParams();
      formData.set("From", "whatsapp:+15551234567");
      formData.set("Body", "Hello");

      const res = await app.request("/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      expect(res.status).toBe(202);
      expect(mockAdapter.validateWebhook).not.toHaveBeenCalled();
    });
  });
});
