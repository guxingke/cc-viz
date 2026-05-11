import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentBlock, ParsedEntry, SessionDetail } from '../lib/types';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { pairToolCallsClient } from '../lib/toolCalls';
import { MessageBubble } from './MessageBubble';
import { ErrorBox, Spinner } from './EmptyState';

function anchorTop(el: HTMLElement | null) {
  if (!el) return;
  const scroller = findScrollContainer(el);
  if (!scroller) {
    el.scrollIntoView({ block: 'start' });
    return;
  }
  const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += top;
}

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

export function SubagentEmbed({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => anchorTop(anchorRef.current));
        });
      }
      return next;
    });
  };

  return (
    <div className="mt-2" ref={anchorRef}>
      <button
        onClick={toggle}
        className="text-[11px] uppercase tracking-wide text-pink-700 dark:text-pink-300 hover:text-pink-900 dark:hover:text-pink-100"
      >
        {open ? '▾' : '▸'} Sub-agent timeline
      </button>
      {open && (
        <div className="mt-2 border-l-2 border-pink-300 dark:border-pink-800 pl-3">
          <SubagentBody sessionId={sessionId} onLoaded={() => anchorTop(anchorRef.current)} />
        </div>
      )}
    </div>
  );
}

function SubagentBody({
  sessionId,
  onLoaded,
}: {
  sessionId: string;
  onLoaded?: () => void;
}) {
  const { data, error, loading } = useFetch<SessionDetail>(
    () => api.session(sessionId),
    [sessionId],
  );

  const { rows, toolMap } = useMemo(() => {
    if (!data) return { rows: [] as ParsedEntry[], toolMap: new Map() };
    const pairs = pairToolCallsClient(data.entries, data.subagentLinks);
    const toolMap = new Map(pairs.map((p) => [p.id, p]));
    const rows = data.entries.filter((e) => {
      if (e.type !== 'user' && e.type !== 'assistant') return false;
      if (e.type === 'user' && Array.isArray(e.message?.content)) {
        const blocks = e.message!.content as ContentBlock[];
        if (blocks.length > 0 && blocks.every((b) => b.type === 'tool_result')) return false;
      }
      return true;
    });
    return { rows, toolMap };
  }, [data]);

  useEffect(() => {
    if (data && onLoaded) {
      requestAnimationFrame(() => {
        requestAnimationFrame(onLoaded);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  return (
    <div>
      <div className="text-[10px] font-mono text-gray-500 dark:text-gray-400 mb-1">
        {rows.length} messages · {toolMap.size} tool calls
      </div>
      {rows.map((entry) => (
        <MessageBubble
          key={entry.uuid || entry.timestamp}
          entry={entry}
          toolPairs={toolMap}
          startedAt={data.startedAt}
        />
      ))}
    </div>
  );
}
