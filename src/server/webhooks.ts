import { Hono } from "hono";
import type { WhatsAppAdapter } from "../channels/whatsapp/index.js";
import { getWebhookBaseUrl } from "../config/config.js";
import { runAgentLoop } from "../core/index.js";

export function createWhatsAppWebhookRoutes(adapter: WhatsAppAdapter): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    // Twilio sends application/x-www-form-urlencoded
    const body = (await c.req.parseBody()) as Record<string, string>;

    // Verify Twilio signature if webhook URL is configured
    const webhookBaseUrl = getWebhookBaseUrl();
    if (webhookBaseUrl) {
      const signature = c.req.header("X-Twilio-Signature");
      if (!signature) {
        return c.text("Forbidden", 403);
      }
      const fullUrl = `${webhookBaseUrl}/webhooks/whatsapp`;
      if (!adapter.validateWebhook(signature, fullUrl, body)) {
        return c.text("Forbidden", 403);
      }
    }

    // biome-ignore lint/complexity/useLiteralKeys: Twilio sends these as dynamic keys
    const from = body["From"];
    // biome-ignore lint/complexity/useLiteralKeys: Twilio sends these as dynamic keys
    const messageBody = body["Body"];

    if (!from || !messageBody) {
      return c.text("Bad request", 400);
    }

    const phoneNumber = from.replace("whatsapp:", "");
    const sessionId = adapter.deriveSessionId(phoneNumber);

    try {
      const result = await runAgentLoop({
        sessionId,
        message: messageBody,
        channelName: "whatsapp",
        channelUserId: phoneNumber,
      });

      await adapter.send({
        channelName: "whatsapp",
        channelUserId: phoneNumber,
        content: result.response,
      });

      // Return empty TwiML to prevent Twilio from sending a duplicate reply
      c.header("Content-Type", "text/xml");
      return c.body("<Response></Response>");
    } catch (error) {
      console.error("[WhatsApp] Webhook error:", error);
      return c.text("Internal server error", 500);
    }
  });

  return app;
}
