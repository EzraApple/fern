import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface DeployCommit {
  sha: string;
  message: string;
  author: string;
}

export interface DeployState {
  status: "in_progress" | "verifying" | "completed" | "rolled_back";
  beforeSha: string;
  afterSha: string;
  startedAt: string;
  threadId: string;
  commits: DeployCommit[];
  verifyStartedAt?: string;
  completedAt?: string;
  rollbackReason?: string;
}

function getDeployStatePath(): string {
  return (
    process.env.FERN_DEPLOY_STATE_PATH || path.join(os.homedir(), ".fern", "deploy-state.json")
  );
}

export function writeDeployState(state: DeployState): void {
  const filePath = getDeployStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export function readDeployState(): DeployState | null {
  const filePath = getDeployStatePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as DeployState;
  } catch {
    return null;
  }
}

export function clearDeployState(): void {
  const filePath = getDeployStatePath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

const STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/** Check if an in_progress deploy state is stale (older than 30 minutes) */
export function isDeployStateStale(state: DeployState): boolean {
  if (state.status !== "in_progress") return false;
  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  return elapsed > STALE_TIMEOUT_MS;
}
