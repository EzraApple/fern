import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendMessage = vi.fn();

vi.mock("../channels/whatsapp/twilio-gateway.js", () => {
  return {
    TwilioGateway: class MockTwilioGateway {
      sendMessage = mockSendMessage;
    },
  };
});

vi.mock("../config/config.js", () => ({
  getTwilioCredentials: vi.fn(),
}));

import { getTwilioCredentials } from "../config/config.js";
import { initAlerts, resetAlerts, sendAlert } from "./alerts.js";

const mockGetTwilioCredentials = vi.mocked(getTwilioCredentials);

const TWILIO_CREDS = {
  accountSid: "AC123",
  authToken: "token",
  fromNumber: "whatsapp:+14155238886",
};

describe("alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetAlerts();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAlerts();
  });

  it("initAlerts returns false when FERN_ALERT_PHONE is not set", () => {
    expect(initAlerts()).toBe(false);
  });

  it("initAlerts returns false when Twilio credentials are missing", () => {
    vi.stubEnv("FERN_ALERT_PHONE", "+15559999999");
    mockGetTwilioCredentials.mockReturnValue(null);
    expect(initAlerts()).toBe(false);
  });

  it("initAlerts returns true when fully configured", () => {
    vi.stubEnv("FERN_ALERT_PHONE", "+15559999999");
    mockGetTwilioCredentials.mockReturnValue(TWILIO_CREDS);
    expect(initAlerts()).toBe(true);
  });

  it("sendAlert sends message successfully", async () => {
    vi.stubEnv("FERN_ALERT_PHONE", "+15559999999");
    mockGetTwilioCredentials.mockReturnValue(TWILIO_CREDS);
    mockSendMessage.mockResolvedValue({ sid: "SM123" });

    initAlerts();

    const result = await sendAlert("Test alert");
    expect(result).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith({
      to: "whatsapp:+15559999999",
      from: "whatsapp:+14155238886",
      body: "Test alert",
    });
  });

  it("sendAlert retries on failure then succeeds", async () => {
    vi.stubEnv("FERN_ALERT_PHONE", "+15559999999");
    mockGetTwilioCredentials.mockReturnValue(TWILIO_CREDS);
    mockSendMessage
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ sid: "SM123" });

    initAlerts();

    const result = await sendAlert("Test alert");
    expect(result).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });

  it("sendAlert returns false when all retries fail", async () => {
    vi.stubEnv("FERN_ALERT_PHONE", "+15559999999");
    mockGetTwilioCredentials.mockReturnValue(TWILIO_CREDS);
    mockSendMessage.mockRejectedValue(new Error("Network error"));

    initAlerts();

    const result = await sendAlert("Test alert");
    expect(result).toBe(false);
    expect(mockSendMessage).toHaveBeenCalledTimes(3);
  });

  it("sendAlert returns false when not initialized", async () => {
    const result = await sendAlert("Test alert");
    expect(result).toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
