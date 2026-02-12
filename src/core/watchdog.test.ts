import {
  getFailureCounts,
  getWatchdogConfig,
  initWatchdog,
  recordOpenCodeFailure,
  recordSchedulerFailure,
  resetOpenCodeFailures,
  resetSchedulerFailures,
  resetWatchdog,
  triggerWatchdogShutdown,
} from "@/core/watchdog.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("watchdog", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetWatchdog();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetWatchdog();
  });

  it("records OpenCode failures and returns true when threshold exceeded", () => {
    initWatchdog(vi.fn(), { maxOpenCodeFailures: 3, maxSchedulerFailures: 10 });

    expect(recordOpenCodeFailure()).toBe(false);
    expect(recordOpenCodeFailure()).toBe(false);
    expect(recordOpenCodeFailure()).toBe(true);

    expect(getFailureCounts().openCode).toBe(3);
  });

  it("resets OpenCode failures on success", () => {
    initWatchdog(vi.fn(), { maxOpenCodeFailures: 5, maxSchedulerFailures: 10 });

    recordOpenCodeFailure();
    recordOpenCodeFailure();
    expect(getFailureCounts().openCode).toBe(2);

    resetOpenCodeFailures();
    expect(getFailureCounts().openCode).toBe(0);
  });

  it("records scheduler failures and returns true when threshold exceeded", () => {
    initWatchdog(vi.fn(), { maxOpenCodeFailures: 5, maxSchedulerFailures: 3 });

    expect(recordSchedulerFailure()).toBe(false);
    expect(recordSchedulerFailure()).toBe(false);
    expect(recordSchedulerFailure()).toBe(true);

    expect(getFailureCounts().scheduler).toBe(3);
  });

  it("resets scheduler failures independently", () => {
    initWatchdog(vi.fn(), { maxOpenCodeFailures: 5, maxSchedulerFailures: 10 });

    recordSchedulerFailure();
    recordSchedulerFailure();
    recordOpenCodeFailure();

    resetSchedulerFailures();
    expect(getFailureCounts().scheduler).toBe(0);
    expect(getFailureCounts().openCode).toBe(1);
  });

  it("reads threshold overrides from env vars", () => {
    vi.stubEnv("FERN_WATCHDOG_MAX_OPENCODE_FAILURES", "2");
    vi.stubEnv("FERN_WATCHDOG_MAX_SCHEDULER_FAILURES", "4");

    initWatchdog(vi.fn());
    const cfg = getWatchdogConfig();
    expect(cfg.maxOpenCodeFailures).toBe(2);
    expect(cfg.maxSchedulerFailures).toBe(4);
  });

  it("ignores invalid env var values", () => {
    vi.stubEnv("FERN_WATCHDOG_MAX_OPENCODE_FAILURES", "abc");
    vi.stubEnv("FERN_WATCHDOG_MAX_SCHEDULER_FAILURES", "-1");

    initWatchdog(vi.fn());
    const cfg = getWatchdogConfig();
    expect(cfg.maxOpenCodeFailures).toBe(5); // default
    expect(cfg.maxSchedulerFailures).toBe(10); // default
  });

  it("calls shutdown callback on triggerWatchdogShutdown", async () => {
    const mockShutdown = vi.fn().mockResolvedValue(undefined);
    initWatchdog(mockShutdown);

    await triggerWatchdogShutdown("test reason");
    expect(mockShutdown).toHaveBeenCalledWith("test reason");
  });

  it("OpenCode failures persist across resetWatchdog (simulates restart)", () => {
    initWatchdog(vi.fn(), { maxOpenCodeFailures: 5, maxSchedulerFailures: 10 });

    recordOpenCodeFailure();
    recordOpenCodeFailure();

    // Simulate process restart: reset everything except file-persisted counter
    // We don't call resetWatchdog here since that clears the file
    // Instead just re-init
    initWatchdog(vi.fn(), { maxOpenCodeFailures: 5, maxSchedulerFailures: 10 });

    // Counter should still be at 2 from the file
    expect(getFailureCounts().openCode).toBe(2);

    // But scheduler resets (in-memory only)
    expect(getFailureCounts().scheduler).toBe(0);
  });

  it("uses default thresholds when no overrides provided", () => {
    initWatchdog(vi.fn());
    const cfg = getWatchdogConfig();
    expect(cfg.maxOpenCodeFailures).toBe(5);
    expect(cfg.maxSchedulerFailures).toBe(10);
  });
});
