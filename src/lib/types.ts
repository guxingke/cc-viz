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
  /** Aggregate of 5m + 1h cache writes. Prefer `cache_creation` breakdown when present
   *  for accurate cost calc (1h cache is 2× input vs 5m cache 1.25×). */
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
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
  /** For assistant entries only: true on the first entry sharing a given `message.id`.
   *  Claude Code splits one API response into multiple JSONL entries (one per content
   *  block) and duplicates `message.usage` on each. Use this flag to dedupe when
   *  aggregating tokens / cost. Undefined for non-assistant entries. */
  isFirstOfMessage?: boolean;
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
  /**
   * Map of Task/Agent tool_use id → sub-agent session id, derived from the
   * sibling `<parent>/<id>/subagents/agent-XXX.meta.json` files. Only populated
   * by the owner-token API; share-link responses omit this since sub-agent
   * sessions are not implicitly shared.
   */
  subagentLinks?: Record<string, string>;
};

/** Share-link TTL options accepted from clients. `null` = never expires. */
export type ShareTTL = '1d' | '7d' | null;

export type Share = {
  token: string;
  sessionId: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export type ShareCreateInput = {
  sessionId: string;
  label?: string | null;
  ttl?: ShareTTL;
};
