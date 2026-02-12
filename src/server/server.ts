import type { ChannelAdapter } from "@/channels/types.js";
import type { WhatsAppAdapter } from "@/channels/whatsapp/index.js";
import { runAgentLoop } from "@/core/index.js";
import { createChannelApi } from "@/server/channel-api.js";
import { createDashboardApi } from "@/server/dashboard-api.js";
import { createGitHubWebhookRoutes } from "@/server/github-webhook.js";
import { internalAuth } from "@/server/internal-auth.js";
import { createMemoryApi } from "@/server/memory-api.js";
import { createSchedulerApi } from "@/server/scheduler-api.js";
import { createTasksApi } from "@/server/tasks-api.js";
import { createWhatsAppWebhookRoutes } from "@/server/webhooks.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

const ChatInputSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1, "Message cannot be empty"),
});

export interface ServerOptions {
  whatsappAdapter?: WhatsAppAdapter;
  channelAdapters?: Map<string, ChannelAdapter>;
}

export function createServer(options?: ServerOptions) {
  const app = new Hono();

  // Enable CORS for all routes
  app.use("*", cors());

  // Health check endpoint
  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Chat endpoint
  app.post("/chat", async (c) => {
    try {
      const body = await c.req.json();

      // Validate input
      const parseResult = ChatInputSchema.safeParse(body);
      if (!parseResult.success) {
        return c.json(
          {
            error: "Invalid input",
            details: parseResult.error.errors,
          },
          400
        );
      }

      const { sessionId, message } = parseResult.data;

      // Generate session ID if not provided (use timestamp + random)
      const effectiveSessionId =
        sessionId || `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // Run agent loop
      const result = await runAgentLoop({
        sessionId: effectiveSessionId,
        message,
      });

      return c.json(result);
    } catch (error) {
      console.error("Chat endpoint error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: errorMessage }, 500);
    }
  });

  // Protect all internal API routes with shared-secret auth
  app.use("/internal/*", internalAuth());

  // Mount internal memory API
  app.route("/internal/memory", createMemoryApi());

  // Mount internal channel API (for send_message tool)
  const adapters = options?.channelAdapters ?? new Map<string, ChannelAdapter>();
  app.route("/internal/channel", createChannelApi(adapters));

  // Mount internal scheduler API
  app.route("/internal/scheduler", createSchedulerApi());

  // Mount internal tasks API
  app.route("/internal/tasks", createTasksApi());

  // Mount dashboard API
  app.route("/api", createDashboardApi());

  // Mount GitHub webhook (always available, signature verification optional)
  app.route("/webhooks/github", createGitHubWebhookRoutes());

  // Mount WhatsApp webhook if adapter is available
  if (options?.whatsappAdapter) {
    const whatsappRoutes = createWhatsAppWebhookRoutes(options.whatsappAdapter);
    app.route("/webhooks/whatsapp", whatsappRoutes);
  }

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: "Not found" }, 404);
  });

  // Error handler
  app.onError((err, c) => {
    console.error("Server error:", err);
    return c.json({ error: err.message }, 500);
  });

  return app;
}
