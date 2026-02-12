import { type DeployState, isDeployStateStale } from "@/core/deploy-state.js";
import { describe, expect, it } from "vitest";

function makeState(overrides: Partial<DeployState> = {}): DeployState {
  return {
    status: "in_progress",
    beforeSha: "abc1234",
    afterSha: "def5678",
    startedAt: new Date().toISOString(),
    threadId: "thread-1",
    commits: [],
    ...overrides,
  };
}

describe("isDeployStateStale", () => {
  it("returns false for a fresh in_progress state", () => {
    expect(isDeployStateStale(makeState())).toBe(false);
  });

  it("returns true for an in_progress state older than 30 minutes", () => {
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    expect(isDeployStateStale(makeState({ startedAt: old }))).toBe(true);
  });

  it("returns false for a state exactly at 30 minutes", () => {
    const borderline = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(isDeployStateStale(makeState({ startedAt: borderline }))).toBe(false);
  });

  it("returns false for non-in_progress states regardless of age", () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(isDeployStateStale(makeState({ status: "verifying", startedAt: old }))).toBe(false);
    expect(isDeployStateStale(makeState({ status: "completed", startedAt: old }))).toBe(false);
    expect(isDeployStateStale(makeState({ status: "rolled_back", startedAt: old }))).toBe(false);
  });
});
