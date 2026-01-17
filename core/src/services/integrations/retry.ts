/**
 * Shared retry utility with 429 (rate limit) handling
 *
 * Note (Kevin, 2026-01-04): Centralized retry logic for all integrations
 */

import { logger } from "@/config/index.js";

// ============================================================================
// Configuration
// ============================================================================

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries (default: 30000) */
  maxDelayMs?: number;
  /** Maximum total wait time for rate limits in ms (default: 60000) */
  maxRateLimitWaitMs?: number;
  /** Integration name for logging */
  integrationName?: string;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  maxRateLimitWaitMs: 60000,
  integrationName: "API",
};

// ============================================================================
// Utilities
// ============================================================================

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay({
  attempt,
  initialDelayMs,
  maxDelayMs,
}: {
  attempt: number;
  initialDelayMs: number;
  maxDelayMs: number;
}): number {
  // Exponential backoff: initialDelay * 2^attempt with jitter
  const exponentialDelay = initialDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Check if an error is a rate limit error (429)
 */
function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("429") ||
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("ratelimit")
    );
  }
  return false;
}

/**
 * Extract retry-after value from error or response
 * Returns milliseconds to wait, or null if not found
 */
function extractRetryAfter(error: unknown): number | null {
  if (error instanceof Error) {
    // Check for Retry-After in error message (some APIs include it)
    const retryAfterMatch = error.message.match(/retry[- ]?after[:\s]+(\d+)/i);
    if (retryAfterMatch) {
      const seconds = parseInt(retryAfterMatch[1], 10);
      return seconds * 1000;
    }
  }
  return null;
}

/**
 * Check if an error is retryable (not a client error except 429)
 */
function isRetryableError(error: unknown): boolean {
  // Rate limits are always retryable
  if (isRateLimitError(error)) return true;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Don't retry client errors (4xx) except 429
    if (message.includes("400") || message.includes("bad request")) return false;
    if (message.includes("401") || message.includes("unauthorized")) return false;
    if (message.includes("403") || message.includes("forbidden")) return false;
    if (message.includes("404") || message.includes("not found")) return false;
    if (message.includes("422") || message.includes("unprocessable")) return false;

    // Retry server errors (5xx)
    if (message.includes("500") || message.includes("internal server")) return true;
    if (message.includes("502") || message.includes("bad gateway")) return true;
    if (message.includes("503") || message.includes("service unavailable")) return true;
    if (message.includes("504") || message.includes("gateway timeout")) return true;

    // Retry network errors
    if (message.includes("econnreset") || message.includes("econnrefused")) return true;
    if (message.includes("etimedout") || message.includes("timeout")) return true;
    if (message.includes("socket hang up")) return true;
  }

  // Default: don't retry unknown errors
  return false;
}

// ============================================================================
// Main Retry Function
// ============================================================================

/**
 * Execute a function with retry logic and rate limit handling
 *
 * @example
 * const result = await withRetry(
 *   () => client.issues.get(issueId),
 *   { integrationName: "Linear", maxRetries: 3 }
 * );
 */
export async function withRetry<T>({
  fn,
  config = {},
}: {
  fn: () => Promise<T>;
  config?: RetryConfig;
}): Promise<T> {
  const opts = { ...DEFAULT_CONFIG, ...config };
  const { maxRetries, initialDelayMs, maxDelayMs, maxRateLimitWaitMs, integrationName } = opts;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if it's a rate limit error
      if (isRateLimitError(error)) {
        const retryAfter = extractRetryAfter(error);
        const waitTime = retryAfter ?? getBackoffDelay({ attempt, initialDelayMs, maxDelayMs });

        // Check if wait time is reasonable
        if (waitTime > maxRateLimitWaitMs) {
          logger.warn(
            `[${integrationName}] Rate limit wait time (${waitTime}ms) exceeds maximum (${maxRateLimitWaitMs}ms), giving up`
          );
          throw lastError;
        }

        if (attempt < maxRetries) {
          logger.info(
            `[${integrationName}] Rate limited. Waiting ${Math.round(waitTime / 1000)}s before retry (attempt ${attempt + 1}/${maxRetries + 1})`
          );
          await sleep(waitTime);
          continue;
        }
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        throw lastError;
      }

      // Retry with backoff
      if (attempt < maxRetries) {
        const delayMs = getBackoffDelay({ attempt, initialDelayMs, maxDelayMs });
        logger.info(
          `[${integrationName}] Retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message.slice(0, 100)}`
        );
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error(`${integrationName} request failed after ${maxRetries} retries`);
}

// ============================================================================
// Fetch with Retry
// ============================================================================

export interface FetchWithRetryOptions extends RetryConfig {
  /** Request init options */
  init?: RequestInit;
}

/**
 * Fetch with retry logic and rate limit handling
 *
 * @example
 * const response = await fetchWithRetry(
 *   "https://api.sentry.io/issues/123",
 *   {
 *     integrationName: "Sentry",
 *     init: { headers: { Authorization: `Bearer ${token}` } }
 *   }
 * );
 */
export async function fetchWithRetry({
  url,
  options = {},
}: {
  url: string;
  options?: FetchWithRetryOptions;
}): Promise<Response> {
  const { init, ...retryConfig } = options;
  const opts = { ...DEFAULT_CONFIG, ...retryConfig };
  const { maxRetries, initialDelayMs, maxDelayMs, maxRateLimitWaitMs, integrationName } = opts;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const waitTime = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) * 1000
          : getBackoffDelay({ attempt, initialDelayMs, maxDelayMs });

        // Check if wait time is reasonable
        if (waitTime > maxRateLimitWaitMs) {
          logger.warn(
            `[${integrationName}] Rate limit wait time (${waitTime}ms) exceeds maximum (${maxRateLimitWaitMs}ms), giving up`
          );
          throw new Error(`${integrationName} rate limit exceeded, wait time too long`);
        }

        if (attempt < maxRetries) {
          logger.info(
            `[${integrationName}] Rate limited (429). Waiting ${Math.round(waitTime / 1000)}s before retry (attempt ${attempt + 1}/${maxRetries + 1})`
          );
          await sleep(waitTime);
          continue;
        }
      }

      // Handle server errors (5xx) - retry
      if (response.status >= 500 && attempt < maxRetries) {
        const delayMs = getBackoffDelay({ attempt, initialDelayMs, maxDelayMs });
        logger.info(
          `[${integrationName}] Server error (${response.status}). Retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1})`
        );
        await sleep(delayMs);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable (network errors, etc.)
      if (isRetryableError(error) && attempt < maxRetries) {
        const delayMs = getBackoffDelay({ attempt, initialDelayMs, maxDelayMs });
        logger.info(
          `[${integrationName}] Network error. Retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message.slice(0, 100)}`
        );
        await sleep(delayMs);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error(`${integrationName} request failed after ${maxRetries} retries`);
}
