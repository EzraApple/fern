/**
 * Shared utilities for OpenCode tools
 *
 * This module provides common helper functions used across all tools
 * that communicate with the Fern internal API. Centralizing these
 * reduces code duplication and ensures consistency.
 */

/**
 * Get the Fern API base URL from environment or use default
 * Checks FERN_API_URL first, then constructs from FERN_PORT
 */
export function getFernUrl(): string {
  return process.env.FERN_API_URL || `http://127.0.0.1:${process.env.FERN_PORT || "4000"}`;
}

/**
 * Build authentication headers for internal API requests
 * Includes Content-Type and optional X-Fern-Secret for auth
 */
export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.FERN_API_SECRET;
  if (secret) {
    headers["X-Fern-Secret"] = secret;
  }
  return headers;
}
