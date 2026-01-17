import { logger } from "@/config/index.js";

/**
 * Simple in-memory cache for local operation.
 * Replaces the Upstash Redis cache for serverless.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Generic cache get
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

/**
 * Generic cache set
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds = 3600
): Promise<void> {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Generic cache delete
 */
export async function cacheDelete(key: string): Promise<void> {
  cache.delete(key);
}

/**
 * Clear expired entries (can be called periodically)
 */
export function cleanupExpiredEntries(): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info(`[Cache] Cleaned up ${cleaned} expired entries`);
  }
}
