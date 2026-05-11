import { useDarkMode } from '../hooks/useDarkMode';

export function ThemeToggle() {
  const { mode, setMode } = useDarkMode();
  const cycle = () => {
    setMode(mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light');
  };
  return (
    <button
      onClick={cycle}
      title={`Theme: ${mode} (click to cycle)`}
      className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
    >
      {mode === 'light' ? '☀️' : mode === 'dark' ? '🌙' : '🖥'} {mode}
    </button>
  );
}
