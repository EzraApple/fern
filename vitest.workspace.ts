import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "memory",
      include: ["src/memory/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "workspace-github",
      include: [
        "src/core/workspace.test.ts",
        "src/core/workspace-git.test.ts",
        "src/core/github-service.test.ts",
      ],
      environment: "node",
    },
  },
  {
    test: {
      name: "server-channels",
      include: [
        "src/server/**/*.test.ts",
        "src/channels/**/*.test.ts",
      ],
      environment: "node",
    },
  },
  {
    test: {
      name: "core-tools",
      include: [
        "src/core/agent.test.ts",
        "src/core/prompt.test.ts",
        "src/config/**/*.test.ts",
      ],
      environment: "node",
    },
  },
]);
