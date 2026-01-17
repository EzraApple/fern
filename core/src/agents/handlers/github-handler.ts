import { logger } from "@/config/index.js";
import * as github from "@/services/integrations/github.js";
import type { ProgressHandler, GitHubHandlerParams, ToolStatus } from "./types.js";

/**
 * Build progress text for GitHub comment.
 */
function buildProgressText({
  status,
  toolsUsed,
  shareUrl,
}: {
  status: string;
  toolsUsed: ToolStatus[];
  shareUrl: string | null;
}): string {
  const lines: string[] = [];

  const linkText = shareUrl ? ` ([view](${shareUrl}))` : "";
  lines.push(`**${status}**${linkText}`);

  if (toolsUsed.length > 0) {
    const tools = toolsUsed
      .map(t => {
        const icon = t.status === "running" ? "⏳" : t.status === "error" ? "❌" : "✅";
        return `${icon} \`${t.name}\``;
      })
      .join(" ");
    lines.push(tools);
  }

  return lines.join("\n\n");
}

/**
 * Create a progress handler for GitHub PRs/issues.
 * Posts and updates a single comment with progress.
 * For review comments (inline code), replies in-thread.
 */
export function createGitHubHandler({ repo, prNumber, sourceCommentId, isReviewComment, mentionUser }: GitHubHandlerParams): ProgressHandler {
  logger.info(`[GitHubHandler] Creating handler for PR #${prNumber} in ${repo} (reviewComment: ${isReviewComment}, mentionUser: ${mentionUser})`);

  let commentId: number | null = null;
  let shareUrl: string | null = null;
  let currentStatus = "Working...";
  const toolsUsed: ToolStatus[] = [];
  let postedSessionLink = false;

  return {
    setShareUrl: (url: string) => {
      shareUrl = url;
    },

    sendThought: async (text: string) => {
      if (text.startsWith("Using ")) {
        const toolName = text.replace("Using ", "").replace("...", "");
        const lastRunning = toolsUsed.findIndex(t => t.status === "running");
        if (lastRunning >= 0) {
          toolsUsed[lastRunning].status = "done";
        }
        toolsUsed.push({ name: toolName, status: "running" });
        currentStatus = text;
      } else if (text.startsWith("Error:")) {
        const lastRunning = toolsUsed.findIndex(t => t.status === "running");
        if (lastRunning >= 0) {
          toolsUsed[lastRunning].status = "error";
        }
        currentStatus = text;
      } else if (text && text !== "Processing...") {
        currentStatus = text;
      }

      if (isReviewComment) {
        if (!postedSessionLink && shareUrl && sourceCommentId) {
          postedSessionLink = true;
          const sessionLinkBody = `🔗 [View session](${shareUrl})`;
          try {
            await github.replyToReviewComment({ repo, prNumber, commentId: sourceCommentId, body: sessionLinkBody });
            logger.info(`[GitHubHandler] Posted session link reply for review comment`);
          } catch (err) {
            logger.warn(`[GitHubHandler] Failed to post session link:`, err);
          }
        } else {
          logger.info(`[GitHubHandler] Skipping progress for review comment: ${text}`);
        }
        return;
      }

      logger.info(`[GitHubHandler] sendThought for PR comment: ${text}`);
      const progressText = buildProgressText({ status: currentStatus, toolsUsed, shareUrl });

      try {
        if (!commentId) {
          commentId = await github.createIssueComment({ repo, issueNumber: prNumber, body: progressText });
          logger.info(`[GitHubHandler] Posted progress comment (id: ${commentId})`);
        } else {
          await github.updateIssueComment({ repo, commentId, body: progressText });
          logger.info(`[GitHubHandler] Updated progress comment (id: ${commentId})`);
        }
      } catch (err) {
        logger.warn(`[GitHubHandler] Failed to update progress:`, err);
      }
    },

    sendResponse: async (text: string) => {
      logger.info(`[GitHubHandler] sendResponse called (isReviewComment=${isReviewComment}, commentId=${commentId}, text length=${text.length})`);

      toolsUsed.forEach(t => {
        if (t.status === "running") t.status = "done";
      });

      const mentionPrefix = mentionUser ? `@${mentionUser}\n\n` : "";
      const textWithMention = `${mentionPrefix}${text}`;

      const fullText = shareUrl
        ? `${textWithMention}\n\n---\n🔗 [View session](${shareUrl})`
        : textWithMention;

      try {
        if (isReviewComment && sourceCommentId) {
          await github.replyToReviewComment({ repo, prNumber, commentId: sourceCommentId, body: fullText });
          logger.info(`[GitHubHandler] Replied in review comment thread`);
          return;
        }

        if (commentId) {
          await github.updateIssueComment({ repo, commentId, body: fullText });
          logger.info(`[GitHubHandler] Updated comment with response`);
        } else {
          const newCommentId = await github.createIssueComment({ repo, issueNumber: prNumber, body: fullText });
          logger.info(`[GitHubHandler] Posted response comment (id: ${newCommentId})`);
        }
      } catch (err) {
        logger.warn(`[GitHubHandler] Failed to post response:`, err);
      }
    },

    sendError: async (text: string) => {
      const errorText = `❌ Error: ${text}`;
      try {
        if (commentId) {
          await github.updateIssueComment({ repo, commentId, body: errorText });
        } else {
          await github.createIssueComment({ repo, issueNumber: prNumber, body: errorText });
        }
      } catch (err) {
        logger.warn(`[GitHubHandler] Failed to post error:`, err);
      }
    },

    updateDescription: async () => {
    },

    addReaction: async (emoji: string) => {
      if (!sourceCommentId) {
        logger.warn(`[GitHubHandler] Cannot add reaction - no source comment ID`);
        return;
      }
      try {
        const reactionMap: Record<string, "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes"> = {
          "eyes": "eyes",
          "👀": "eyes",
          "+1": "+1",
          "👍": "+1",
          "-1": "-1",
          "👎": "-1",
          "laugh": "laugh",
          "😄": "laugh",
          "confused": "confused",
          "😕": "confused",
          "heart": "heart",
          "❤️": "heart",
          "hooray": "hooray",
          "🎉": "hooray",
          "rocket": "rocket",
          "🚀": "rocket",
        };
        const reaction = reactionMap[emoji] ?? "eyes";

        if (isReviewComment) {
          await github.addReactionToReviewComment({ repo, commentId: sourceCommentId, reaction });
        } else {
          await github.addReactionToComment({ repo, commentId: sourceCommentId, reaction });
        }
        logger.info(`[GitHubHandler] Added ${reaction} reaction to comment ${sourceCommentId}`);
      } catch (err) {
        logger.warn(`[GitHubHandler] Failed to add reaction:`, err);
      }
    },
  };
}
