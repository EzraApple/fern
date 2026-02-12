import { getMoonshotApiKey, getOpenAIApiKey } from "@/config/config.js";
import type { MemoryArchivalConfig, OpenCodeMessage } from "@/memory/types.js";
import OpenAI from "openai";

let primaryClient: OpenAI | null = null;
let fallbackClient: OpenAI | null = null;
let initialized = false;

function initClients(config: MemoryArchivalConfig): void {
  if (initialized) return;

  const moonshotKey = getMoonshotApiKey();

  if (moonshotKey && config.summarizationModel.startsWith("kimi")) {
    // Primary: Moonshot (OpenAI-compatible)
    primaryClient = new OpenAI({
      apiKey: moonshotKey,
      baseURL: config.summarizationBaseUrl ?? "https://api.moonshot.ai/v1",
    });
    // Fallback: OpenAI
    fallbackClient = new OpenAI({ apiKey: getOpenAIApiKey() });
  } else {
    // No Moonshot — OpenAI is primary, no fallback needed
    primaryClient = new OpenAI({ apiKey: getOpenAIApiKey() });
    fallbackClient = null;
  }

  initialized = true;
}

const SUMMARIZATION_PROMPT = `You are a conversation summarizer for an AI agent's memory system. Your job is to produce a concise summary of a conversation chunk that will be used for future retrieval.

Focus on:
- Key decisions made and their reasoning
- Topics discussed and conclusions reached
- Tool operations performed and their outcomes (file paths, commands, results)
- User preferences, requirements, or constraints expressed
- Proper nouns, file paths, URLs, code references, and technical details
- Any commitments or action items

Keep the summary under 300 words. Write in past tense. Be specific — include names, paths, and values rather than vague references.`;

/** Format messages into readable text for the summarization prompt */
function formatMessagesForSummary(messages: OpenCodeMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : "Assistant";

    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        lines.push(`[${role}]: ${part.text}`);
      } else if (part.type === "tool" && part.tool) {
        const status = part.state?.status || "unknown";
        const input = part.state?.input ? JSON.stringify(part.state.input).slice(0, 200) : "";
        const output = part.state?.output ? part.state.output.slice(0, 300) : "";
        lines.push(`[Tool: ${part.tool}] (${status}) input=${input}`);
        if (output) {
          lines.push(`  → ${output}`);
        }
      }
    }
  }

  return lines.join("\n");
}

/** Summarize a chunk of messages, with fallback from Moonshot to OpenAI */
export async function summarizeChunk(
  messages: OpenCodeMessage[],
  config: MemoryArchivalConfig
): Promise<string> {
  initClients(config);
  const conversationText = formatMessagesForSummary(messages);
  const promptMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SUMMARIZATION_PROMPT },
    { role: "user", content: `Summarize this conversation chunk:\n\n${conversationText}` },
  ];

  // Try primary (Moonshot or OpenAI depending on config)
  try {
    const response = await primaryClient?.chat.completions.create({
      model: config.summarizationModel,
      max_tokens: config.maxSummaryTokens,
      messages: promptMessages,
    });

    const summary = response?.choices[0]?.message?.content;
    if (summary) return summary;

    console.warn("[Memory] Primary summarization returned empty response");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[Memory] Primary summarization failed (${config.summarizationModel}): ${errorMsg}`
    );
  }

  // Try fallback (OpenAI gpt-4o-mini) if available
  if (fallbackClient) {
    try {
      console.info("[Memory] Falling back to OpenAI gpt-4o-mini for summarization");
      const response = await fallbackClient.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: config.maxSummaryTokens,
        messages: promptMessages,
      });

      const summary = response.choices[0]?.message?.content;
      if (summary) return summary;

      console.warn("[Memory] Fallback summarization returned empty response");
    } catch (fallbackError) {
      const fallbackMsg =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      console.warn(`[Memory] Fallback summarization also failed: ${fallbackMsg}`);
    }
  }

  // Both failed
  return `[Summary unavailable] ${messages.length} messages, ${messages[0]?.role || "unknown"} to ${messages[messages.length - 1]?.role || "unknown"}`;
}
