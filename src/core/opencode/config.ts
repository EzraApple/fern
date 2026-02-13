import { getMoonshotApiKey, loadConfig } from "@/config/config.js";
import type { createOpencodeClient } from "@opencode-ai/sdk";

// Type for the OpenCode client
export type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

// Port range for server
export const PORT_START = 4096;
export const PORT_END = 4300;

// Track which ports are currently in use
export const usedPorts = new Set<number>();

/**
 * Find an available port for the server
 */
export function findAvailablePort(): number {
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }
  throw new Error(`No available ports in range ${PORT_START}-${PORT_END}`);
}

/**
 * OpenCode configuration for Fern
 *
 * Supports multiple LLM providers via env vars:
 *   FERN_MODEL_PROVIDER=moonshot|openai (default: openai)
 *   FERN_MODEL=kimi-k2.5|gpt-4o-mini|... (default: gpt-4o-mini)
 *   MOONSHOT_API_KEY — required when provider is moonshot
 *   OPENAI_API_KEY — always required (embeddings + fallback)
 */
export function getOpenCodeConfig() {
  const config = loadConfig();
  const moonshotKey = getMoonshotApiKey();

  // Build provider configurations
  const providerConfig: Record<
    string,
    {
      api?: string;
      options?: { apiKey?: string; baseURL?: string; [key: string]: unknown };
      models?: Record<
        string,
        {
          name?: string;
          tool_call?: boolean;
          attachment?: boolean;
          reasoning?: boolean;
          temperature?: boolean;
          limit?: { context: number; output: number };
          variants?: Record<string, { reasoning?: boolean; disabled?: boolean }>;
        }
      >;
    }
  > = {};

  // Always register OpenAI (needed for embeddings + fallback)
  providerConfig.openai = {
    options: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  };

  // Register Moonshot as OpenAI-compatible provider if API key is present
  if (moonshotKey) {
    providerConfig.moonshot = {
      api: "openai",
      options: {
        apiKey: moonshotKey,
        baseURL: "https://api.moonshot.ai/v1",
      },
      models: {
        "kimi-k2.5": {
          name: "Kimi K2.5",
          tool_call: true,
          attachment: false,
          reasoning: true,
          temperature: true,
          limit: {
            context: 131072,
            output: 8192,
          },
          variants: {
            fast: { reasoning: false },
          },
        },
      },
    };
  }

  // Determine active model in "provider/model" format
  const provider = config.model.provider;
  const model = config.model.model;
  const activeModel =
    provider !== "openai" && moonshotKey ? `${provider}/${model}` : `openai/${model}`;

  return {
    // Auto-share sessions for debugging
    share: "auto" as const,

    // Provider configuration
    provider: providerConfig,

    // Active model
    model: activeModel,

    // Default agent
    default_agent: "fern",

    // Custom agent definition — prompt.ts is the source of truth for prompt
    // composition; this is just a fallback for the OpenCode agent config.
    agent: {
      // Disable SDK built-in agents we don't use
      plan: { disable: true },
      build: { disable: true },
      title: { disable: true },
      summary: { disable: true },
      compaction: { disable: true },

      fern: {
        description: "Fern AI assistant with multi-channel support",
        prompt: "You are Fern, a helpful AI assistant.",
      },
      explore: {
        description: "Read-only codebase exploration agent",
        mode: "subagent" as const,
        hidden: true,
        steps: 20,
        variant: "fast",
        prompt:
          "You are a codebase exploration agent. Search code, read files, and report findings. Be surgical — find the relevant files, read them, and stop. When you have enough information, write your response immediately.",
        permission: {
          read: "allow" as const,
          grep: "allow" as const,
          glob: "allow" as const,
          bash: "deny" as const,
          edit: "deny" as const,
          write: "deny" as const,
          webfetch: "deny" as const,
        },
      },
      research: {
        description: "Web research and synthesis agent",
        mode: "subagent" as const,
        hidden: true,
        steps: 35,
        prompt:
          "You are a research agent. Search the web, read documentation, and synthesize findings into clear, actionable information. Be thorough but concise.",
        permission: {
          read: "allow" as const,
          grep: "allow" as const,
          glob: "allow" as const,
          bash: "deny" as const,
          edit: "deny" as const,
          write: "deny" as const,
          webfetch: "allow" as const,
        },
      },
      general: {
        description: "General-purpose subagent for broad tasks",
        mode: "subagent" as const,
        hidden: true,
        steps: 40,
        prompt:
          "You are a general-purpose agent. Complete the assigned task thoroughly using whatever tools are appropriate.",
        permission: {
          read: "allow" as const,
          grep: "allow" as const,
          glob: "allow" as const,
          bash: "allow" as const,
          edit: "allow" as const,
          write: "allow" as const,
          webfetch: "allow" as const,
        },
      },
    },

    // Tool configuration
    tools: {
      bash: true,
      edit: true,
      write: true,
      read: true,
      grep: true,
      glob: true,
    },

    // Auto-approve all tool permissions (we're running as automated agent)
    permission: {
      skill: {
        "*": "allow" as const,
      },
      edit: "allow" as const,
      bash: "allow" as const,
      webfetch: "allow" as const,
      doom_loop: "allow" as const,
      external_directory: "allow" as const,
    },
  };
}
