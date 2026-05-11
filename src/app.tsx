import './styles.built.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Routes, Route, useParams } from 'react-router-dom';
import { SessionList } from './views/SessionList';
import { SessionDetail } from './views/SessionDetail';
import { ThemeToggle } from './components/ThemeToggle';
import { TokenPrompt } from './components/TokenPrompt';
import { useDarkMode } from './hooks/useDarkMode';
import { api, setUnauthorizedHandler } from './lib/api';

function Shell({
  children,
  shareMode = false,
}: {
  children: React.ReactNode;
  shareMode?: boolean;
}) {
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800 px-6 py-2.5 flex items-center gap-4 shrink-0">
        {shareMode ? (
          <span className="text-base font-semibold tracking-tight">Claude Viz</span>
        ) : (
          <Link to="/" className="text-base font-semibold tracking-tight">
            Claude Viz
          </Link>
        )}
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {shareMode ? 'Shared session (read-only)' : 'Local-only session visualizer'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
    </div>
  );
}

function SharedSessionRoute() {
  const { token = '' } = useParams();
  return (
    <Shell shareMode>
      <SessionDetail shareToken={token} />
    </Shell>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'authed' | 'unauthed'>(
    'checking',
  );

  useEffect(() => {
    setUnauthorizedHandler(() => setState('unauthed'));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const queryToken = url.searchParams.get('token');
      if (queryToken) {
        const ok = await api.authLogin(queryToken).catch(() => false);
        url.searchParams.delete('token');
        const search = url.searchParams.toString();
        const cleaned = url.pathname + (search ? `?${search}` : '') + url.hash;
        window.history.replaceState({}, '', cleaned);
        if (ok) {
          setState('authed');
          return;
        }
      }
      const ok = await api.authCheck().catch(() => false);
      setState(ok ? 'authed' : 'unauthed');
    })();
  }, []);

  if (state === 'checking') {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-500">
        Loading…
      </div>
    );
  }
  if (state === 'unauthed') {
    return <TokenPrompt onSuccess={() => setState('authed')} />;
  }
  return <>{children}</>;
}

function App() {
  useDarkMode();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/share/:token" element={<SharedSessionRoute />} />
        <Route
          path="*"
          element={
            <AuthGate>
              <Shell>
                <Routes>
                  <Route path="/" element={<SessionList />} />
                  <Route path="/sessions/:id" element={<SessionDetail />} />
                  <Route
                    path="*"
                    element={
                      <div className="p-8 text-sm text-gray-500">
                        Not found.{' '}
                        <Link to="/" className="text-blue-600 underline">
                          Go home
                        </Link>
                      </div>
                    }
                  />
                </Routes>
              </Shell>
            </AuthGate>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');
createRoot(rootEl).render(<App />);
