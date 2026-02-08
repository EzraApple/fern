import OpenAI from "openai";
import { getOpenAIApiKey } from "../config/config.js";
import type { MemoryArchivalConfig, OpenCodeMessage } from "./types.js";

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: getOpenAIApiKey() });
  }
  return openaiClient;
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

/** Summarize a chunk of messages using gpt-4o-mini */
export async function summarizeChunk(
  messages: OpenCodeMessage[],
  config: MemoryArchivalConfig
): Promise<string> {
  const conversationText = formatMessagesForSummary(messages);

  try {
    const client = getOpenAI();
    const response = await client.chat.completions.create({
      model: config.summarizationModel,
      max_tokens: config.maxSummaryTokens,
      messages: [
        { role: "system", content: SUMMARIZATION_PROMPT },
        {
          role: "user",
          content: `Summarize this conversation chunk:\n\n${conversationText}`,
        },
      ],
    });

    const summary = response.choices[0]?.message?.content;
    if (!summary) {
      console.warn("[Memory] Summarization returned empty response");
      return `[Summary unavailable] ${messages.length} messages, ${messages[0]?.role || "unknown"} to ${messages[messages.length - 1]?.role || "unknown"}`;
    }

    return summary;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn("[Memory] Summarization failed:", errorMsg);
    return `[Summary unavailable: ${errorMsg}] ${messages.length} messages`;
  }
}
