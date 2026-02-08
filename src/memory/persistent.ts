import { ulid } from "ulid";
import {
  deleteMemory as dbDeleteMemory,
  listMemories as dbListMemories,
  getMemoryById,
  insertMemory,
} from "./db.js";
import { embedText } from "./embeddings.js";
import type { PersistentMemory } from "./types.js";

/** Write a new persistent memory (embeds and stores in DB) */
export async function writeMemory(params: {
  type: PersistentMemory["type"];
  content: string;
  tags: string[];
}): Promise<PersistentMemory> {
  const now = new Date().toISOString();
  const memory: PersistentMemory = {
    id: `mem_${ulid()}`,
    type: params.type,
    content: params.content,
    tags: params.tags,
    createdAt: now,
    updatedAt: now,
  };

  const embedding = await embedText(params.content);
  insertMemory(memory, embedding);

  return memory;
}

/** Delete a persistent memory by ID */
export function deleteMemory(id: string): boolean {
  return dbDeleteMemory(id);
}

/** Get a persistent memory by ID */
export function getMemory(id: string): PersistentMemory | null {
  return getMemoryById(id);
}

/** List persistent memories with optional filters */
export function listMemories(options?: {
  type?: PersistentMemory["type"];
  limit?: number;
}): PersistentMemory[] {
  return dbListMemories(options);
}
