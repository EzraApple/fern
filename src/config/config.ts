import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import JSON5 from "json5";

export interface Config {
  model: {
    provider: string;
    model: string;
  };
  storage: {
    path: string;
  };
  server: {
    port: number;
    host: string;
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
  if (process.env["FERN_MODEL"]) {
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
    config.model.model = process.env["FERN_MODEL"];
  }
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  if (process.env["FERN_STORAGE_PATH"]) {
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
    config.storage.path = expandPath(process.env["FERN_STORAGE_PATH"]);
  }

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
