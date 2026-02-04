import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { runAgentLoop } from "../core/index.js";

const ChatInputSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1, "Message cannot be empty"),
});

export function createServer() {
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

      // Run agent loop
      const result = await runAgentLoop({
        sessionId,
        message,
      });

      return c.json(result);
    } catch (error) {
      console.error("Chat endpoint error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: errorMessage }, 500);
    }
  });

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
