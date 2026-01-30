import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { logger, getConfig } from "@/config/index.js";
import * as github from "@/services/integrations/github.js";
import { cacheGet, cacheSet } from "@/services/cache.js";
import { runChatAgent } from "@/agents/chat-agent.js";
import { unloadOllamaModel } from "@/services/integrations/ollama.js";

/**
 * Local API Server (Express)
 *
 * HTTP server for local AI assistant interactions and GitHub webhooks.
 *
 * Endpoints:
 * - POST /api/chat        - Send a message to the agent
 * - GET  /api/health      - Health check
 * - POST /webhooks/github - GitHub webhooks (PR/issue comments)
 */

const PORT = parseInt(process.env.WEBHOOK_PORT ?? "7829", 10);

const app = express();

app.use(
  express.json({
    verify: (req: Request, _res: Response, buf: Buffer) => {
      (req as Request & { rawBody: string }).rawBody = buf.toString();
    },
  })
);

app.use((req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery"
  );

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    endpoints: {
      chat: "POST /api/chat",
      health: "GET /api/health",
      github: "POST /webhooks/github",
    },
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.redirect("/api/health");
});

app.post("/api/chat", async (req: Request, res: Response) => {
  const { message, context } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required and must be a string" });
    return;
  }

  logger.info(`[API] Chat request: ${message.slice(0, 50)}...`);

  try {
    const result = await runChatAgent({
      message,
      source: { type: "cli" },
      context: context || undefined,
    });

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.error,
        sessionId: result.sessionId,
      });
      return;
    }

    res.json({
      success: true,
      sessionId: result.sessionId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[API] Chat error: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});


let cachedBotUsername: string | null = null;

async function getBotUsername(): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    cachedBotUsername = await github.getAuthenticatedUser();
    return cachedBotUsername;
  } catch {
    return "";
  }
}

const PR_AUTHOR_CACHE_TTL = 3600;

async function getPRAuthorUsername(repo: string, prNumber: number): Promise<string> {
  const cacheKey = `github:pr-author:${repo}:${prNumber}`;
  const cached = await cacheGet<string>(cacheKey);
  if (cached !== null) return cached;

  try {
    const author = await github.getPRAuthor({ repo, prNumber });
    await cacheSet(cacheKey, author, PR_AUTHOR_CACHE_TTL);
    return author;
  } catch {
    return "";
  }
}

const OUR_BOT_USERNAMES = ["jarvis[bot]", "jarvis"];
const IGNORED_BOT_USERNAMES = ["vercel[bot]", "github-actions[bot]"];
const WHITELISTED_BOT_USERNAMES = ["claude"];
const GITHUB_BOT_USERNAMES = [...OUR_BOT_USERNAMES, ...IGNORED_BOT_USERNAMES];

function isWhitelistedBot(username: string): boolean {
  const normalized = username.toLowerCase();
  return WHITELISTED_BOT_USERNAMES.some((bot) => bot.toLowerCase() === normalized);
}

function isGitHubBotUser(user: { login: string; type?: string }): boolean {
  const normalized = user.login.toLowerCase();
  if (isWhitelistedBot(normalized)) return false;
  if (user.type === "Bot") return true;
  return GITHUB_BOT_USERNAMES.some((bot) => bot.toLowerCase() === normalized);
}

function mentionsOurBot(commentBody: string): boolean {
  return OUR_BOT_USERNAMES.some((bot) => {
    const escaped = bot.replace(/[[\]]/g, "\\$&");
    const mentionPattern = new RegExp(`@${escaped}\\b`, "i");
    return mentionPattern.test(commentBody);
  });
}

function mentionsIgnoredBot(commentBody: string): boolean {
  return IGNORED_BOT_USERNAMES.some((bot) => {
    const escaped = bot.replace(/[[\]]/g, "\\$&");
    const mentionPattern = new RegExp(`@${escaped}\\b`, "i");
    return mentionPattern.test(commentBody);
  });
}

app.post("/webhooks/github", async (req: Request, res: Response) => {
  const event = req.headers["x-github-event"] as string | undefined;
  const deliveryId = req.headers["x-github-delivery"] as string | undefined;

  logger.info(`[Webhook] GitHub ${event} event received (delivery: ${deliveryId})`);

  res.json({ received: true });

  if (event === "issue_comment") {
    const { action, comment, issue, repository } = req.body;

    if (action !== "created") {
      logger.info(`[Webhook] Skipping issue_comment: action=${action}`);
      return;
    }

    if (isGitHubBotUser(comment.user)) {
      logger.info(`[Webhook] Skipping issue_comment: bot user ${comment.user.login}`);
      return;
    }

    if (mentionsIgnoredBot(comment.body)) {
      logger.info(`[Webhook] Skipping issue_comment: mentions ignored bot`);
      return;
    }

    const isPR = !!issue?.pull_request;

    if (isPR) {
      const isMentioned = mentionsOurBot(comment.body);
      if (!isMentioned) {
        logger.info(`[Webhook] Skipping issue_comment on PR: not mentioned`);
        return;
      }
      logger.info(`[Webhook] Processing issue_comment: bot mentioned`);
    }

    logger.info(`[Webhook] GitHub comment on ${repository?.full_name}#${issue?.number} - ready for processing`);
    return;
  }

  if (event === "pull_request_review_comment") {
    const { action, comment, pull_request, repository } = req.body;

    if (action !== "created") {
      logger.info(`[Webhook] Skipping pull_request_review_comment: action=${action}`);
      return;
    }

    if (isGitHubBotUser(comment.user)) {
      logger.info(`[Webhook] Skipping pull_request_review_comment: bot user ${comment.user.login}`);
      return;
    }

    if (mentionsIgnoredBot(comment.body)) {
      logger.info(`[Webhook] Skipping pull_request_review_comment: mentions ignored bot`);
      return;
    }

    const isMentioned = mentionsOurBot(comment.body);
    if (!isMentioned) {
      logger.info(`[Webhook] Skipping pull_request_review_comment: not mentioned`);
      return;
    }

    logger.info(`[Webhook] GitHub review comment on ${repository?.full_name}#${pull_request?.number} - ready for processing`);
    return;
  }

  if (event === "pull_request_review") {
    const { action, review, pull_request, repository } = req.body;

    if (action !== "submitted") {
      logger.info(`[Webhook] Skipping pull_request_review: action=${action}`);
      return;
    }

    if (isGitHubBotUser(review.user)) {
      logger.info(`[Webhook] Skipping pull_request_review: bot user ${review.user.login}`);
      return;
    }

    if (review.state === "commented") {
      logger.info(`[Webhook] Skipping pull_request_review: state=commented`);
      return;
    }

    const isMentioned = review.body ? mentionsOurBot(review.body) : false;
    if (!isMentioned) {
      logger.info(`[Webhook] Skipping pull_request_review: not mentioned`);
      return;
    }

    logger.info(`[Webhook] GitHub PR review on ${repository?.full_name}#${pull_request?.number} - ready for processing`);
    return;
  }

  if (event === "workflow_run") {
    const payload = req.body;
    const workflowRun = payload.workflow_run;

    if (payload.action !== "completed") {
      logger.info(`[Webhook] Skipping workflow_run: action=${payload.action}`);
      return;
    }

    const isFailure = workflowRun.conclusion === "failure" || workflowRun.conclusion === "timed_out";
    if (!isFailure) {
      logger.info(`[Webhook] Skipping workflow_run: conclusion=${workflowRun.conclusion}`);
      return;
    }

    const pr = workflowRun.pull_requests?.[0];
    if (!pr) {
      logger.info(`[Webhook] Skipping workflow_run: no associated PR`);
      return;
    }

    const botUsername = await getBotUsername();
    if (!botUsername) {
      logger.warn(`[Webhook] Skipping workflow_run: could not get bot username`);
      return;
    }

    const prAuthor = await getPRAuthorUsername(payload.repository.full_name, pr.number);
    if (prAuthor.toLowerCase() !== botUsername.toLowerCase()) {
      logger.info(`[Webhook] Skipping workflow_run: PR #${pr.number} by @${prAuthor} (not bot @${botUsername})`);
      return;
    }

    logger.info(`[Webhook] Workflow "${workflowRun.name}" failed on bot's PR #${pr.number} - ready for processing`);
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error("[Webhook] Request error:", err);
  res.status(500).json({ error: "Internal server error" });
});

function warmupInBackground(): void {
  getConfig();
  getBotUsername().catch(() => {});
  logger.info("[Server] Background warmup started");
}

export function startWebhookServer(port?: number): void {
  warmupInBackground();

  const serverPort = port ?? PORT;
  const server = app.listen(serverPort, () => {
    logger.info(`[Server] Jarvis API listening on port ${serverPort}`);
    logger.info(`[Server] Endpoints:`);
    logger.info(`[Server]   POST /api/chat        - Send message to agent`);
    logger.info(`[Server]   GET  /api/health      - Health check`);
    logger.info(`[Server]   POST /webhooks/github - GitHub webhooks`);
  });

  process.on("SIGTERM", async () => {
    logger.info("[Server] Shutting down...");
    await unloadOllamaModel();
    server.close(() => {
      logger.info("[Server] Server closed");
      process.exit(0);
    });
  });
}

const isMainModule = process.argv[1]?.includes("webhook-server");
if (isMainModule) {
  startWebhookServer();
}
