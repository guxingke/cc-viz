import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import {
  formatCost,
  formatDateTime,
  formatTokens,
  shortenCwd,
  truncate,
} from '../lib/format';
import { EmptyState, ErrorBox, Spinner } from '../components/EmptyState';
import { ShareDialog } from '../components/ShareDialog';
import { Timeline } from './Timeline';
import { ToolCalls } from './ToolCalls';
import { TokenChart } from './TokenChart';
import { AgentTree } from './AgentTree';

const TABS = ['timeline', 'tools', 'tokens', 'tree'] as const;
type Tab = (typeof TABS)[number];

export function SessionDetail({
  shareToken,
}: {
  /** When set, fetch the session via the share-scoped API and hide owner-only UI. */
  shareToken?: string;
} = {}) {
  const { id: routeId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') || '')
    ? (params.get('tab') as Tab)
    : 'timeline';

  const shareMode = !!shareToken;
  const q = useFetch(
    () => (shareToken ? api.sharedSession(shareToken) : api.session(routeId)),
    [shareToken, routeId],
  );
  const [shareOpen, setShareOpen] = useState(false);

  if (q.loading) return <Spinner label="Loading session…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <EmptyState title="Session not found" />;

  const s = q.data;
  const totalTokens =
    (Number(s.totalTokens.input_tokens) || 0) +
    (Number(s.totalTokens.output_tokens) || 0) +
    (Number(s.totalTokens.cache_creation_input_tokens) || 0) +
    (Number(s.totalTokens.cache_read_input_tokens) || 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="border-b border-gray-200 dark:border-gray-800 px-6 pt-4 pb-2">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0 flex-1">
            {!shareMode && (
              <Link
                to="/"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                ← All sessions
              </Link>
            )}
            <h2 className="text-lg font-semibold mt-1 truncate">{truncate(s.title, 140)}</h2>
            <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
              {shortenCwd(s.cwd)}
            </div>
          </div>
          <div className="shrink-0 text-right text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            <div className="flex items-center justify-end gap-2">
              <span>{formatDateTime(s.startedAt)}</span>
              {!shareMode && (
                <button
                  onClick={() => setShareOpen(true)}
                  className="px-2 py-0.5 text-xs border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Share
                </button>
              )}
            </div>
            <div className="font-mono">
              {s.messageCount} msg · {s.toolCallCount} tools · {formatTokens(totalTokens)} ·{' '}
              {formatCost(s.totalCostUsd)}
            </div>
            <div className="font-mono">{s.model ?? '—'}</div>
          </div>
        </div>
        <div className="flex gap-1 mt-3 -mb-px">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('tab', t);
                setParams(next, { replace: true });
              }}
              className={
                'px-3 py-1.5 text-sm border-b-2 transition-colors ' +
                (tab === t
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100')
              }
            >
              {t === 'timeline'
                ? 'Timeline'
                : t === 'tools'
                  ? 'Tool calls'
                  : t === 'tokens'
                    ? 'Tokens'
                    : 'Agent tree'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'timeline' && <Timeline detail={s} />}
        {tab === 'tools' && <ToolCalls detail={s} />}
        {tab === 'tokens' && <TokenChart detail={s} />}
        {tab === 'tree' && <AgentTree detail={s} />}
      </div>

      {!shareMode && shareOpen && (
        <ShareDialog sessionId={s.id} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
