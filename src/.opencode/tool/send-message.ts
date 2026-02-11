import { tool } from "@opencode-ai/plugin";

function getFernUrl(): string {
  return process.env.FERN_API_URL || `http://127.0.0.1:${process.env.FERN_PORT || "4000"}`;
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.FERN_API_SECRET;
  if (secret) {
    headers["X-Fern-Secret"] = secret;
  }
  return headers;
}

export const send_message = tool({
  description:
    "Send a message to a user on a specific channel (e.g., WhatsApp). Use this to proactively reach out to someone.",
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
