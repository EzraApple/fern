import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the agent loop
vi.mock("@/core/index.js", () => ({
  runAgentLoop: vi.fn(),
}));

// Mock the config
vi.mock("@/config/config.js", () => ({
  getWebhookBaseUrl: vi.fn(),
  getTwilioCredentials: vi.fn(),
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
import { getTwilioCredentials, getWebhookBaseUrl } from "@/config/config.js";
import { runAgentLoop } from "@/core/index.js";
import {
  createWhatsAppWebhookRoutes,
  downloadMediaAsBase64,
  extractImageMedia,
} from "@/server/webhooks.js";
import { Hono } from "hono";

const mockRunAgentLoop = vi.mocked(runAgentLoop);
const mockGetWebhookBaseUrl = vi.mocked(getWebhookBaseUrl);
const mockGetTwilioCredentials = vi.mocked(getTwilioCredentials);

/** Flush pending microtasks so fire-and-forget async work completes */
async function flushAsync() {
  await vi.waitFor(() => {});
}

describe("createWhatsAppWebhookRoutes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWebhookBaseUrl.mockReturnValue(null);
    mockGetTwilioCredentials.mockReturnValue({
      accountSid: "ACtest123",
      authToken: "test-auth-token",
      fromNumber: "+15550001111",
    });
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

  describe("Image support", () => {
    it("accepts image-only messages (no Body, has media)", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(Buffer.from("fake-image-bytes"), { status: 200 }));
      mockRunAgentLoop.mockResolvedValue({
        response: "I see an image!",
        sessionId: "whatsapp_+15551234567",
        toolCalls: [],
      });

      const formData = new URLSearchParams();
      formData.set("From", "whatsapp:+15551234567");
      formData.set("NumMedia", "1");
      formData.set("MediaUrl0", "https://api.twilio.com/media/img0");
      formData.set("MediaContentType0", "image/jpeg");

      const res = await app.request("/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      expect(res.status).toBe(202);

      // Wait for background block to finish (includes async download steps)
      await vi.waitFor(() => {
        expect(mockRunAgentLoop).toHaveBeenCalled();
      });

      expect(mockRunAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "(Image received)",
          images: [
            expect.objectContaining({
              mimeType: "image/jpeg",
              url: expect.stringMatching(/^data:image\/jpeg;base64,/),
            }),
          ],
        })
      );

      fetchSpy.mockRestore();
    });

    it("downloads images and converts to base64 data URLs", async () => {
      const imageBytes = Buffer.from("png-image-data");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(imageBytes, { status: 200 }));
      mockRunAgentLoop.mockResolvedValue({
        response: "ok",
        sessionId: "whatsapp_+15551234567",
        toolCalls: [],
      });

      const formData = new URLSearchParams();
      formData.set("From", "whatsapp:+15551234567");
      formData.set("Body", "What's this?");
      formData.set("NumMedia", "1");
      formData.set("MediaUrl0", "https://api.twilio.com/media/img0");
      formData.set("MediaContentType0", "image/png");

      await app.request("/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      await vi.waitFor(() => {
        expect(mockRunAgentLoop).toHaveBeenCalled();
      });

      // Verify fetch was called with Twilio Basic auth
      expect(fetchSpy).toHaveBeenCalledWith("https://api.twilio.com/media/img0", {
        headers: {
          Authorization: `Basic ${Buffer.from("ACtest123:test-auth-token").toString("base64")}`,
        },
      });

      // Verify the base64 data URL was passed to agent
      const expectedDataUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;
      expect(mockRunAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          images: [{ url: expectedDataUrl, mimeType: "image/png" }],
        })
      );

      fetchSpy.mockRestore();
    });

    it("handles multiple images", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => new Response(Buffer.from("img"), { status: 200 }));
      mockRunAgentLoop.mockResolvedValue({
        response: "ok",
        sessionId: "whatsapp_+15551234567",
        toolCalls: [],
      });

      const formData = new URLSearchParams();
      formData.set("From", "whatsapp:+15551234567");
      formData.set("Body", "Two photos");
      formData.set("NumMedia", "2");
      formData.set("MediaUrl0", "https://api.twilio.com/media/img0");
      formData.set("MediaContentType0", "image/jpeg");
      formData.set("MediaUrl1", "https://api.twilio.com/media/img1");
      formData.set("MediaContentType1", "image/png");

      await app.request("/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      await vi.waitFor(() => {
        expect(mockRunAgentLoop).toHaveBeenCalled();
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(mockRunAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          images: [
            expect.objectContaining({ mimeType: "image/jpeg" }),
            expect.objectContaining({ mimeType: "image/png" }),
          ],
        })
      );

      fetchSpy.mockRestore();
    });

    it("skips non-image media types", async () => {
      mockRunAgentLoop.mockResolvedValue({
        response: "ok",
        sessionId: "whatsapp_+15551234567",
        toolCalls: [],
      });

      const formData = new URLSearchParams();
      formData.set("From", "whatsapp:+15551234567");
      formData.set("Body", "Here's a video");
      formData.set("NumMedia", "1");
      formData.set("MediaUrl0", "https://api.twilio.com/media/vid0");
      formData.set("MediaContentType0", "video/mp4");

      await app.request("/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      await flushAsync();

      // No images should be passed (video is not an image)
      expect(mockRunAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          images: undefined,
        })
      );
    });

    it("continues without images when download fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));
      mockRunAgentLoop.mockResolvedValue({
        response: "ok",
        sessionId: "whatsapp_+15551234567",
        toolCalls: [],
      });

      const formData = new URLSearchParams();
      formData.set("From", "whatsapp:+15551234567");
      formData.set("Body", "Photo");
      formData.set("NumMedia", "1");
      formData.set("MediaUrl0", "https://api.twilio.com/media/img0");
      formData.set("MediaContentType0", "image/jpeg");

      await app.request("/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      await vi.waitFor(() => {
        expect(mockRunAgentLoop).toHaveBeenCalled();
      });

      // Agent still runs, just without images
      expect(mockRunAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Photo",
          images: undefined,
        })
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[WhatsApp] Failed to download media:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
      fetchSpy.mockRestore();
    });
  });

  describe("extractImageMedia", () => {
    it("returns empty array when NumMedia is 0", () => {
      expect(extractImageMedia({ NumMedia: "0" })).toEqual([]);
    });

    it("returns empty array when NumMedia is missing", () => {
      expect(extractImageMedia({})).toEqual([]);
    });

    it("extracts single image", () => {
      const result = extractImageMedia({
        NumMedia: "1",
        MediaUrl0: "https://api.twilio.com/media/img0",
        MediaContentType0: "image/jpeg",
      });
      expect(result).toEqual([
        { url: "https://api.twilio.com/media/img0", mimeType: "image/jpeg" },
      ]);
    });

    it("extracts multiple images", () => {
      const result = extractImageMedia({
        NumMedia: "2",
        MediaUrl0: "https://api.twilio.com/media/img0",
        MediaContentType0: "image/jpeg",
        MediaUrl1: "https://api.twilio.com/media/img1",
        MediaContentType1: "image/png",
      });
      expect(result).toHaveLength(2);
      expect(result[0]?.mimeType).toBe("image/jpeg");
      expect(result[1]?.mimeType).toBe("image/png");
    });

    it("skips non-image media types", () => {
      const result = extractImageMedia({
        NumMedia: "2",
        MediaUrl0: "https://api.twilio.com/media/vid0",
        MediaContentType0: "video/mp4",
        MediaUrl1: "https://api.twilio.com/media/img1",
        MediaContentType1: "image/png",
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.mimeType).toBe("image/png");
    });

    it("skips entries with missing URL", () => {
      const result = extractImageMedia({
        NumMedia: "1",
        MediaContentType0: "image/jpeg",
      });
      expect(result).toEqual([]);
    });

    it("skips entries with missing content type", () => {
      const result = extractImageMedia({
        NumMedia: "1",
        MediaUrl0: "https://api.twilio.com/media/img0",
      });
      expect(result).toEqual([]);
    });
  });

  describe("downloadMediaAsBase64", () => {
    it("downloads and converts to base64 data URL", async () => {
      const imageBytes = Buffer.from("test-image-content");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(imageBytes, { status: 200 }));

      const result = await downloadMediaAsBase64("https://api.twilio.com/media/img0", "image/jpeg");

      expect(result).toBe(`data:image/jpeg;base64,${imageBytes.toString("base64")}`);
      expect(fetchSpy).toHaveBeenCalledWith("https://api.twilio.com/media/img0", {
        headers: {
          Authorization: `Basic ${Buffer.from("ACtest123:test-auth-token").toString("base64")}`,
        },
      });

      fetchSpy.mockRestore();
    });

    it("throws when Twilio credentials are not configured", async () => {
      mockGetTwilioCredentials.mockReturnValue(null);

      await expect(
        downloadMediaAsBase64("https://api.twilio.com/media/img0", "image/jpeg")
      ).rejects.toThrow("Twilio credentials not configured");
    });

    it("throws when HTTP response is not ok", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
        );

      await expect(
        downloadMediaAsBase64("https://api.twilio.com/media/img0", "image/jpeg")
      ).rejects.toThrow("Failed to download media: 401 Unauthorized");

      fetchSpy.mockRestore();
    });
  });
});
