import * as fs from "node:fs";
import * as path from "node:path";
import { getMemoryConfig } from "@/memory/config.js";
import { getDb } from "@/memory/db/core.js";
import { insertSummary } from "@/memory/db/summaries.js";
import { embedBatch } from "@/memory/embeddings.js";
import type { SummaryIndexEntry } from "@/memory/types.js";

export async function migrateFromJsonl(): Promise<void> {
  const config = getMemoryConfig();
  const jsonlPath = path.join(config.storagePath, "index", "summaries.jsonl");

  if (!fs.existsSync(jsonlPath)) return;

  // Check if DB already has summaries (already migrated)
  const d = getDb();
  const count = d.prepare("SELECT COUNT(*) as cnt FROM summaries").get() as { cnt: number };
  if (count.cnt > 0) {
    // Already migrated, clean up JSONL
    fs.unlinkSync(jsonlPath);
    console.info("[Memory] JSONL already migrated, removed stale file");
    return;
  }

  // Read JSONL entries
  const content = fs.readFileSync(jsonlPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const entries: SummaryIndexEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as SummaryIndexEntry);
    } catch {
      console.warn("[Memory] Skipping malformed JSONL line during migration");
    }
  }

  if (entries.length === 0) {
    fs.unlinkSync(jsonlPath);
    return;
  }

  console.info(`[Memory] Migrating ${entries.length} summaries from JSONL to SQLite...`);

  // Batch embed all summaries
  const summaryTexts = entries.map((e) => e.summary);
  let embeddings: number[][] = [];
  try {
    embeddings = await embedBatch(summaryTexts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Memory] Failed to embed during migration (inserting without vectors): ${msg}`);
    embeddings = summaryTexts.map(() => []);
  }

  // Insert all entries
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as SummaryIndexEntry;
    const embedding = embeddings[i] ?? [];
    insertSummary(entry, embedding);
  }

  // Remove JSONL file
  fs.unlinkSync(jsonlPath);
  console.info(`[Memory] Migration complete: ${entries.length} summaries moved to SQLite`);
}
