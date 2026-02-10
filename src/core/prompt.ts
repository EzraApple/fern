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

/** Generate tool descriptions from tool names (OpenCode auto-discovery) */
export function generateToolDescriptions(toolNames: string[]): string {
  return toolNames.map((name) => `- ${name}`).join("\n");
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

  scheduler: `## Channel: Scheduler
- This is an autonomous scheduled execution. No live user is in this session.
- Execute the prompt fully. Do not wait for interactive responses.
- If you need to reach a person, use \`send_message\` with the channel and user ID specified in the prompt.
- If required details are missing (e.g., no phone number or channel), complete gracefully and report what was missing via \`send_message\` if a contact channel was specified in the prompt.`,
};

/** Get channel-specific prompt addition */
export function getChannelPrompt(channelName: string, channelUserId?: string): string {
  let prompt = CHANNEL_PROMPTS[channelName] ?? "";
  if (channelUserId) {
    prompt += `\n\n## Current User\n- Channel: ${channelName}\n- User ID: ${channelUserId}`;
  }
  return prompt;
}

/** Assemble the full system prompt with tools and channel context */
export function buildSystemPrompt(
  toolNames: string[],
  channelName?: string,
  channelUserId?: string
): string {
  const base = loadBasePrompt();
  const toolDescriptions = generateToolDescriptions(toolNames);
  const channelContext = channelName ? getChannelPrompt(channelName, channelUserId) : "";

  return base.replace("{{TOOLS}}", toolDescriptions).replace("{{CHANNEL_CONTEXT}}", channelContext);
}
