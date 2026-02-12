import * as fs from "node:fs";
import * as path from "node:path";
import { getMemoryConfig } from "@/memory/config.js";
import type { ArchiveChunk, ArchiveWatermark } from "@/memory/types.js";

function getArchivesDir(threadId: string): string {
  const config = getMemoryConfig();
  return path.join(config.storagePath, "archives", threadId);
}

function getChunksDir(threadId: string): string {
  return path.join(getArchivesDir(threadId), "chunks");
}

function getWatermarkPath(threadId: string): string {
  return path.join(getArchivesDir(threadId), "watermark.json");
}

/** Create directory structure for a thread on first use */
export function ensureStorageDirectories(threadId: string): void {
  const chunksDir = getChunksDir(threadId);
  fs.mkdirSync(chunksDir, { recursive: true });
}

/** Read the archival watermark for a thread */
export function readWatermark(threadId: string): ArchiveWatermark | null {
  const watermarkPath = getWatermarkPath(threadId);
  try {
    const content = fs.readFileSync(watermarkPath, "utf-8");
    return JSON.parse(content) as ArchiveWatermark;
  } catch {
    return null;
  }
}

/** Write watermark atomically (temp file + rename) */
export function writeWatermark(threadId: string, watermark: ArchiveWatermark): void {
  const watermarkPath = getWatermarkPath(threadId);
  const tempPath = `${watermarkPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(watermark, null, 2));
  fs.renameSync(tempPath, watermarkPath);
}

/** Write an archive chunk to disk */
export function writeChunk(chunk: ArchiveChunk): void {
  ensureStorageDirectories(chunk.threadId);
  const chunkPath = path.join(getChunksDir(chunk.threadId), `${chunk.id}.json`);
  const tempPath = `${chunkPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(chunk));
  fs.renameSync(tempPath, chunkPath);
}

/** Read a chunk by ID */
export function readChunk(threadId: string, chunkId: string): ArchiveChunk | null {
  const chunkPath = path.join(getChunksDir(threadId), `${chunkId}.json`);
  try {
    const content = fs.readFileSync(chunkPath, "utf-8");
    return JSON.parse(content) as ArchiveChunk;
  } catch {
    return null;
  }
}
