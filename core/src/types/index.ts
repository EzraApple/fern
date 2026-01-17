import { z } from "zod";

// ============================================================================
// Configuration Types
// ============================================================================

export const ConfigSchema = z.object({
  opencode: z.object({
    apiKey: z.string().min(1, "OPENAI_API_KEY is required"),
  }),
  github: z.object({
    token: z.string().optional(),
    appId: z.string().optional(),
    appPrivateKey: z.string().optional(),
    appInstallationId: z.string().optional(),
  }),
  webhook: z.object({
    port: z.number(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================================================
// Git Types
// ============================================================================

export interface BlameInfo {
  name: string;
  email: string;
  githubUsername?: string;
  timestamp: string;
  lineRange: { start: number; end: number };
}

export interface BranchInfo {
  name: string;
  isNew: boolean;
  baseBranch: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
}

// ============================================================================
// GitHub Types
// ============================================================================

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  url: string;
  htmlUrl: string;
  state: "open" | "closed" | "merged";
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
}

export interface PRComment {
  id: number;
  body: string;
  user: {
    login: string;
  };
  prNumber: number;
  createdAt: string;
  path?: string;
  line?: number;
  startLine?: number;
  diffHunk?: string;
}

export interface CreatePRInput {
  title: string;
  body: string;
  branch: string;
  baseBranch?: string;
  draft?: boolean;
}

// ============================================================================
// Agent Types
// ============================================================================

export interface FeedbackAgentResult {
  success: boolean;
  response: string;
  changesApplied: boolean;
  commitHash?: string;
}

// ============================================================================
// Utility Types
// ============================================================================

interface Logger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
}
