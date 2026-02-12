export interface PRInfo {
  url: string;
  number: number;
  state: string;
}

export interface PRStatus {
  state: string;
  mergeable: boolean | null;
  checks: CheckStatus[];
  reviews: Review[];
}

export interface CheckStatus {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface Review {
  user: string;
  state: string;
  submittedAt: string;
}

export interface CreatePRParams {
  repo: string; // "owner/repo" format or full URL
  branch: string;
  title: string;
  body: string;
  base?: string; // Default: main
}
