import { useState } from 'react';

export function CodeBlock({
  code,
  lang,
  maxLines = 20,
  className = '',
}: {
  code: string;
  lang?: string;
  maxLines?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = code.split('\n');
  const overflow = lines.length > maxLines;
  const shown = expanded || !overflow ? lines : lines.slice(0, maxLines);

  return (
    <div className={`relative font-mono text-xs ${className}`}>
      {lang && (
        <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
          {lang}
        </div>
      )}
      <pre className="overflow-x-auto whitespace-pre rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-2 leading-relaxed text-gray-800 dark:text-gray-200">
        {shown.join('\n')}
        {overflow && !expanded && '\n…'}
      </pre>
      {overflow && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {expanded ? 'Collapse' : `Expand (${lines.length})`}
        </button>
      )}
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-xs px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
      {children}
    </code>
  );
}
