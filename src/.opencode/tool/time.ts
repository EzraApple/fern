import { tool } from "@opencode-ai/plugin";

export const time = tool({
  description:
    "Returns the current date and time. Use this when the user asks about the current time, date, or needs a timestamp.",
  args: {},
  async execute() {
    return new Date().toISOString();
  },
});
