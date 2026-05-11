import { useEffect, useState } from 'react';

type Mode = 'light' | 'dark' | 'system';
const KEY = 'cc-viz:theme';

function applyMode(mode: Mode) {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode === 'system' && systemDark);
  document.documentElement.classList.toggle('dark', dark);
}

export function useDarkMode() {
  const [mode, setMode] = useState<Mode>(() => {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  });

  useEffect(() => {
    applyMode(mode);
    if (mode === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  }, [mode]);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => mode === 'system' && applyMode('system');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [mode]);

  return { mode, setMode };
}
