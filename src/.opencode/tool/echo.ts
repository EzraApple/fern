import { tool } from "@opencode-ai/plugin";

export const echo = tool({
  description:
    "Echoes back the input text exactly as provided. Only useful for testing tool execution — don't use this to communicate with the user (just respond directly instead).",
  args: {
    text: tool.schema.string().describe("The text to echo back"),
  },
  async execute(args) {
    return args.text;
  },
});
