import type { WhatsAppAdapter } from "@/channels/whatsapp/index.js";
import { getTwilioCredentials, getWebhookBaseUrl } from "@/config/config.js";
import { runAgentLoop } from "@/core/index.js";
import type { ImageAttachment } from "@/core/types.js";
import { Hono } from "hono";

/** Raw media reference extracted from Twilio webhook payload */
interface TwilioMedia {
  url: string;
  mimeType: string;
}

/** Extract image media references from Twilio webhook payload */
export function extractImageMedia(body: Record<string, string>): TwilioMedia[] {
  const numMedia = Number.parseInt(body.NumMedia || "0", 10);
  if (numMedia === 0) return [];

  const images: TwilioMedia[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = body[`MediaUrl${i}`];
    const contentType = body[`MediaContentType${i}`];

    if (url && contentType?.startsWith("image/")) {
      images.push({ url, mimeType: contentType });
    }
  }
  return images;
}

/** Download a Twilio media URL and convert to a base64 data URL */
export async function downloadMediaAsBase64(mediaUrl: string, mimeType: string): Promise<string> {
  const creds = getTwilioCredentials();
  if (!creds) {
    throw new Error("Twilio credentials not configured — cannot download media");
  }

  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

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
    const messageBody = body["Body"] || "";
    const numMedia = Number.parseInt(body.NumMedia || "0", 10);

    // Must have at least a sender, and either text or media
    if (!from || (messageBody === "" && numMedia === 0)) {
      return c.text("Bad request", 400);
    }

    const phoneNumber = from.replace("whatsapp:", "");
    const sessionId = adapter.deriveSessionId(phoneNumber);
    const rawMedia = extractImageMedia(body);

    // Fire agent loop in background — Twilio times out at ~15s but the agent
    // loop can run for minutes. Return 202 immediately so Twilio doesn't retry.
    void (async () => {
      try {
        // Download media and convert to base64 data URLs (Twilio URLs require auth)
        const images: ImageAttachment[] = [];
        for (const media of rawMedia) {
          try {
            const dataUrl = await downloadMediaAsBase64(media.url, media.mimeType);
            images.push({ url: dataUrl, mimeType: media.mimeType });
          } catch (err) {
            console.error("[WhatsApp] Failed to download media:", err);
          }
        }

        const result = await runAgentLoop({
          sessionId,
          message: messageBody || "(Image received)",
          channelName: "whatsapp",
          channelUserId: phoneNumber,
          images: images.length > 0 ? images : undefined,
        });

        await adapter.send({
          channelName: "whatsapp",
          channelUserId: phoneNumber,
          content: result.response,
        });
      } catch (error) {
        console.error("[WhatsApp] Background processing error:", error);
        const reason = error instanceof Error ? error.message : "unknown error";
        try {
          await adapter.send({
            channelName: "whatsapp",
            channelUserId: phoneNumber,
            content: `[Fern] Error processing your message: ${reason}. Try again.`,
          });
        } catch (sendError) {
          console.error("[WhatsApp] Failed to send error message to user:", sendError);
        }
      }
    })();

    // Return empty TwiML immediately to prevent Twilio timeout/retry
    c.header("Content-Type", "text/xml");
    return c.body("<Response></Response>", 202);
  });

  return app;
}
