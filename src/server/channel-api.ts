import { Hono } from "hono";
import { z } from "zod";
import type { ChannelAdapter } from "../channels/types.js";

const SendSchema = z.object({
  channel: z.string().min(1),
  to: z.string().min(1),
  content: z.string().min(1),
});

export function createChannelApi(adapters: Map<string, ChannelAdapter>): Hono {
  const api = new Hono();

  api.post("/send", async (c) => {
    const body = await c.req.json();
    const parsed = SendSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }

    const { channel, to, content } = parsed.data;
    const adapter = adapters.get(channel);
    if (!adapter) {
      return c.json({ error: `No adapter found for channel: ${channel}` }, 404);
    }

    try {
      await adapter.send({
        channelName: channel,
        channelUserId: to,
        content,
      });
      return c.json({ sent: true, channel, to });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to send: ${msg}` }, 500);
    }
  });

  return api;
}
