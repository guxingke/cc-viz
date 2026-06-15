import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type SearchHit } from '../lib/api';
import {
  formatCost,
  formatRelative,
  formatTokens,
  shortenCwd,
  truncate,
} from '../lib/format';
import { useFetch } from '../hooks/useFetch';
import { EmptyState, ErrorBox, Spinner } from '../components/EmptyState';

export function SessionList() {
  const [params, setParams] = useSearchParams();
  const selectedProject = params.get('project') || '';
  const searchQuery = params.get('q') || '';

  const projectsQ = useFetch(() => api.projects(), []);
  const sessionsQ = useFetch(() => api.sessions(), []);

  const [query, setQuery] = useState(searchQuery);
  const searchQ = useFetch(
    () => (searchQuery ? api.search(searchQuery) : Promise.resolve<SearchHit[]>([])),
    [searchQuery],
  );

  const filteredSessions = useMemo(() => {
    const sessions = sessionsQ.data ?? [];
    if (!selectedProject) return sessions;
    return sessions.filter((s) => s.projectId === selectedProject);
  }, [sessionsQ.data, selectedProject]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
        <div className="px-4 py-3 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Projects
        </div>
        {projectsQ.loading && <Spinner />}
        {projectsQ.error && <ErrorBox error={projectsQ.error} />}
        {projectsQ.data && (
          <nav>
            <ProjectRow
              label="All projects"
              hint={`${sessionsQ.data?.length ?? '…'} sessions`}
              active={!selectedProject}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete('project');
                setParams(next, { replace: true });
              }}
            />
            {projectsQ.data.map((p) => (
              <ProjectRow
                key={p.id}
                label={shortenCwd(p.cwd)}
                source={p.source}
                hint={`${p.sessionCount} · ${formatTokens(p.totalTokens)} · ${formatCost(
                  p.totalCostUsd,
                )} · ${formatRelative(p.lastActiveAt)}`}
                active={selectedProject === p.id}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set('project', p.id);
                  setParams(next, { replace: true });
                }}
              />
            ))}
          </nav>
        )}
      </aside>

      <section className="flex-1 min-w-0 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white/90 dark:bg-gray-950/90 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center gap-3">
          <input
            type="search"
            value={query}
            placeholder="Search across all sessions…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const next = new URLSearchParams(params);
                if (query.trim()) next.set('q', query.trim());
                else next.delete('q');
                setParams(next, { replace: true });
              }
            }}
            className="flex-1 max-w-lg rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              onClick={() => {
                setQuery('');
                const next = new URLSearchParams(params);
                next.delete('q');
                setParams(next, { replace: true });
              }}
            >
              Clear search
            </button>
          )}
        </div>

        {searchQuery ? (
          <SearchResults
            loading={searchQ.loading}
            error={searchQ.error}
            hits={searchQ.data ?? []}
            query={searchQuery}
          />
        ) : sessionsQ.loading ? (
          <Spinner label="Loading sessions…" />
        ) : sessionsQ.error ? (
          <ErrorBox error={sessionsQ.error} />
        ) : filteredSessions.length === 0 ? (
          <EmptyState
            title="No sessions"
            hint="Run Claude Code or Codex in any directory to create a session."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
              <tr className="text-left">
                <th className="px-6 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium text-right">Msgs</th>
                <th className="px-3 py-2 font-medium text-right">Tools</th>
                <th className="px-3 py-2 font-medium text-right">Tokens</th>
                <th className="px-3 py-2 font-medium text-right">Cost</th>
                <th className="px-3 py-2 font-medium">Model</th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-gray-100 dark:border-gray-900 hover:bg-gray-50 dark:hover:bg-gray-900/50"
                >
                  <td className="px-6 py-2 max-w-md">
                    <Link to={`/sessions/${s.id}`} className="block">
                      <div className="font-medium truncate text-gray-900 dark:text-gray-100">
                        {truncate(s.title || 'Untitled', 90)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate font-mono flex items-center gap-1.5">
                        <SourceBadge source={s.source} />
                        <span className="truncate">{shortenCwd(s.cwd)}</span>
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {formatRelative(s.startedAt)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.messageCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.toolCallCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatTokens(sumTokens(s.totalTokens))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCost(s.totalCostUsd)}
                  </td>
                  <td className="px-3 py-2">
                    <ModelBadge model={s.model} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function sumTokens(t: { [k: string]: unknown }): number {
  return (
    (Number(t.input_tokens) || 0) +
    (Number(t.output_tokens) || 0) +
    (Number(t.cache_creation_input_tokens) || 0) +
    (Number(t.cache_read_input_tokens) || 0)
  );
}

function ProjectRow({
  label,
  source,
  hint,
  active,
  onClick,
}: {
  label: string;
  source?: 'claude' | 'codex';
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'w-full text-left px-4 py-2 border-l-2 transition-colors ' +
        (active
          ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
          : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-900/50')
      }
    >
      <div className="text-sm font-medium truncate text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
        {source && <SourceBadge source={source} />}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{hint}</div>
    </button>
  );
}

function SourceBadge({ source }: { source: 'claude' | 'codex' }) {
  const cls =
    source === 'codex'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      : 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300';
  return (
    <span className={`inline-block rounded px-1 py-0.5 text-[10px] font-mono uppercase ${cls}`}>
      {source}
    </span>
  );
}

function ModelBadge({ model }: { model: string | null }) {
  if (!model) return <span className="text-xs text-gray-400">—</span>;
  const color = model.includes('opus')
    ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
    : model.includes('sonnet')
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
      : model.includes('haiku')
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono ${color}`}>
      {model}
    </span>
  );
}

function SearchResults({
  loading,
  error,
  hits,
  query,
}: {
  loading: boolean;
  error: Error | null;
  hits: SearchHit[];
  query: string;
}) {
  if (loading) return <Spinner label={`Searching "${query}"…`} />;
  if (error) return <ErrorBox error={error} />;
  if (hits.length === 0)
    return <EmptyState title="No matches" hint={`No sessions contained "${query}"`} />;
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-900">
      <div className="px-6 py-2 text-xs text-gray-500 dark:text-gray-400">
        {hits.length} session{hits.length === 1 ? '' : 's'} matched
      </div>
      {hits.map((h) => (
        <Link
          key={h.sessionId}
          to={`/sessions/${h.sessionId}`}
          className="block px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50"
        >
          <div className="flex items-baseline gap-2">
            <div className="font-medium truncate text-gray-900 dark:text-gray-100">
              {truncate(h.title, 90)}
            </div>
            <div className="text-xs text-gray-400">{h.matchCount} matches</div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
            {shortenCwd(h.cwd)}
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 italic">
            <Highlight text={h.snippet} q={query} />
          </div>
        </Link>
      ))}
    </div>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const ql = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let last = 0;
  const lower = text.toLowerCase();
  while ((i = lower.indexOf(ql, last)) !== -1) {
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <mark
        key={i}
        className="bg-yellow-200 dark:bg-yellow-800/60 text-inherit rounded px-0.5"
      >
        {text.slice(i, i + ql.length)}
      </mark>,
    );
    last = i + ql.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
