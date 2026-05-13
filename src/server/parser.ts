import type {
  ContentBlock,
  ParsedEntry,
  RawEntry,
  SessionDetail,
  TokenUsage,
  TreeNode,
} from '../lib/types';
import { calcCost, resolvePricing } from '../lib/pricing';

const CONVO_TYPES = new Set(['user', 'assistant']);
const META_TYPES = new Set([
  'system',
  'summary',
  'ai-title',
  'agent-name',
  'permission-mode',
  'file-history-snapshot',
  'attachment',
  'last-prompt',
  'queue-operation',
]);

export type ParseResult = {
  detail: SessionDetail;
  skippedLines: number;
  parseErrors: number;
};

export function parseSessionText(text: string, sessionId: string, projectId: string): ParseResult {
  const lines = text.split('\n');
  const rawEntries: RawEntry[] = [];
  let parseErrors = 0;
  let skippedLines = 0;

  for (const line of lines) {
    if (!line.trim()) {
      skippedLines++;
      continue;
    }
    try {
      const obj = JSON.parse(line) as RawEntry;
      rawEntries.push(obj);
    } catch {
      parseErrors++;
    }
  }

  // Title resolution: prefer ai-title / summary; fallback to first user text.
  let title = '';
  for (const e of rawEntries) {
    if (e.type === 'ai-title' && typeof (e as RawEntry).aiTitle === 'string') {
      title = String((e as RawEntry).aiTitle);
      break;
    }
    if (e.type === 'summary' && typeof e.summary === 'string') {
      title = e.summary;
      break;
    }
  }
  if (!title) {
    const firstUser = rawEntries.find(
      (e) => e.type === 'user' && e.message && typeof e.message === 'object',
    );
    title = extractFirstText(firstUser?.message?.content) || 'Untitled session';
    if (title.length > 80) title = title.slice(0, 80) + '…';
  }

  // Filter to entries we care about (recognised + sorted).
  const parsedEntries: ParsedEntry[] = rawEntries
    .filter((e) => CONVO_TYPES.has(e.type) || META_TYPES.has(e.type))
    .map((e) => ({ ...e, recognized: CONVO_TYPES.has(e.type) || e.type === 'system' }))
    .sort((a, b) => {
      const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
      const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
      return ta - tb;
    });

  // Mark first-of-message on assistant entries so downstream consumers can dedupe usage.
  const seenMsgIds = new Set<string>();
  for (const e of parsedEntries) {
    if (e.type !== 'assistant') continue;
    const mid = e.message?.id;
    if (!mid) {
      e.isFirstOfMessage = true;
      continue;
    }
    if (seenMsgIds.has(mid)) {
      e.isFirstOfMessage = false;
    } else {
      seenMsgIds.add(mid);
      e.isFirstOfMessage = true;
    }
  }

  // Tree from parentUuid relationship — must include all uuid-bearing entries
  // because assistant/user entries often have parentUuid pointing to a
  // system/attachment node, so filtering breaks the chain.
  const tree = buildTree(parsedEntries.filter((e) => !!e.uuid));

  // Totals.
  const totalTokens: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let totalCostUsd = 0;
  let toolCallCount = 0;
  let hasSubagents = false;
  const modelCounts = new Map<string, number>();
  let cwd = '';
  let startedAt = '';
  let endedAt = '';

  for (const e of parsedEntries) {
    if (e.cwd && !cwd) cwd = e.cwd;
    if (e.timestamp) {
      if (!startedAt) startedAt = e.timestamp;
      endedAt = e.timestamp;
    }
    if (e.isSidechain) hasSubagents = true;

    if (e.type !== 'assistant' && e.type !== 'user') continue;

    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const block of e.message!.content as ContentBlock[]) {
        if (block.type === 'tool_use') toolCallCount++;
      }
    }

    if (e.type === 'assistant') {
      if (e.isFirstOfMessage) {
        const usage = e.message?.usage;
        if (usage) {
          addUsage(totalTokens, usage);
          totalCostUsd += calcCost(e.message?.model, usage);
        }
      }
      const m = e.message?.model;
      if (m) modelCounts.set(m, (modelCounts.get(m) || 0) + 1);
    }
  }

  const messageCount = parsedEntries.filter((e) => CONVO_TYPES.has(e.type)).length;
  const model = pickTopModel(modelCounts);

  const detail: SessionDetail = {
    id: sessionId,
    projectId,
    cwd,
    title,
    startedAt,
    endedAt,
    messageCount,
    toolCallCount,
    totalTokens,
    totalCostUsd,
    model,
    hasSubagents,
    entries: parsedEntries,
    tree,
  };

  return { detail, skippedLines, parseErrors };
}

function extractFirstText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
}

function addUsage(into: TokenUsage, src: TokenUsage) {
  into.input_tokens = (into.input_tokens || 0) + (Number(src.input_tokens) || 0);
  into.output_tokens = (into.output_tokens || 0) + (Number(src.output_tokens) || 0);
  into.cache_creation_input_tokens =
    (into.cache_creation_input_tokens || 0) + (Number(src.cache_creation_input_tokens) || 0);
  into.cache_read_input_tokens =
    (into.cache_read_input_tokens || 0) + (Number(src.cache_read_input_tokens) || 0);
}

function pickTopModel(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [m, n] of counts) if (n > bestN) ((bestN = n), (best = m));
  return best;
}

function buildTree(entries: ParsedEntry[]): TreeNode | null {
  if (entries.length === 0) return null;
  const byUuid = new Map<string, TreeNode>();
  for (const e of entries) {
    if (!e.uuid) continue;
    byUuid.set(e.uuid, {
      uuid: e.uuid,
      parentUuid: e.parentUuid ?? null,
      children: [],
      isSidechain: !!e.isSidechain,
    });
  }
  let root: TreeNode | null = null;
  for (const e of entries) {
    if (!e.uuid) continue;
    const node = byUuid.get(e.uuid)!;
    const parentId = e.parentUuid;
    if (parentId && byUuid.has(parentId)) {
      byUuid.get(parentId)!.children.push(node);
    } else if (!root) {
      root = node;
    }
  }
  return root;
}

/**
 * Pair tool_use blocks (in assistant entries) with their tool_result blocks
 * (in subsequent user entries). Returns a flat list keyed by tool_use_id.
 */
export type ToolCallPair = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  assistantUuid: string | undefined;
  assistantTimestamp: string | undefined;
  result?: {
    content: unknown;
    isError: boolean;
    userUuid: string | undefined;
    userTimestamp: string | undefined;
    /** outer toolUseResult — some Claude Code versions store result payload here */
    outer?: unknown;
  };
};

export function pairToolCalls(entries: ParsedEntry[]): ToolCallPair[] {
  const pairs = new Map<string, ToolCallPair>();
  for (const e of entries) {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message!.content as ContentBlock[]) {
      if (block.type !== 'tool_use') continue;
      const b = block as { id?: unknown; name?: unknown; input?: unknown };
      const id = typeof b.id === 'string' ? b.id : '';
      if (!id) continue;
      pairs.set(id, {
        id,
        name: typeof b.name === 'string' ? b.name : 'unknown',
        input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>,
        assistantUuid: e.uuid,
        assistantTimestamp: e.timestamp,
      });
    }
  }
  for (const e of entries) {
    if (e.type !== 'user' || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message!.content as ContentBlock[]) {
      if (block.type !== 'tool_result') continue;
      const b = block as { tool_use_id?: unknown; content?: unknown; is_error?: unknown };
      const id = typeof b.tool_use_id === 'string' ? b.tool_use_id : '';
      if (!id) continue;
      const pair = pairs.get(id);
      if (!pair) continue;
      pair.result = {
        content: b.content,
        isError: !!b.is_error,
        userUuid: e.uuid,
        userTimestamp: e.timestamp,
        outer: e.toolUseResult,
      };
    }
  }
  return [...pairs.values()];
}

export { resolvePricing };
