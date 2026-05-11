import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { useEffect, useState } from 'react';

export function DiffViewer({
  oldText,
  newText,
  filePath,
}: {
  oldText: string;
  newText: string;
  filePath?: string;
}) {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="text-xs font-mono rounded border border-gray-200 dark:border-gray-800 overflow-hidden">
      {filePath && (
        <div className="px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400">
          {filePath}
        </div>
      )}
      <ReactDiffViewer
        oldValue={oldText}
        newValue={newText}
        splitView={false}
        compareMethod={DiffMethod.LINES}
        useDarkTheme={isDark}
        hideLineNumbers={false}
        styles={{
          variables: {
            light: { codeFoldBackground: '#f7f7f7' },
          },
          contentText: { fontSize: '12px' },
          line: { padding: '0 8px' },
        }}
      />
    </div>
  );
}
