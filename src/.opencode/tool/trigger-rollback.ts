import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { tool } from "@opencode-ai/plugin";

function getRollbackPath(): string {
  return path.join(os.homedir(), ".fern", "rollback-trigger.flag");
}

export const trigger_rollback = tool({
  description:
    "Trigger a deployment rollback. Writes a flag file that the updater script picks up to restore the previous dist/ backup and restart. Use ONLY during post-restart verification when health checks fail. Include the error context so you can reference it when opening a fix PR after rollback completes.",
  args: {
    reason: tool.schema
      .string()
      .describe(
        "Why rollback is needed — include which check failed and the exact error (e.g., 'memory_search returned SQLITE_ERROR: no such table')"
      ),
  },
  async execute(args) {
    try {
      const rollbackDir = path.dirname(getRollbackPath());
      fs.mkdirSync(rollbackDir, { recursive: true });
      fs.writeFileSync(
        getRollbackPath(),
        JSON.stringify({ triggeredAt: new Date().toISOString(), reason: args.reason }, null, 2),
        "utf-8"
      );
      return `Rollback triggered: ${args.reason}. The updater will restore the backup and restart. This session will resume post-rollback so you can open a fix PR.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error triggering rollback: ${msg}`;
    }
  },
});
