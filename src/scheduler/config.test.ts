import { afterEach, describe, expect, it } from "vitest";
import { getSchedulerConfig, resetSchedulerConfig } from "./config.js";

describe("getSchedulerConfig", () => {
  afterEach(() => {
    resetSchedulerConfig();
    process.env.FERN_SCHEDULER_ENABLED = undefined;
    process.env.FERN_SCHEDULER_POLL_INTERVAL_MS = undefined;
    process.env.FERN_SCHEDULER_MAX_CONCURRENT = undefined;
  });

  it("returns defaults when no env vars are set", () => {
    const config = getSchedulerConfig();
    expect(config.enabled).toBe(true);
    expect(config.pollIntervalMs).toBe(60_000);
    expect(config.maxConcurrentJobs).toBe(3);
  });

  it("caches the config after first call", () => {
    const first = getSchedulerConfig();
    const second = getSchedulerConfig();
    expect(first).toBe(second); // Same reference
  });

  it("respects FERN_SCHEDULER_ENABLED=false", () => {
    process.env.FERN_SCHEDULER_ENABLED = "false";
    const config = getSchedulerConfig();
    expect(config.enabled).toBe(false);
  });

  it("respects FERN_SCHEDULER_ENABLED=true", () => {
    process.env.FERN_SCHEDULER_ENABLED = "true";
    const config = getSchedulerConfig();
    expect(config.enabled).toBe(true);
  });

  it("respects FERN_SCHEDULER_POLL_INTERVAL_MS", () => {
    process.env.FERN_SCHEDULER_POLL_INTERVAL_MS = "5000";
    const config = getSchedulerConfig();
    expect(config.pollIntervalMs).toBe(5000);
  });

  it("ignores invalid FERN_SCHEDULER_POLL_INTERVAL_MS", () => {
    process.env.FERN_SCHEDULER_POLL_INTERVAL_MS = "not_a_number";
    const config = getSchedulerConfig();
    expect(config.pollIntervalMs).toBe(60_000);
  });

  it("respects FERN_SCHEDULER_MAX_CONCURRENT", () => {
    process.env.FERN_SCHEDULER_MAX_CONCURRENT = "10";
    const config = getSchedulerConfig();
    expect(config.maxConcurrentJobs).toBe(10);
  });

  it("resets cache correctly", () => {
    const first = getSchedulerConfig();
    resetSchedulerConfig();
    process.env.FERN_SCHEDULER_POLL_INTERVAL_MS = "1000";
    const second = getSchedulerConfig();
    expect(second.pollIntervalMs).toBe(1000);
    expect(first).not.toBe(second);
  });
});
