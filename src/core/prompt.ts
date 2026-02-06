import * as fs from "node:fs";
import * as path from "node:path";

let cachedBasePrompt: string | null = null;

/** Load the base system prompt from config/SYSTEM_PROMPT.md */
export function loadBasePrompt(): string {
  if (cachedBasePrompt) return cachedBasePrompt;
  const promptPath = path.join(process.cwd(), "config", "SYSTEM_PROMPT.md");
  cachedBasePrompt = fs.readFileSync(promptPath, "utf-8");
  return cachedBasePrompt;
}

/** Generate tool descriptions from the AI SDK tool registry */
export function generateToolDescriptions(tools: Record<string, { description?: string }>): string {
  return Object.entries(tools)
    .map(([name, t]) => `- ${name}: ${t.description ?? "No description"}`)
    .join("\n");
}

const CHANNEL_PROMPTS: Record<string, string> = {
  whatsapp: `## Channel: WhatsApp
- plain text only, no markdown
- no capitalization unless for emphasis
- keep messages short, a few sentences max
- use dashes for lists
- minimal emojis
- lead with the key point, expand only if asked`,

  webchat: `## Channel: WebChat
Tone: Professional but approachable.
Formatting: Full markdown supported, including code blocks and tables.`,
};

/** Get channel-specific prompt addition */
export function getChannelPrompt(channelName: string): string {
  return CHANNEL_PROMPTS[channelName] ?? "";
}

/** Assemble the full system prompt with tools and channel context */
export function buildSystemPrompt(
  tools: Record<string, { description?: string }>,
  channelName?: string
): string {
  const base = loadBasePrompt();
  const toolDescriptions = generateToolDescriptions(tools);
  const channelContext = channelName ? getChannelPrompt(channelName) : "";

  return base.replace("{{TOOLS}}", toolDescriptions).replace("{{CHANNEL_CONTEXT}}", channelContext);
}
