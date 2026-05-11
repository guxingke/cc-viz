import { useMemo, useState } from 'react';
import type { SessionDetail } from '../lib/types';
import { pairToolCallsClient, type ToolCallPairClient } from '../lib/toolCalls';
import { ToolCallCard } from '../components/ToolCallCard';
import { EmptyState } from '../components/EmptyState';

type SortMode = 'time' | 'duration';

export function ToolCalls({ detail }: { detail: SessionDetail }) {
  const allCalls = useMemo(
    () => pairToolCallsClient(detail.entries, detail.subagentLinks),
    [detail.entries, detail.subagentLinks],
  );
  const [filter, setFilter] = useState<string>('all');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>('time');

  const toolNames = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCalls) set.add(c.name);
    return [...set].sort();
  }, [allCalls]);

  const calls = useMemo(() => {
    let list = allCalls;
    if (filter !== 'all') list = list.filter((c) => c.name === filter);
    if (errorsOnly) list = list.filter((c) => c.result?.isError);
    if (sort === 'duration') {
      list = [...list].sort((a, b) => duration(b) - duration(a));
    }
    return list;
  }, [allCalls, filter, errorsOnly, sort]);

  if (allCalls.length === 0) {
    return <EmptyState title="No tool calls in this session" />;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-2 flex items-center flex-wrap gap-3 text-xs bg-gray-50/50 dark:bg-gray-900/30">
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500 dark:text-gray-400">Tool:</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
          >
            <option value="all">All ({allCalls.length})</option>
            {toolNames.map((name) => {
              const n = allCalls.filter((c) => c.name === name).length;
              return (
                <option key={name} value={name}>
                  {name} ({n})
                </option>
              );
            })}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => setErrorsOnly(e.target.checked)}
          />
          <span className="text-gray-700 dark:text-gray-300">Errors only</span>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500 dark:text-gray-400">Sort:</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
          >
            <option value="time">By time</option>
            <option value="duration">By duration ↓</option>
          </select>
        </label>
        <span className="ml-auto text-gray-500 dark:text-gray-400 font-mono">
          Showing {calls.length} of {allCalls.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-3">
        {calls.length === 0 ? (
          <EmptyState title="No matches" />
        ) : (
          <ol className="space-y-1 max-w-4xl mx-auto">
            {calls.map((c, i) => (
              <li key={c.id} className="flex gap-3 items-start">
                <span className="text-xs text-gray-400 dark:text-gray-600 font-mono mt-2 w-8 text-right shrink-0 tabular-nums">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <ToolCallCard call={c} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function duration(c: ToolCallPairClient): number {
  if (!c.assistantTimestamp || !c.result?.userTimestamp) return 0;
  return Date.parse(c.result.userTimestamp) - Date.parse(c.assistantTimestamp);
}
