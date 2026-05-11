import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Share, ShareTTL } from '../lib/types';
import { formatDateTime } from '../lib/format';

const TTL_OPTIONS: { label: string; value: ShareTTL }[] = [
  { label: '1 day', value: '1d' },
  { label: '7 days', value: '7d' },
  { label: 'Never', value: null },
];

function buildShareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

function isExpired(s: Share): boolean {
  if (!s.expiresAt) return false;
  const t = Date.parse(s.expiresAt);
  return Number.isFinite(t) && t <= Date.now();
}

export function ShareDialog({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [ttl, setTtl] = useState<ShareTTL>('7d');
  const [creating, setCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const list = await api.shareList(sessionId);
      setShares(list);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function onCreate() {
    setCreating(true);
    setError(null);
    try {
      await api.shareCreate({
        sessionId,
        label: label.trim() || null,
        ttl,
      });
      setLabel('');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(token: string) {
    setError(null);
    try {
      const ok = await api.shareRevoke(token);
      if (!ok) setError('Revoke failed.');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onCopy(token: string) {
    const url = buildShareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken((c) => (c === token ? null : c)), 1500);
    } catch {
      window.prompt('Copy share URL:', url);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Share session</h3>
          <button
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          >
            Close
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="space-y-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Create a new share link
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional)"
                className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-700 dark:bg-gray-950 rounded-md outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={ttl ?? 'never'}
                onChange={(e) =>
                  setTtl(
                    e.target.value === 'never' ? null : (e.target.value as ShareTTL),
                  )
                }
                className="px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-700 dark:bg-gray-950 rounded-md"
              >
                {TTL_OPTIONS.map((o) => (
                  <option key={String(o.value)} value={o.value ?? 'never'}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                onClick={onCreate}
                disabled={creating}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          )}

          <div className="space-y-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Active links
            </div>
            {!shares && <div className="text-xs text-gray-500">Loading…</div>}
            {shares && shares.length === 0 && (
              <div className="text-xs text-gray-500">No share links yet.</div>
            )}
            {shares && shares.length > 0 && (
              <ul className="divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-md">
                {shares.map((s) => {
                  const expired = isExpired(s);
                  return (
                    <li key={s.token} className="px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {s.label || <span className="text-gray-400">(no label)</span>}
                            {expired && (
                              <span className="ml-2 text-red-600 dark:text-red-400">
                                expired
                              </span>
                            )}
                          </div>
                          <div className="text-gray-500 dark:text-gray-400 font-mono truncate">
                            {buildShareUrl(s.token)}
                          </div>
                          <div className="text-gray-400 dark:text-gray-500 mt-0.5">
                            Created {formatDateTime(s.createdAt)}
                            {' · '}
                            {s.expiresAt
                              ? `Expires ${formatDateTime(s.expiresAt)}`
                              : 'Never expires'}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-1">
                          <button
                            onClick={() => onCopy(s.token)}
                            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            {copiedToken === s.token ? 'Copied' : 'Copy'}
                          </button>
                          <button
                            onClick={() => onRevoke(s.token)}
                            className="px-2 py-1 text-xs border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
