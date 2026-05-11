// Shared types between server and client.
// NOTE: keep this permissive — the JSONL format evolves, and parser
// must not throw on unknown fields.

export type EntryType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'permission-mode'
  | 'file-history-snapshot'
  | 'attachment'
  | 'last-prompt'
  | (string & {});

export type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: string; [key: string]: unknown };

export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  [key: string]: unknown;
};

export type RawEntry = {
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  type: EntryType;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  message?: {
    id?: string;
    role?: 'user' | 'assistant';
    model?: string;
    content?: ContentBlock[] | string;
    usage?: TokenUsage;
    stop_reason?: string;
    [key: string]: unknown;
  };
  toolUseResult?: unknown;
  summary?: string;
  leafUuid?: string;
  [key: string]: unknown;
};

export type ParsedEntry = RawEntry & {
  /** Whether this entry was successfully recognized; unknown types are kept but flagged. */
  recognized: boolean;
};

export type TreeNode = {
  uuid: string;
  parentUuid: string | null;
  children: TreeNode[];
  isSidechain: boolean;
};

export type ProjectSummary = {
  id: string;
  cwd: string;
  sessionCount: number;
  totalTokens: number;
  totalCostUsd: number;
  lastActiveAt: string;
};

export type SessionSummary = {
  id: string;
  projectId: string;
  cwd: string;
  title: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  toolCallCount: number;
  totalTokens: TokenUsage;
  totalCostUsd: number;
  model: string | null;
  hasSubagents: boolean;
};

export type SessionDetail = SessionSummary & {
  entries: ParsedEntry[];
  tree: TreeNode | null;
};
