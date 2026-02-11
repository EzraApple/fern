import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface WatchdogConfig {
  maxOpenCodeFailures: number;
  maxSchedulerFailures: number;
}

const DEFAULT_CONFIG: WatchdogConfig = {
  maxOpenCodeFailures: 5,
  maxSchedulerFailures: 10,
};

const STATE_FILE = path.join(os.tmpdir(), "fern-watchdog-state");

let schedulerFailures = 0;
let config: WatchdogConfig = { ...DEFAULT_CONFIG };
let shutdownCallback: ((reason: string) => Promise<void>) | null = null;

/** Read persisted OpenCode failure count (survives pm2 restarts) */
function readPersistedCounter(): number {
  try {
    const content = fs.readFileSync(STATE_FILE, "utf-8");
    return Number.parseInt(content.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/** Write persisted OpenCode failure count */
function writePersistedCounter(count: number): void {
  fs.writeFileSync(STATE_FILE, String(count), "utf-8");
}

/** Clear persisted OpenCode failure count */
function clearPersistedCounter(): void {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // File doesn't exist — fine
  }
}

/** Initialize the watchdog with a shutdown callback and optional config overrides */
export function initWatchdog(
  onShutdown: (reason: string) => Promise<void>,
  overrides?: Partial<WatchdogConfig>
): void {
  shutdownCallback = onShutdown;
  config = { ...DEFAULT_CONFIG, ...overrides };
  schedulerFailures = 0;

  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const maxOC = process.env["FERN_WATCHDOG_MAX_OPENCODE_FAILURES"];
  if (maxOC) {
    const parsed = Number.parseInt(maxOC, 10);
    if (!Number.isNaN(parsed) && parsed > 0) config.maxOpenCodeFailures = parsed;
  }
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const maxSched = process.env["FERN_WATCHDOG_MAX_SCHEDULER_FAILURES"];
  if (maxSched) {
    const parsed = Number.parseInt(maxSched, 10);
    if (!Number.isNaN(parsed) && parsed > 0) config.maxSchedulerFailures = parsed;
  }

  console.info(
    `[Watchdog] Initialized (opencode threshold: ${config.maxOpenCodeFailures}, scheduler threshold: ${config.maxSchedulerFailures})`
  );
}

/** Record an OpenCode failure. Persisted to disk. Returns true if threshold exceeded. */
export function recordOpenCodeFailure(): boolean {
  const count = readPersistedCounter() + 1;
  writePersistedCounter(count);
  console.warn(`[Watchdog] OpenCode failure #${count}/${config.maxOpenCodeFailures}`);
  return count >= config.maxOpenCodeFailures;
}

/** Reset OpenCode failure counter (call on successful startup) */
export function resetOpenCodeFailures(): void {
  const previous = readPersistedCounter();
  if (previous > 0) {
    console.info("[Watchdog] OpenCode failure counter reset");
  }
  clearPersistedCounter();
}

/** Record a scheduler job failure. Returns true if threshold exceeded. */
export function recordSchedulerFailure(): boolean {
  schedulerFailures++;
  console.warn(`[Watchdog] Scheduler failure #${schedulerFailures}/${config.maxSchedulerFailures}`);
  return schedulerFailures >= config.maxSchedulerFailures;
}

/** Reset scheduler failure counter (call on successful job execution) */
export function resetSchedulerFailures(): void {
  schedulerFailures = 0;
}

/** Get current failure counts */
export function getFailureCounts(): { openCode: number; scheduler: number } {
  return { openCode: readPersistedCounter(), scheduler: schedulerFailures };
}

/** Get the current config */
export function getWatchdogConfig(): WatchdogConfig {
  return { ...config };
}

/** Trigger the watchdog shutdown sequence */
export async function triggerWatchdogShutdown(reason: string): Promise<void> {
  console.error(`[Watchdog] Triggering shutdown: ${reason}`);
  if (shutdownCallback) {
    await shutdownCallback(reason);
  }
}

/** Reset all state (for testing) */
export function resetWatchdog(): void {
  schedulerFailures = 0;
  shutdownCallback = null;
  config = { ...DEFAULT_CONFIG };
  clearPersistedCounter();
}
