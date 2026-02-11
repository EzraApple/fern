import { tool } from "@opencode-ai/plugin";

export const time = tool({
  description:
    "Returns the current date and time in ISO 8601 UTC. Use when you need the actual current time — for scheduling, timestamps, or answering time questions. Don't guess the time from context; call this tool.",
  args: {},
  async execute() {
    return new Date().toISOString();
  },
});
