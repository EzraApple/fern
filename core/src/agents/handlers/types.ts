/**
 * Progress handler interface for updating the source platform.
 */
export interface ProgressHandler {
  setShareUrl: (url: string) => void;
  sendThought: (text: string) => Promise<void>;
  sendResponse: (text: string) => Promise<void>;
  sendError: (text: string) => Promise<void>;
  updateDescription: (notes: string) => Promise<void>;
  addReaction?: (emoji: string) => Promise<void>;
  notifyCompletion?: () => Promise<void>;
}

/**
 * Source information for where the request came from.
 */
export interface ChatSource {
  type: "github" | "cli";

  threadTs?: string;
  userId?: string;
  issueId?: string;
  issueIdentifier?: string;
  requesterName?: string;
  requesterEmail?: string;

  repo?: string;
  repoUrl?: string;
  cloneUrl?: string;
  prNumber?: number;
  prUrl?: string;
  prBranch?: string;
  prBaseBranch?: string;
  commentId?: number;
  commentUrl?: string;
  isPR?: boolean;
  filePath?: string;
  lineNumber?: number;
  isBotOwnedPR?: boolean;
}

/**
 * Tool tracking for progress display.
 */
export interface ToolStatus {
  name: string;
  status: "running" | "done" | "error";
}

/**
 * Parameters for creating a GitHub progress handler.
 */
export interface GitHubHandlerParams {
  repo: string;
  prNumber: number;
  sourceCommentId?: number;
  isReviewComment?: boolean;
  mentionUser?: string;
}
