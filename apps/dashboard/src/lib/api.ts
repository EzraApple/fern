import type {
  ArchiveChunk,
  ArchiveSummary,
  PRStatus,
  PRSummary,
  PersistentMemory,
  ScheduledJob,
  Session,
  SessionMessage,
  UnifiedSearchResult,
} from "./types";

const API_BASE = "/api";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

// Sessions
export async function fetchSessions(): Promise<Session[]> {
  const data = await fetchJSON<{ sessions: Session[] }>(`${API_BASE}/sessions`);
  return data.sessions;
}

export async function fetchSession(id: string): Promise<Session> {
  return fetchJSON<Session>(`${API_BASE}/sessions/${id}`);
}

export async function fetchSessionMessages(id: string): Promise<SessionMessage[]> {
  const data = await fetchJSON<{ messages: SessionMessage[] }>(
    `${API_BASE}/sessions/${id}/messages`
  );
  return data.messages;
}

// Memories
export async function fetchMemories(options?: {
  type?: string;
  limit?: number;
}): Promise<PersistentMemory[]> {
  const params = new URLSearchParams();
  if (options?.type) params.set("type", options.type);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const data = await fetchJSON<{ memories: PersistentMemory[] }>(
    `${API_BASE}/memories${qs ? `?${qs}` : ""}`
  );
  return data.memories;
}

export async function searchMemories(
  query: string,
  options?: { limit?: number; threadId?: string }
): Promise<UnifiedSearchResult[]> {
  const data = await fetchJSON<{ results: UnifiedSearchResult[] }>(`${API_BASE}/memories/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, ...options }),
  });
  return data.results;
}

// Archives
export async function fetchArchives(options?: {
  threadId?: string;
  limit?: number;
}): Promise<ArchiveSummary[]> {
  const params = new URLSearchParams();
  if (options?.threadId) params.set("threadId", options.threadId);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const data = await fetchJSON<{ summaries: ArchiveSummary[] }>(
    `${API_BASE}/archives${qs ? `?${qs}` : ""}`
  );
  return data.summaries;
}

export async function fetchArchiveChunk(threadId: string, chunkId: string): Promise<ArchiveChunk> {
  return fetchJSON<ArchiveChunk>(`${API_BASE}/archives/${threadId}/${chunkId}`);
}

// GitHub
export async function fetchPRs(options?: {
  repo?: string;
  state?: string;
}): Promise<PRSummary[]> {
  const params = new URLSearchParams();
  if (options?.repo) params.set("repo", options.repo);
  if (options?.state) params.set("state", options.state);
  const qs = params.toString();
  const data = await fetchJSON<{ prs: PRSummary[] }>(`${API_BASE}/github/prs${qs ? `?${qs}` : ""}`);
  return data.prs;
}

export async function fetchPRStatus(prNumber: number, repo?: string): Promise<PRStatus> {
  const params = new URLSearchParams();
  if (repo) params.set("repo", repo);
  const qs = params.toString();
  return fetchJSON<PRStatus>(`${API_BASE}/github/prs/${prNumber}${qs ? `?${qs}` : ""}`);
}

// Tools
export async function fetchTools(): Promise<string[]> {
  const data = await fetchJSON<{ tools: string[] }>(`${API_BASE}/tools`);
  return data.tools;
}

// Scheduler
export async function fetchScheduledJobs(options?: {
  status?: string;
}): Promise<ScheduledJob[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  const qs = params.toString();
  const data = await fetchJSON<{ jobs: ScheduledJob[] }>(
    `${API_BASE}/scheduler/jobs${qs ? `?${qs}` : ""}`
  );
  return data.jobs;
}
