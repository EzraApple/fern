import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConfigSchema } from "@/types/index.js";

describe("ConfigSchema", () => {
  describe("default values", () => {
    it("should use default Ollama base URL when not provided", () => {
      const rawConfig = {
        ollama: {
          model: "test-model",
        },
        openai: {},
        github: {},
        webhook: { port: 7829 },
      };

      const result = ConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ollama.baseUrl).toBe("http://localhost:11434");
      }
    });

    it("should use default Ollama model when not provided", () => {
      const rawConfig = {
        ollama: {
          baseUrl: "http://localhost:11434",
        },
        openai: {},
        github: {},
        webhook: { port: 7829 },
      };

      const result = ConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ollama.model).toBe("qwen3-vl:32b");
      }
    });

    it("should use all defaults for Ollama when not provided", () => {
      const rawConfig = {
        ollama: {},
        openai: {},
        github: {},
        webhook: { port: 7829 },
      };

      const result = ConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ollama.baseUrl).toBe("http://localhost:11434");
        expect(result.data.ollama.model).toBe("qwen3-vl:32b");
      }
    });
  });

  describe("validation", () => {
    it("should accept valid config with all required fields", () => {
      const rawConfig = {
        ollama: {
          baseUrl: "http://custom:11434",
          model: "custom-model:7b",
        },
        openai: {
          apiKey: "sk-test-key",
        },
        github: {
          token: "ghp_test",
          appId: "12345",
          appPrivateKey: "-----BEGIN RSA PRIVATE KEY-----",
          appInstallationId: "67890",
        },
        webhook: { port: 8080 },
      };

      const result = ConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ollama.baseUrl).toBe("http://custom:11434");
        expect(result.data.ollama.model).toBe("custom-model:7b");
        expect(result.data.openai.apiKey).toBe("sk-test-key");
        expect(result.data.github.token).toBe("ghp_test");
        expect(result.data.webhook.port).toBe(8080);
      }
    });

    it("should allow optional OpenAI API key", () => {
      const rawConfig = {
        ollama: {},
        openai: {},
        github: {},
        webhook: { port: 7829 },
      };

      const result = ConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.openai.apiKey).toBeUndefined();
      }
    });

    it("should allow optional GitHub fields", () => {
      const rawConfig = {
        ollama: {},
        openai: {},
        github: {},
        webhook: { port: 7829 },
      };

      const result = ConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.github.token).toBeUndefined();
        expect(result.data.github.appId).toBeUndefined();
        expect(result.data.github.appPrivateKey).toBeUndefined();
        expect(result.data.github.appInstallationId).toBeUndefined();
      }
    });

    it("should require webhook port", () => {
      const rawConfig = {
        ollama: {},
        openai: {},
        github: {},
        webhook: {},
      };

      const result = ConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(false);
    });

    it("should validate port as number", () => {
      const rawConfig = {
        ollama: {},
        openai: {},
        github: {},
        webhook: { port: "not-a-number" },
      };

      const result = ConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(false);
    });
  });

  describe("Phase 3: Ollama configuration", () => {
    it("should allow Ollama config without OpenAI API key (local-first mode)", () => {
      const rawConfig = {
        ollama: {
          baseUrl: "http://localhost:11434",
          model: "qwen3-vl:32b",
        },
        openai: {},
        github: {},
        webhook: { port: 7829 },
      };

      const result = ConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.openai.apiKey).toBeUndefined();
        expect(result.data.ollama.baseUrl).toBe("http://localhost:11434");
        expect(result.data.ollama.model).toBe("qwen3-vl:32b");
      }
    });

    it("should allow both Ollama and OpenAI config (hybrid mode)", () => {
      const rawConfig = {
        ollama: {
          baseUrl: "http://localhost:11434",
          model: "qwen3-vl:32b",
        },
        openai: {
          apiKey: "sk-test-key",
        },
        github: {},
        webhook: { port: 7829 },
      };

      const result = ConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.openai.apiKey).toBe("sk-test-key");
        expect(result.data.ollama.baseUrl).toBe("http://localhost:11434");
      }
    });
  });
});
