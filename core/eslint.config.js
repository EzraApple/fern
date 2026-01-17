import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  module: "readonly",
  require: "readonly",
  exports: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  setImmediate: "readonly",
  clearImmediate: "readonly",
  global: "readonly",
  NodeJS: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  fetch: "readonly",
  Request: "readonly",
  Response: "readonly",
  Headers: "readonly",
  FormData: "readonly",
  RequestInit: "readonly",
  AbortController: "readonly",
  AbortSignal: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  ReadableStream: "readonly",
  Blob: "readonly",
};

export default [
  eslint.configs.recommended,
  // Main TypeScript config
  {
    files: ["src/**/*.ts"],
    ignores: ["src/services/**", "src/types/**", "src/constants/**", "src/agents/**", "src/config/**"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: nodeGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-undef": "off",
    },
  },
  // Integration/types/constants/services files - relax unused-vars since they export APIs used by OpenCode tools
  {
    files: ["src/services/**/*.ts", "src/types/**/*.ts", "src/constants/**/*.ts", "src/agents/**/*.ts", "src/config/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: nodeGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off", // These are API modules - exports may be used by OpenCode tools
      "no-undef": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "src/.opencode-runtime/**"],
  },
];
