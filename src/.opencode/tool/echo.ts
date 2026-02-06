import { tool } from "@opencode-ai/plugin";

export const echo = tool({
  description:
    "Echoes back the input text exactly as provided. Use this to test tool execution or repeat information back to the user.",
  args: {
    text: tool.schema.string().describe("The text to echo back"),
  },
  async execute(args) {
    return args.text;
  },
});
