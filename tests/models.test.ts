import { describe, it, expect } from "vitest";
import {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  TaskModels,
  parseModelString,
  DEFAULT_MODEL,
} from "@/constants/models.js";

describe("Models Constants", () => {
  describe("DEFAULT_OLLAMA_MODEL", () => {
    it("should be qwen3-vl:32b", () => {
      expect(DEFAULT_OLLAMA_MODEL).toBe("qwen3-vl:32b");
    });
  });

  describe("DEFAULT_OLLAMA_BASE_URL", () => {
    it("should point to localhost with /v1 path", () => {
      expect(DEFAULT_OLLAMA_BASE_URL).toBe("http://localhost:11434/v1");
    });

    it("should use port 11434 (default Ollama port)", () => {
      expect(DEFAULT_OLLAMA_BASE_URL).toContain(":11434");
    });
  });

  describe("TaskModels", () => {
    it("should have coding task model", () => {
      expect(TaskModels.coding).toBeDefined();
      expect(TaskModels.coding).toContain("ollama/");
    });

    it("should have general task model", () => {
      expect(TaskModels.general).toBeDefined();
      expect(TaskModels.general).toContain("ollama/");
    });

    it("should have summarization task model", () => {
      expect(TaskModels.summarization).toBeDefined();
      expect(TaskModels.summarization).toContain("ollama/");
    });

    it("should have vision task model", () => {
      expect(TaskModels.vision).toBeDefined();
      expect(TaskModels.vision).toContain("ollama/");
    });

    it("should use Ollama provider for all task types (Phase 3 requirement)", () => {
      const taskTypes = Object.keys(TaskModels) as (keyof typeof TaskModels)[];
      for (const taskType of taskTypes) {
        expect(TaskModels[taskType]).toMatch(/^ollama\//);
      }
    });

    it("should use qwen3-vl:32b as default model for all tasks", () => {
      const taskTypes = Object.keys(TaskModels) as (keyof typeof TaskModels)[];
      for (const taskType of taskTypes) {
        expect(TaskModels[taskType]).toBe(`ollama/${DEFAULT_OLLAMA_MODEL}`);
      }
    });
  });

  describe("DEFAULT_MODEL", () => {
    it("should equal TaskModels.coding", () => {
      expect(DEFAULT_MODEL).toBe(TaskModels.coding);
    });

    it("should use Ollama provider", () => {
      expect(DEFAULT_MODEL).toMatch(/^ollama\//);
    });
  });

  describe("parseModelString", () => {
    it("should parse provider and model from valid string", () => {
      const result = parseModelString("ollama/qwen3-vl:32b");
      expect(result.provider).toBe("ollama");
      expect(result.model).toBe("qwen3-vl:32b");
    });

    it("should parse OpenAI-style model string", () => {
      const result = parseModelString("openai/gpt-4o");
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o");
    });

    it("should handle model names with colons", () => {
      const result = parseModelString("ollama/llama3:8b-instruct");
      expect(result.provider).toBe("ollama");
      expect(result.model).toBe("llama3:8b-instruct");
    });

    it("should handle model names with multiple slashes (only takes first two parts)", () => {
      // Current implementation only takes first two parts of the split
      // "provider/org/model" becomes provider="provider", model="org"
      const result = parseModelString("provider/org/model");
      expect(result.provider).toBe("provider");
      expect(result.model).toBe("org");
    });

    it("should throw error for string without slash", () => {
      expect(() => parseModelString("invalid-model")).toThrow(
        "Invalid model string: invalid-model"
      );
    });

    it("should throw error for empty provider", () => {
      expect(() => parseModelString("/model")).toThrow(
        "Invalid model string: /model"
      );
    });

    it("should throw error for empty model", () => {
      expect(() => parseModelString("provider/")).toThrow(
        "Invalid model string: provider/"
      );
    });

    it("should throw error for empty string", () => {
      expect(() => parseModelString("")).toThrow("Invalid model string:");
    });
  });
});
