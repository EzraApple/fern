/** Subagent specialization — determines capabilities and turn limits */
export type SubagentType = "explore" | "research" | "general";

/** Status lifecycle: pending → running → completed | failed; pending → cancelled */
export type SubagentTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** A subagent task in the database */
export interface SubagentTask {
  id: string;
  agentType: SubagentType;
  status: SubagentTaskStatus;
  prompt: string;
  parentSessionId: string; // thread ID of the spawning session
  createdAt: string; // ISO 8601
  updatedAt: string;
  completedAt?: string;
  result?: string; // response text on completion
  error?: string; // error message on failure
}

/** Input for spawning a new subagent task */
export interface SpawnTaskInput {
  agentType: SubagentType;
  prompt: string;
  parentSessionId: string;
}

/** Subagent system configuration */
export interface SubagentConfig {
  enabled: boolean;
  maxConcurrentTasks: number;
}
