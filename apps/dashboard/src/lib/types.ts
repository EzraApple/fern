// Types mirroring the OpenCode SDK and Fern server API responses

export interface Session {
  id: string;
  projectID: string;
  directory: string;
  parentID?: string;
  share?: { url: string };
  title: string;
  version: string;
  time: {
    created: number;
    updated: number;
  };
}

export type Message = UserMessage | AssistantMessage;

export interface UserMessage {
  id: string;
  sessionID: string;
  role: "user";
  time: { created: number };
  agent: string;
  model: { providerID: string; modelID: string };
}

export interface AssistantMessage {
  id: string;
  sessionID: string;
  role: "assistant";
  time: { created: number; completed?: number };
  error?: { name: string; data: Record<string, unknown> };
  parentID: string;
  modelID: string;
  providerID: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
}

export type Part = TextPart | ToolPart | ReasoningPart | StepStartPart | StepFinishPart;

export interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
}

export interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state: ToolState;
}

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | {
      status: "running";
      input: Record<string, unknown>;
      title?: string;
      time: { start: number };
    }
  | {
      status: "completed";
      input: Record<string, unknown>;
      output: string;
      title: string;
      time: { start: number; end: number };
    }
  | {
      status: "error";
      input: Record<string, unknown>;
      error: string;
      time: { start: number; end: number };
    };

export interface ReasoningPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
}

export interface StepStartPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-start";
}

export interface StepFinishPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
}

export interface SessionMessage {
  info: Message;
  parts: Part[];
}

// Memory types
export interface PersistentMemory {
  id: string;
  type: "fact" | "preference" | "learning";
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UnifiedSearchResult {
  id: string;
  source: "archive" | "memory";
  text: string;
  relevanceScore: number;
  threadId?: string;
  tokenCount?: number;
  timeRange?: { start: number; end: number };
  memoryType?: "fact" | "preference" | "learning";
  tags?: string[];
}

export interface ArchiveSummary {
  id: string;
  threadId: string;
  summary: string;
  tokenCount: number;
  createdAt: string;
  timeStart: number;
  timeEnd: number;
}

export interface ArchiveChunk {
  id: string;
  threadId: string;
  openCodeSessionId: string;
  summary: string;
  messages: unknown[];
  tokenCount: number;
  messageCount: number;
  messageRange: {
    firstMessageId: string;
    lastMessageId: string;
    firstTimestamp: number;
    lastTimestamp: number;
  };
  createdAt: string;
}

// GitHub types
export interface PRSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  user: string;
  branch: string;
}

export interface PRStatus {
  state: string;
  mergeable: boolean | null;
  checks: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }>;
  reviews: Array<{
    user: string;
    state: string;
    submittedAt: string;
  }>;
}

// Scheduler types
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type JobType = "one_shot" | "recurring";

export interface ScheduledJob {
  id: string;
  type: JobType;
  status: JobStatus;
  prompt: string;
  scheduledAt: string;
  cronExpr?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastRunResponse?: string;
  lastError?: string;
  metadata: Record<string, unknown>;
}
