import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { SessionDetail } from '../lib/types';
import { MessageBubble } from '../components/MessageBubble';
import { pairToolCallsClient } from '../lib/toolCalls';

const CONCISE_KEY = 'cc-viz:timeline-concise';

export function Timeline({ detail }: { detail: SessionDetail }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [concise, setConcise] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(CONCISE_KEY) === '1';
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(CONCISE_KEY, concise ? '1' : '0');
    } catch {
      // ignore quota / disabled storage
    }
  }, [concise]);

  const { rows, toolMap } = useMemo(() => {
    const pairs = pairToolCallsClient(detail.entries, detail.subagentLinks);
    const toolMap = new Map(pairs.map((p) => [p.id, p]));
    // Filter to user/assistant/system entries; drop user entries that contain
    // ONLY tool_result blocks (already merged into tool cards above).
    // In concise mode, also drop turn_duration system rows and assistant
    // entries whose only content is thinking (no text, no tool_use).
    const rows = detail.entries.filter((e) => {
      if (e.type === 'system') {
        if (concise) return false;
        return (e as { subtype?: unknown }).subtype === 'turn_duration';
      }
      if (e.type !== 'user' && e.type !== 'assistant') return false;
      if (Array.isArray(e.message?.content)) {
        const blocks = e.message!.content as Array<{ type?: unknown }>;
        if (e.type === 'user' && blocks.length > 0 && blocks.every((b) => b.type === 'tool_result')) {
          return false;
        }
        if (concise && e.type === 'assistant') {
          const hasVisible = blocks.some(
            (b) => b.type === 'text' || b.type === 'tool_use',
          );
          if (!hasVisible) return false;
        }
      }
      return true;
    });
    return { rows, toolMap };
  }, [detail.entries, concise]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 8,
  });

  const [cursor, setCursor] = useState(0);

  const scrollTo = (index: number) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    setCursor(clamped);
    virtualizer.scrollToIndex(clamped, { align: 'start' });
  };
  const nextToolIndex = () => rows.findIndex((e, i) => i > cursor && hasToolUse(e));
  const nextSidechainIndex = () => rows.findIndex((e, i) => i > cursor && e.isSidechain);

  useEffect(() => {
    const isInputFocused = () => {
      const t = document.activeElement;
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (t as HTMLElement).isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isInputFocused()) return;
      if (e.key === 'j') {
        e.preventDefault();
        scrollTo(cursor + 1);
      } else if (e.key === 'k') {
        e.preventDefault();
        scrollTo(cursor - 1);
      } else if (e.key === 'g') {
        e.preventDefault();
        scrollTo(0);
      } else if (e.key === 'G') {
        e.preventDefault();
        scrollTo(rows.length - 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, rows.length]);

  function hasToolUse(e: (typeof rows)[number]): boolean {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) return false;
    return (e.message!.content as Array<{ type?: unknown }>).some((b) => b.type === 'tool_use');
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-2 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-900/30">
        <button
          onClick={() => scrollTo(0)}
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          ↑ Top
        </button>
        <button
          onClick={() => scrollTo(rows.length - 1)}
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          ↓ Bottom
        </button>
        <button
          onClick={() => {
            const i = nextToolIndex();
            if (i >= 0) scrollTo(i);
          }}
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          → Next tool call
        </button>
        {detail.hasSubagents && (
          <button
            onClick={() => {
              const i = nextSidechainIndex();
              if (i >= 0) scrollTo(i);
            }}
            className="hover:text-pink-700 dark:hover:text-pink-300"
          >
            → Next sub-agent
          </button>
        )}
        <button
          onClick={() => setConcise((v) => !v)}
          className={
            'ml-auto text-[11px] uppercase tracking-wide px-2 py-0.5 rounded border ' +
            (concise
              ? 'border-blue-400 dark:border-blue-500 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40'
              : 'border-gray-200 dark:border-gray-700 hover:text-gray-900 dark:hover:text-gray-100 hover:border-gray-400 dark:hover:border-gray-500')
          }
          title="Concise mode: hide thinking, turn-duration & usage; compact tool calls"
        >
          {concise ? '● Concise' : '○ Concise'}
        </button>
        <span className="font-mono">
          {rows.length} rows · {toolMap.size} tool calls
        </span>
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto px-6 py-2">
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const entry = rows[vi.index];
            return (
              <div
                key={vi.key}
                ref={virtualizer.measureElement}
                data-index={vi.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <MessageBubble
                  entry={entry}
                  toolPairs={toolMap}
                  startedAt={detail.startedAt}
                  concise={concise}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
