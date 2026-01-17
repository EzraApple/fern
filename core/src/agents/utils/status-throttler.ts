/**
 * StatusThrottler
 *
 * Batches rapid streaming text and thinking events to avoid hitting Slack rate limits
 * while still showing progressive updates to the user.
 *
 * Note (Replee, 2026-01-09, REPL-stream): Created to enable progressive streaming updates
 * in chat-agent.ts without overwhelming Slack's rate limits (~1 msg/sec).
 */

import { logger } from "@/config/index.js";

const MAX_PREVIEW_LENGTH = 150; // Max chars to show in status preview

export interface StatusThrottlerOptions {
  /** Minimum interval between flushes (ms). Default: 1500ms */
  minIntervalMs?: number;
  /** Callback when status should be sent to the user */
  onFlush: (status: string) => Promise<void>;
}

/**
 * Throttles streaming status updates to avoid rate limits.
 * Accumulates text/thinking events and flushes at most every `minIntervalMs`.
 */
export class StatusThrottler {
  private readonly minIntervalMs: number;
  private readonly onFlush: (status: string) => Promise<void>;

  private pendingText = "";
  private pendingThinking = "";
  private lastFlushTime = 0;
  private flushTimeout: NodeJS.Timeout | null = null;

  constructor(options: StatusThrottlerOptions) {
    this.minIntervalMs = options.minIntervalMs ?? 1500;
    this.onFlush = options.onFlush;
  }

  /**
   * Append streaming text content
   */
  appendText(text: string): void {
    this.pendingText += text;
    this.scheduleFlush();
  }

  /**
   * Append thinking/reasoning content
   */
  appendThinking(text: string): void {
    this.pendingThinking += text;
    this.scheduleFlush();
  }

  /**
   * Schedule a flush if enough time has passed, or set a timer
   */
  private scheduleFlush(): void {
    const now = Date.now();
    const timeSinceLastFlush = now - this.lastFlushTime;

    if (timeSinceLastFlush >= this.minIntervalMs) {
      // Enough time has passed, flush immediately
      this.doFlush();
    } else if (!this.flushTimeout) {
      // Schedule a flush for when the interval expires
      const delay = this.minIntervalMs - timeSinceLastFlush;
      this.flushTimeout = setTimeout(() => {
        this.flushTimeout = null;
        this.doFlush();
      }, delay);
    }
    // If timeout already scheduled, just let it fire
  }

  /**
   * Immediately flush any pending content
   */
  flush(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    this.doFlush();
  }

  /**
   * Internal flush implementation
   */
  private doFlush(): void {
    const hasContent = this.pendingText.length > 0 || this.pendingThinking.length > 0;
    if (!hasContent) return;

    this.lastFlushTime = Date.now();

    // Build status message from accumulated content
    const status = this.buildStatusMessage();

    // Clear pending content
    this.pendingText = "";
    this.pendingThinking = "";

    // Send asynchronously (don't block)
    this.onFlush(status).catch((err) => {
      logger.warn(`[StatusThrottler] Failed to flush status:`, err);
    });
  }

  /**
   * Build a user-friendly status message from accumulated content
   */
  private buildStatusMessage(): string {
    // Prefer showing text response preview over thinking
    if (this.pendingText.length > 0) {
      const preview = this.truncateForPreview(this.pendingText);
      return `Writing: ${preview}`;
    }

    if (this.pendingThinking.length > 0) {
      const preview = this.truncateForPreview(this.pendingThinking);
      return `Thinking: ${preview}`;
    }

    return "Working...";
  }

  /**
   * Truncate text for status preview, preferring complete sentences/words
   */
  private truncateForPreview(text: string): string {
    // Clean up the text - remove extra whitespace
    const cleaned = text.trim().replace(/\s+/g, " ");

    if (cleaned.length <= MAX_PREVIEW_LENGTH) {
      return cleaned;
    }

    // Try to break at sentence boundary
    const truncated = cleaned.slice(0, MAX_PREVIEW_LENGTH);
    const lastPeriod = truncated.lastIndexOf(". ");
    if (lastPeriod > MAX_PREVIEW_LENGTH / 2) {
      return truncated.slice(0, lastPeriod + 1);
    }

    // Break at word boundary
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > MAX_PREVIEW_LENGTH / 2) {
      return `${truncated.slice(0, lastSpace)}...`;
    }

    return `${truncated}...`;
  }

  /**
   * Clean up any pending timers
   */
  destroy(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
  }
}
