import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import { Hono } from "hono";
import { getGitHubWebhookSecret } from "../config/config.js";
import { runAgentLoop } from "../core/agent.js";
import { writeDeployState } from "../core/deploy-state.js";
import type { DeployCommit } from "../core/deploy-state.js";

/** Thread ID used for all deploy sessions — ensures session continuity across restarts */
const DEPLOY_THREAD_ID = "deploy_session";

function verifySignature(signature: string | undefined, secret: string, body: string): boolean {
  if (!signature) return false;

  const parts = signature.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") return false;

  const expected = parts[1];
  if (!expected) return false;

  const computed = crypto.createHmac("sha256", secret).update(body).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(computed, "hex"));
  } catch {
    return false;
  }
}

export function createGitHubWebhookRoutes(): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const secret = getGitHubWebhookSecret();
    const rawBody = await c.req.text();

    // Verify signature if secret is configured
    if (secret) {
      const signature = c.req.header("X-Hub-Signature-256");
      if (!verifySignature(signature, secret, rawBody)) {
        console.warn("[GitHub Webhook] Invalid signature");
        return c.text("Forbidden", 403);
      }
    }

    const event = c.req.header("X-GitHub-Event");
    if (event !== "push") {
      return c.json({ message: "Event ignored" }, 200);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return c.text("Bad request", 400);
    }

    const ref = payload.ref as string | undefined;
    if (ref !== "refs/heads/main") {
      return c.json({ message: "Not main branch" }, 200);
    }

    const rawCommits = (payload.commits ?? []) as Array<{
      id: string;
      message: string;
      author?: { name?: string };
    }>;

    const commits: DeployCommit[] = rawCommits.map((rc) => ({
      sha: rc.id,
      message: rc.message,
      author: rc.author?.name ?? "unknown",
    }));

    if (commits.length === 0) {
      return c.json({ message: "No commits" }, 200);
    }

    const beforeSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    const afterSha = payload.after as string;

    console.info(
      `[GitHub Webhook] Push to main: ${commits.length} commit(s), ${beforeSha.slice(0, 7)}..${afterSha.slice(0, 7)}`
    );

    // Write deploy state before starting agent
    writeDeployState({
      status: "in_progress",
      beforeSha,
      afterSha,
      startedAt: new Date().toISOString(),
      threadId: DEPLOY_THREAD_ID,
      commits,
    });

    // Fire agent in background (same pattern as WhatsApp webhook)
    void (async () => {
      try {
        const commitSummary = commits
          .map((c) => `  - ${c.sha.slice(0, 7)}: ${c.message} (${c.author})`)
          .join("\n");

        await runAgentLoop({
          sessionId: DEPLOY_THREAD_ID,
          message: `New commits pushed to main. Load the self-update skill to review and deploy them.

Commits:
${commitSummary}

Current SHA: ${beforeSha}
Target SHA: ${afterSha}`,
          channelName: "github",
        });
      } catch (error) {
        console.error("[GitHub Webhook] Agent session error:", error);
      }
    })();

    return c.json({ message: "Processing" }, 202);
  });

  return app;
}
