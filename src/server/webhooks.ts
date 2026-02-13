import type { Attachment } from "@/channels/types.js";
import type { WhatsAppAdapter } from "@/channels/whatsapp/index.js";
import { getWebhookBaseUrl } from "@/config/config.js";
import { runAgentLoop } from "@/core/index.js";
import { Hono } from "hono";

/**
 * Download media from Twilio URL and convert to base64 data URL
 */
export async function downloadMediaAsBase64(
  mediaUrl: string,
  mimeType: string
): Promise<string | null> {
  try {
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      console.error(
        `[WhatsApp] Failed to download media: ${response.status} ${response.statusText}`
      );
      return null;
    }
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error("[WhatsApp] Error downloading media:", error);
    return null;
  }
}

/**
 * Extract attachments from Twilio webhook body
 * Twilio sends media with params: NumMedia, MediaUrl0, MediaContentType0, etc.
 */
export async function extractAttachments(body: Record<string, string>): Promise<Attachment[]> {
  // biome-ignore lint/complexity/useLiteralKeys: Twilio sends these as dynamic keys
  const numMedia = Number.parseInt(body["NumMedia"] || "0", 10);
  if (numMedia === 0) return [];

  const attachments: Attachment[] = [];

  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = body[`MediaUrl${i}`];
    const contentType = body[`MediaContentType${i}`];

    if (!mediaUrl || !contentType) continue;

    // Determine attachment type from mime type
    let type: Attachment["type"] = "document";
    if (contentType.startsWith("image/")) type = "image";
    else if (contentType.startsWith("audio/")) type = "audio";
    else if (contentType.startsWith("video/")) type = "video";

    // Download and convert to base64
    const dataUrl = await downloadMediaAsBase64(mediaUrl, contentType);
    if (dataUrl) {
      attachments.push({
        type,
        url: dataUrl, // Store as data URL for internal use
        mimeType: contentType,
      });
    }
  }

  return attachments;
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
    // biome-ignore lint/complexity/useLiteralKeys: Twilio sends these as dynamic keys
    const numMedia = Number.parseInt(body["NumMedia"] || "0", 10);

    if (!from) {
      return c.text("Bad request", 400);
    }

    // Allow messages with only media (no text body)
    if (!messageBody && numMedia === 0) {
      return c.text("Bad request", 400);
    }

    const phoneNumber = from.replace("whatsapp:", "");
    const sessionId = adapter.deriveSessionId(phoneNumber);

    // Extract attachments
    const attachments = await extractAttachments(body);

    // Fire agent loop in background — Twilio times out at ~15s but the agent
    // loop can run for minutes. Return 202 immediately so Twilio doesn't retry.
    void (async () => {
      try {
        const result = await runAgentLoop({
          sessionId,
          message: messageBody,
          channelName: "whatsapp",
          channelUserId: phoneNumber,
          attachments,
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
