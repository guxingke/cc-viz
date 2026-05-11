import type { ContentBlock, ParsedEntry } from './types';

export type ToolCallPairClient = {
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
    outer?: unknown;
  };
  /** For Task/Agent tool calls: the resolved sub-agent session id, if any. */
  subagentSessionId?: string;
};

export function pairToolCallsClient(
  entries: ParsedEntry[],
  subagentLinks?: Record<string, string>,
): ToolCallPairClient[] {
  const pairs = new Map<string, ToolCallPairClient>();
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
        subagentSessionId: subagentLinks?.[id],
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
