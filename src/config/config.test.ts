import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use a mutable ref so we can control mock behavior per-test
const mockReadFileSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("loadConfig", () => {
    it("should return default config when no config file or env vars", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.model.provider).toBe("openai");
      expect(config.model.model).toBe("gpt-4o-mini");
      expect(config.server.port).toBe(4000);
      expect(config.server.host).toBe("127.0.0.1");
      expect(config.storage.path).toContain(".fern");
      expect(config.storage.path).toContain("sessions");
    });

    it("should override port with FERN_PORT env var", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.stubEnv("FERN_PORT", "5000");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.server.port).toBe(5000);
    });

    it("should override model with FERN_MODEL env var", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.stubEnv("FERN_MODEL", "gpt-4o");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.model.model).toBe("gpt-4o");
    });

    it("should override storage path with FERN_STORAGE_PATH env var", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.stubEnv("FERN_STORAGE_PATH", "/tmp/fern-test");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.storage.path).toBe("/tmp/fern-test");
    });

    it("should expand ~ in FERN_STORAGE_PATH", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.stubEnv("FERN_STORAGE_PATH", "~/my-sessions");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.storage.path).toBe(`${os.homedir()}/my-sessions`);
      expect(config.storage.path).not.toContain("~");
    });

    it("should merge config file values with defaults", async () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          model: { model: "gpt-4" },
          server: { port: 8080 },
        })
      );
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      // Overridden by config file
      expect(config.model.model).toBe("gpt-4");
      expect(config.server.port).toBe(8080);
      // Defaults preserved
      expect(config.model.provider).toBe("openai");
      expect(config.server.host).toBe("127.0.0.1");
    });

    it("should cache config after first load", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const { loadConfig } = await import("./config.js");

      const first = loadConfig();
      const second = loadConfig();

      expect(first).toBe(second);
      // readFileSync called only once for config file (cached after first)
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });

    it("should set GitHub config when all env vars present", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.stubEnv("GITHUB_APP_ID", "12345");
      vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "secret-key");
      vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "67890");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.github).toEqual({
        appId: "12345",
        privateKey: "secret-key",
        installationId: "67890",
      });
    });

    it("should not set GitHub config when env vars are missing", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.stubEnv("GITHUB_APP_ID", "12345");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.github).toBeUndefined();
    });

    it("should set memory config defaults", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.memory).toBeDefined();
      expect(config.memory?.enabled).toBe(true);
    });

    it("should disable memory when FERN_MEMORY_ENABLED is 'false'", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.stubEnv("FERN_MEMORY_ENABLED", "false");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.memory?.enabled).toBe(false);
    });

    it("should set memory storage path from env var", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.stubEnv("FERN_MEMORY_PATH", "/tmp/fern-memory");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.memory?.storagePath).toBe("/tmp/fern-memory");
    });

    it("should set workspace config with default maxAgeMs", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.workspaces).toBeDefined();
      expect(config.workspaces?.maxAgeMs).toBe(24 * 60 * 60 * 1000);
    });

    it("should set workspace base path from env var", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.stubEnv("WORKSPACE_BASE_PATH", "/tmp/workspaces");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      expect(config.workspaces?.basePath).toBe("/tmp/workspaces");
    });

    it("should prefer env vars over config file values", async () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          server: { port: 8080 },
          model: { model: "gpt-3.5" },
        })
      );
      vi.stubEnv("FERN_PORT", "9090");
      vi.stubEnv("FERN_MODEL", "gpt-4o");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();

      // Env vars override config file
      expect(config.server.port).toBe(9090);
      expect(config.model.model).toBe("gpt-4o");
    });
  });

  describe("getOpenAIApiKey", () => {
    it("should return the API key when set", async () => {
      mockReadFileSync.mockReturnValue("{}");
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-123");
      const { getOpenAIApiKey } = await import("./config.js");

      const key = getOpenAIApiKey();

      expect(key).toBe("sk-test-key-123");
    });

    it("should throw when OPENAI_API_KEY is not set", async () => {
      mockReadFileSync.mockReturnValue("{}");
      vi.stubEnv("OPENAI_API_KEY", "");
      const { getOpenAIApiKey } = await import("./config.js");

      expect(() => getOpenAIApiKey()).toThrow("OPENAI_API_KEY environment variable is not set");
    });
  });

  describe("getTwilioCredentials", () => {
    it("should return credentials when all env vars are set", async () => {
      mockReadFileSync.mockReturnValue("{}");
      vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
      vi.stubEnv("TWILIO_AUTH_TOKEN", "auth-token");
      vi.stubEnv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886");
      const { getTwilioCredentials } = await import("./config.js");

      const creds = getTwilioCredentials();

      expect(creds).toEqual({
        accountSid: "AC123",
        authToken: "auth-token",
        fromNumber: "whatsapp:+14155238886",
      });
    });

    it("should return null when account SID is missing", async () => {
      mockReadFileSync.mockReturnValue("{}");
      vi.stubEnv("TWILIO_AUTH_TOKEN", "auth-token");
      vi.stubEnv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886");
      const { getTwilioCredentials } = await import("./config.js");

      const creds = getTwilioCredentials();

      expect(creds).toBeNull();
    });

    it("should return null when auth token is missing", async () => {
      mockReadFileSync.mockReturnValue("{}");
      vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
      vi.stubEnv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886");
      const { getTwilioCredentials } = await import("./config.js");

      const creds = getTwilioCredentials();

      expect(creds).toBeNull();
    });

    it("should return null when from number is missing", async () => {
      mockReadFileSync.mockReturnValue("{}");
      vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
      vi.stubEnv("TWILIO_AUTH_TOKEN", "auth-token");
      const { getTwilioCredentials } = await import("./config.js");

      const creds = getTwilioCredentials();

      expect(creds).toBeNull();
    });

    it("should return null when no env vars are set", async () => {
      mockReadFileSync.mockReturnValue("{}");
      const { getTwilioCredentials } = await import("./config.js");

      const creds = getTwilioCredentials();

      expect(creds).toBeNull();
    });
  });
});
