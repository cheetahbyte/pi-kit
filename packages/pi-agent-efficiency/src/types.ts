export type EventKind =
  | "user_message" | "assistant_turn" | "search" | "read"
  | "semantic_navigation" | "edit" | "write" | "validation" | "bash"
  | "subagent" | "tool_error" | "compaction" | "completion";

export interface WorkflowEvent {
  id?: number;
  sessionId: string;
  at: number;
  kind: EventKind;
  toolName?: string;
  toolCallId?: string;
  target?: string;
  range?: string;
  fingerprint?: string;
  fileGeneration?: number;
  durationMs?: number;
  isError?: boolean;
  result?: "pass" | "fail" | "unknown";
  metadata?: Record<string, unknown>;
}

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt?: number;
  cwd: string;
  project: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  outcome: "completed" | "abandoned" | "interrupted" | "unknown";
  tags: string[];
  piVersion?: string;
  extensionVersion: string;
  gitBranch?: string;
  gitCommit?: string;
}

export interface SessionMetrics extends Record<string, unknown> {
  sessionId: string;
  sessionDurationMs: number;
  toolCalls: number;
  toolCallsBeforeFirstEdit: number;
  readsBeforeFirstEdit: number;
  searchesBeforeFirstEdit: number;
  semanticNavigationBeforeFirstEdit: number;
  timeToFirstEditMs: number | null;
  totalFileReads: number;
  uniqueFilesRead: number;
  repeatedFileReads: number;
  repeatedSameRangeReads: number;
  differentRangeRereads: number;
  rereadsAfterModification: number;
  rereadsAfterCompaction: number;
  fileReadRedundancyRatio: number;
  uniqueSearches: number;
  repeatedSearches: number;
  searchRedundancyRatio: number;
  filesModified: number;
  editOperations: number;
  editsPerModifiedFile: number;
  timeFirstEditToFirstValidationMs: number | null;
  editOperationsBeforeFirstValidation: number;
  sameRegionReedits: number;
  sameFileReedits: number;
  editRevertCycles: number;
  validationRuns: number;
  validationFailures: number;
  validationSuccesses: number;
  editsBetweenValidations: number[];
  timeBetweenEditAndValidationMs: number[];
  firstValidationResult: string | null;
  finalValidationResult: string | null;
  toolErrors: number;
  toolErrorRate: number;
  errorsByTool: Record<string, number>;
  repeatedIdenticalErrors: number;
  failureLoops: number;
  subagentCalls: number;
  subagentDurationMs: number;
  subagentToolCalls: number | null;
  subagentTokens: number | null;
  compactions: number;
  messages: number;
  modelTurns: number;
  sequence: string[];
}
