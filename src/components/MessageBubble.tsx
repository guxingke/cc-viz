import { useState } from 'react';
import type { ContentBlock, ParsedEntry } from '../lib/types';
import { calcCost } from '../lib/pricing';
import { formatCost, formatSinceStart, formatTokens } from '../lib/format';
import { ToolCallCard, ToolGroupCard } from './ToolCallCard';
import type { ToolCallPairClient } from '../lib/toolCalls';
import { Markdown } from './Markdown';

type RenderItem =
  | { kind: 'block'; block: ContentBlock }
  | { kind: 'tool-group'; pairs: ToolCallPairClient[] };

function buildRenderItems(
  blocks: ContentBlock[],
  toolPairs: Map<string, ToolCallPairClient>,
  group: boolean,
): RenderItem[] {
  if (!group) return blocks.map((block) => ({ kind: 'block', block }) as RenderItem);
  const out: RenderItem[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'tool_use') {
      const name = String((b as { name?: unknown }).name ?? '');
      const ids: string[] = [String((b as { id?: unknown }).id ?? '')];
      let j = i + 1;
      while (j < blocks.length) {
        const nb = blocks[j];
        if (nb.type !== 'tool_use') break;
        if (String((nb as { name?: unknown }).name ?? '') !== name) break;
        ids.push(String((nb as { id?: unknown }).id ?? ''));
        j++;
      }
      if (ids.length >= 2) {
        const pairs = ids
          .map((id) => toolPairs.get(id))
          .filter((p): p is ToolCallPairClient => !!p);
        if (pairs.length >= 2) {
          out.push({ kind: 'tool-group', pairs });
          i = j;
          continue;
        }
      }
    }
    out.push({ kind: 'block', block: b });
    i++;
  }
  return out;
}

export function MessageBubble({
  entry,
  toolPairs,
  startedAt,
  concise = false,
}: {
  entry: ParsedEntry;
  toolPairs: Map<string, ToolCallPairClient>;
  startedAt: string;
  concise?: boolean;
}) {
  const isUser = entry.type === 'user';
  const isAssistant = entry.type === 'assistant';

  if (!isUser && !isAssistant) {
    if (concise) return null;
    return <SystemNote entry={entry} />;
  }

  const content = entry.message?.content;
  const blocks: ContentBlock[] = Array.isArray(content)
    ? (content as ContentBlock[])
    : typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : [];

  // For user entries that ONLY contain tool_result blocks, skip rendering — they're
  // already shown inside the corresponding tool card on the assistant side.
  const onlyToolResult =
    isUser && blocks.length > 0 && blocks.every((b) => b.type === 'tool_result');
  if (onlyToolResult) return null;

  const visibleBlocks = concise
    ? blocks.filter((b) => b.type !== 'thinking' && b.type !== 'tool_result')
    : blocks;
  const hasRenderableContent = visibleBlocks.some((b) => {
    if (b.type === 'text') {
      const t = (b as { text?: unknown }).text;
      return typeof t === 'string' && t.trim().length > 0;
    }
    if (b.type === 'tool_use') return true;
    if (b.type === 'thinking') {
      const t = (b as { thinking?: unknown }).thinking;
      return typeof t === 'string' && t.trim().length > 0;
    }
    return false;
  });
  if (isAssistant && !hasRenderableContent) return null;

  const usage = entry.message?.usage;
  const cost = isAssistant ? calcCost(entry.message?.model, usage) : 0;
  const totalTokens = usage
    ? (Number(usage.input_tokens) || 0) +
      (Number(usage.output_tokens) || 0) +
      (Number(usage.cache_creation_input_tokens) || 0) +
      (Number(usage.cache_read_input_tokens) || 0)
    : 0;

  const hasText = blocks.some(
    (b) => b.type === 'text' && typeof (b as { text?: unknown }).text === 'string',
  );
  const [mode, setMode] = useState<'preview' | 'raw'>('preview');

  return (
    <div className="my-3">
      <div className="flex items-baseline gap-2 mb-1 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-semibold uppercase tracking-wide">
          {isUser ? 'You' : 'Assistant'}
        </span>
        {isAssistant && entry.message?.model && (
          <span className="font-mono text-[10px] text-gray-400">{entry.message.model}</span>
        )}
        {entry.isSidechain && (
          <span className="text-[10px] px-1 rounded bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300">
            sub-agent
          </span>
        )}
        {entry.timestamp && (
          <span className="font-mono">{formatSinceStart(entry.timestamp, startedAt)}</span>
        )}
        {isAssistant && hasText && (
          <button
            onClick={() => setMode((m) => (m === 'preview' ? 'raw' : 'preview'))}
            className="ml-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:border-gray-400 dark:hover:border-gray-500"
            title="Toggle markdown preview / raw"
          >
            {mode === 'preview' ? 'raw' : 'preview'}
          </button>
        )}
      </div>
      <div
        className={
          'rounded-lg px-4 py-3 ' +
          (isUser
            ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50'
            : 'bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800')
        }
      >
        {buildRenderItems(visibleBlocks, toolPairs, concise).map((item, i) =>
          item.kind === 'tool-group' ? (
            <ToolGroupCard key={i} pairs={item.pairs} />
          ) : (
            <BlockView
              key={i}
              block={item.block}
              toolPairs={toolPairs}
              renderMarkdown={isAssistant && mode === 'preview'}
              compactTools={concise}
            />
          ),
        )}
      </div>
      {isAssistant && !concise && usage && entry.isFirstOfMessage && (
        <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 font-mono">
          {formatTokens(totalTokens)} tok · {formatCost(cost)}
          {(Number(usage.cache_read_input_tokens) || 0) > 0 && (
            <> · cache hit {formatTokens(Number(usage.cache_read_input_tokens) || 0)}</>
          )}
        </div>
      )}
    </div>
  );
}

function BlockView({
  block,
  toolPairs,
  renderMarkdown,
  compactTools,
}: {
  block: ContentBlock;
  toolPairs: Map<string, ToolCallPairClient>;
  renderMarkdown: boolean;
  compactTools: boolean;
}) {
  if (block.type === 'text') {
    const text = (block as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) return null;
    if (renderMarkdown) return <Markdown source={text} />;
    return <div className="text-sm whitespace-pre-wrap break-words">{text}</div>;
  }
  if (block.type === 'thinking') {
    return <ThinkingBlock text={String((block as { thinking?: unknown }).thinking ?? '')} />;
  }
  if (block.type === 'tool_use') {
    const id = String((block as { id?: unknown }).id ?? '');
    const pair = toolPairs.get(id);
    if (!pair) return null;
    return <ToolCallCard call={pair} compact={compactTools} />;
  }
  if (block.type === 'tool_result') {
    // Inline within tool_use card; not shown here.
    return null;
  }
  return (
    <div className="text-xs text-gray-500 italic">
      [unsupported block: {String((block as { type?: unknown }).type)}]
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="my-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        {open ? '▾' : '▸'} Thinking
      </button>
      {open && (
        <div className="mt-1 border-l-2 border-gray-300 dark:border-gray-700 pl-3 text-xs italic text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

function SystemNote({ entry }: { entry: ParsedEntry }) {
  const subtype = (entry as { subtype?: unknown }).subtype;
  const durationMs = (entry as { durationMs?: unknown }).durationMs;
  if (subtype === 'turn_duration' && typeof durationMs === 'number') {
    return (
      <div className="text-center my-2 text-[10px] text-gray-400 dark:text-gray-600 font-mono">
        ── turn took {(durationMs / 1000).toFixed(1)}s ──
      </div>
    );
  }
  return null;
}
