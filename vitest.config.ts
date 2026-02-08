import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "src/.opencode/node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/index.ts",
        "src/**/types.ts",
        "src/.opencode/**",
        "src/types/**",
      ],
      reporter: ["text", "text-summary"],
    },
    // Feature-based test projects for parallel CI
    typecheck: {
      enabled: false,
    },
  },
});
