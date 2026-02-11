import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { tool } from "@opencode-ai/plugin";

function getTriggerPath(): string {
  return path.join(os.homedir(), ".fern", "update-trigger.flag");
}

export const trigger_update = tool({
  description:
    "Trigger a production deployment. Writes a flag file that the updater script picks up to run git pull, build, and pm2 restart. Call this ONLY after reviewing incoming commits and notifying the user. Your session will be interrupted by the restart — you will be resumed afterwards for verification. This is the LAST action in the self-update skill.",
  args: {
    reason: tool.schema
      .string()
      .describe("Brief reason for deploying (e.g., 'deploying 3 commits: feature X, fix Y')"),
  },
  async execute(args) {
    try {
      const triggerDir = path.dirname(getTriggerPath());
      fs.mkdirSync(triggerDir, { recursive: true });
      fs.writeFileSync(
        getTriggerPath(),
        JSON.stringify({ triggeredAt: new Date().toISOString(), reason: args.reason }, null, 2),
        "utf-8"
      );
      return `Update triggered: ${args.reason}. The updater script will pull, build, and restart. This session will resume post-restart for verification.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error triggering update: ${msg}`;
    }
  },
});
