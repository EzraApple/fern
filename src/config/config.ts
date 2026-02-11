import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import JSON5 from "json5";

export interface Config {
  model: {
    provider: string;
    model: string;
    baseUrl?: string;
  };
  storage: {
    path: string;
  };
  server: {
    port: number;
    host: string;
  };
  github?: {
    appId?: string;
    privateKey?: string;
    installationId?: string;
  };
  workspaces?: {
    basePath?: string;
    maxAgeMs?: number;
  };
  memory?: {
    enabled?: boolean;
    storagePath?: string;
  };
}

const DEFAULT_CONFIG: Config = {
  model: {
    provider: "openai",
    model: "gpt-4o-mini",
  },
  storage: {
    path: path.join(os.homedir(), ".fern", "sessions"),
  },
  server: {
    port: 4000,
    host: "127.0.0.1",
  },
};

let cachedConfig: Config | null = null;

function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function loadConfigFile(configPath: string): Partial<Config> {
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON5.parse(content);
  } catch {
    return {};
  }
}

function mergeConfig(base: Config, override: Partial<Config>): Config {
  return {
    model: { ...base.model, ...override.model },
    storage: { ...base.storage, ...override.storage },
    server: { ...base.server, ...override.server },
  };
}

export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  let config = { ...DEFAULT_CONFIG };

  // Load from project config/config.json5
  const projectConfigPath = path.join(process.cwd(), "config", "config.json5");
  const projectConfig = loadConfigFile(projectConfigPath);
  config = mergeConfig(config, projectConfig);

  // Expand storage path
  config.storage.path = expandPath(config.storage.path);

  // Environment variable overrides
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  if (process.env["FERN_PORT"]) {
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
    config.server.port = Number.parseInt(process.env["FERN_PORT"], 10);
  }
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  if (process.env["FERN_MODEL_PROVIDER"]) {
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
    config.model.provider = process.env["FERN_MODEL_PROVIDER"];
  }
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  if (process.env["FERN_MODEL"]) {
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
    config.model.model = process.env["FERN_MODEL"];
  }
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  if (process.env["FERN_MODEL_BASE_URL"]) {
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
    config.model.baseUrl = process.env["FERN_MODEL_BASE_URL"];
  }
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  if (process.env["FERN_STORAGE_PATH"]) {
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
    config.storage.path = expandPath(process.env["FERN_STORAGE_PATH"]);
  }

  // Add GitHub config from environment
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const githubAppId = process.env["GITHUB_APP_ID"];
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const githubPrivateKey = process.env["GITHUB_APP_PRIVATE_KEY"];
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const githubInstallationId = process.env["GITHUB_APP_INSTALLATION_ID"];

  if (githubAppId && githubPrivateKey && githubInstallationId) {
    config.github = {
      appId: githubAppId,
      privateKey: githubPrivateKey,
      installationId: githubInstallationId,
    };
  }

  // Add workspace config
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const workspaceBasePath = process.env["WORKSPACE_BASE_PATH"];
  config.workspaces = {
    basePath: workspaceBasePath,
    maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
  };

  // Add memory config
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const memoryEnabled = process.env["FERN_MEMORY_ENABLED"];
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const memoryPath = process.env["FERN_MEMORY_PATH"];
  config.memory = {
    enabled: memoryEnabled !== "false",
    storagePath: memoryPath,
  };

  cachedConfig = config;
  return config;
}

export function getOpenAIApiKey(): string {
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const key = process.env["OPENAI_API_KEY"];
  if (!key) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return key;
}

export function getMoonshotApiKey(): string | undefined {
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  return process.env["MOONSHOT_API_KEY"];
}

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

/** Returns Twilio credentials if all env vars are set, otherwise null */
export function getTwilioCredentials(): TwilioCredentials | null {
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const fromNumber = process.env["TWILIO_WHATSAPP_FROM"];

  if (!accountSid || !authToken || !fromNumber) {
    return null;
  }

  return { accountSid, authToken, fromNumber };
}

/** Returns the internal API shared secret, or null if not set */
export function getApiSecret(): string | null {
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  return process.env["FERN_API_SECRET"] || null;
}

/** Returns the public webhook base URL for Twilio signature verification, or null if not set */
export function getWebhookBaseUrl(): string | null {
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  return process.env["FERN_WEBHOOK_URL"] || null;
}
