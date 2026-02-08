import { getOpenAIApiKey } from "../config/config.js";
import { getMemoryConfig } from "./config.js";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

/** Embed a single text string into a vector */
export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text]);
  return vec ?? [];
}

/** Embed multiple texts in a single API call */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const config = getMemoryConfig();
  const apiKey = getOpenAIApiKey();

  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      input: texts,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embeddings failed: ${res.status} ${body}`);
  }

  const payload = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const data = payload.data ?? [];
  return data.map((entry) => entry.embedding ?? []);
}
