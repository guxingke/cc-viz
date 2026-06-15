import { useState } from 'react';
import { api } from '../lib/api';

export function TokenPrompt({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = token.trim();
    if (!t) return;
    setSubmitting(true);
    setError(null);
    try {
      const ok = await api.authLogin(t);
      if (ok) onSuccess();
      else setError('Invalid token.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-full flex items-center justify-center bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <form
        onSubmit={submit}
        className="w-full max-w-sm p-6 border border-gray-200 dark:border-gray-800 rounded-md"
      >
        <h1 className="text-base font-semibold mb-1">Claude / Codex Viz</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Enter access token to continue.
        </p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token"
          autoFocus
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 dark:bg-gray-900 rounded-md outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting || !token.trim()}
          className="mt-4 w-full px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
        >
          {submitting ? 'Verifying…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
