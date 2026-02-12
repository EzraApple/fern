import { getApiSecret } from "@/config/config.js";
import type { MiddlewareHandler } from "hono";

/**
 * Hono middleware that enforces shared-secret auth on internal API routes.
 * If FERN_API_SECRET is not configured, all requests are allowed (dev mode).
 */
export function internalAuth(): MiddlewareHandler {
  return async (c, next) => {
    const expected = getApiSecret();
    if (!expected) {
      return next();
    }

    const provided = c.req.header("X-Fern-Secret");
    if (!provided || provided !== expected) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return next();
  };
}
