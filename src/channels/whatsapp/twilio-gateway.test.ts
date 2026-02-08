import { beforeEach, describe, expect, it, vi } from "vitest";
import { TwilioGateway } from "./twilio-gateway.js";

// Mock the twilio module
vi.mock("twilio", () => {
  const mockCreate = vi.fn().mockResolvedValue({ sid: "SM_mock_message_sid" });
  const mockClient = {
    messages: { create: mockCreate },
  };
  const twilioFn = vi.fn(() => mockClient);
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  (twilioFn as any).validateRequest = vi.fn().mockReturnValue(true);
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  (twilioFn as any).__mockCreate = mockCreate;
  return { default: twilioFn };
});

const twilio = (await import("twilio")).default;
// biome-ignore lint/suspicious/noExplicitAny: test mock access
const mockCreate = (twilio as any).__mockCreate;

describe("TwilioGateway", () => {
  let gateway: TwilioGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new TwilioGateway({
      accountSid: "AC_test_sid",
      authToken: "test_auth_token",
    });
  });

  describe("sendMessage", () => {
    it("creates a Twilio message and returns the SID", async () => {
      const result = await gateway.sendMessage({
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
        body: "Hello from Fern!",
      });

      expect(result).toEqual({ sid: "SM_mock_message_sid" });
      expect(mockCreate).toHaveBeenCalledWith({
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
        body: "Hello from Fern!",
      });
    });

    it("passes through the exact message parameters", async () => {
      await gateway.sendMessage({
        to: "whatsapp:+10000000000",
        from: "whatsapp:+19999999999",
        body: "Test body",
      });

      expect(mockCreate).toHaveBeenCalledWith({
        to: "whatsapp:+10000000000",
        from: "whatsapp:+19999999999",
        body: "Test body",
      });
    });

    it("propagates errors from Twilio client", async () => {
      mockCreate.mockRejectedValueOnce(new Error("Twilio API error"));

      await expect(
        gateway.sendMessage({
          to: "whatsapp:+15551234567",
          from: "whatsapp:+14155238886",
          body: "Hello",
        }),
      ).rejects.toThrow("Twilio API error");
    });
  });

  describe("validateRequest", () => {
    it("calls twilio.validateRequest with the auth token", () => {
      const result = gateway.validateRequest(
        "signature123",
        "https://example.com/webhook",
        { Body: "Hello" },
      );

      expect(result).toBe(true);
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      expect((twilio as any).validateRequest).toHaveBeenCalledWith(
        "test_auth_token",
        "signature123",
        "https://example.com/webhook",
        { Body: "Hello" },
      );
    });

    it("returns false when validation fails", () => {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (twilio as any).validateRequest.mockReturnValueOnce(false);

      const result = gateway.validateRequest("bad_sig", "https://example.com", {});
      expect(result).toBe(false);
    });
  });
});
