import { tool } from "@opencode-ai/plugin";
import { getAuthHeaders, getFernUrl } from "./utils.js";

export const send_message = tool({
  description:
    "Send a message to a user on a specific channel. Use this to proactively reach out — in scheduled jobs, follow-ups, or when you need to notify someone outside the current conversation. For WhatsApp: channel is 'whatsapp', recipient is phone number with country code (e.g., '+1234567890'). Messages over 1600 characters are auto-chunked. Keep messages concise and conversational — this goes directly to someone's phone.",
  args: {
    channel: tool.schema.string().describe("The channel to send on (e.g., 'whatsapp')"),
    to: tool.schema
      .string()
      .describe("The recipient identifier (e.g., '+1234567890' for WhatsApp)"),
    content: tool.schema.string().describe("The message content to send"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/channel/send`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          channel: args.channel,
          to: args.to,
          content: args.content,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error sending message: ${err}`;
      }
      const result = (await res.json()) as { sent: boolean; channel: string; to: string };
      return `Message sent to ${result.to} on ${result.channel}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error sending message: ${msg}`;
    }
  },
});
