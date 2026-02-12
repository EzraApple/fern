import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/config.js", () => ({
  getApiSecret: vi.fn(),
}));

import { getApiSecret } from "@/config/config.js";
import { internalAuth } from "@/server/internal-auth.js";
import { Hono } from "hono";

const mockGetApiSecret = vi.mocked(getApiSecret);

describe("internalAuth middleware", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.use("/internal/*", internalAuth());
    app.get("/internal/test", (c) => c.json({ ok: true }));
    app.get("/health", (c) => c.json({ status: "ok" }));
  });

  it("allows request with valid secret", async () => {
    mockGetApiSecret.mockReturnValue("test-secret");
    const res = await app.request("/internal/test", {
      headers: { "X-Fern-Secret": "test-secret" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 401 for invalid secret", async () => {
    mockGetApiSecret.mockReturnValue("test-secret");
    const res = await app.request("/internal/test", {
      headers: { "X-Fern-Secret": "wrong-secret" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when secret header is missing", async () => {
    mockGetApiSecret.mockReturnValue("test-secret");
    const res = await app.request("/internal/test");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("allows all requests when no secret is configured (dev mode)", async () => {
    mockGetApiSecret.mockReturnValue(null);
    const res = await app.request("/internal/test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("does not affect non-internal routes", async () => {
    mockGetApiSecret.mockReturnValue("test-secret");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
