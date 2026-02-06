/**
 * Information about an isolated workspace for code modifications
 */
export interface WorkspaceInfo {
  /** Unique workspace identifier (ULID) */
  id: string;

  /** Absolute path to the workspace directory */
  path: string;

  /** Original repository URL that was cloned */
  repoUrl: string;

  /** Current branch name in the workspace */
  branch: string;

  /** Timestamp when workspace was created (milliseconds since epoch) */
  createdAt: number;
}

/**
 * Information about a git commit
 */
export interface GitCommit {
  /** Commit SHA hash */
  hash: string;

  /** Commit message */
  message: string;

  /** Author name */
  author: string;

  /** Timestamp when commit was created */
  timestamp: number;
}

/**
 * Complete modification task with all details
 */
export interface ModificationTask {
  /** Workspace information */
  workspace: WorkspaceInfo;

  /** List of files that were modified */
  files: string[];

  /** List of commits made */
  commits: GitCommit[];

  /** Whether tests passed in the workspace */
  testsPassed: boolean;

  /** URL of created pull request (if applicable) */
  prUrl?: string;

  /** PR number (if applicable) */
  prNumber?: number;
}
