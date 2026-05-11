export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-12 text-center text-gray-500 dark:text-gray-400">
      <div className="text-base font-medium">{title}</div>
      {hint && <div className="text-xs text-gray-400 dark:text-gray-500 max-w-md">{hint}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-8 text-sm text-gray-500 dark:text-gray-400">
      <span className="inline-block h-4 w-4 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin" />
      {label || 'Loading…'}
    </div>
  );
}

export function ErrorBox({ error }: { error: Error }) {
  return (
    <div className="m-4 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      <div className="font-semibold mb-1">Error</div>
      <div className="font-mono text-xs whitespace-pre-wrap">{error.message}</div>
    </div>
  );
}
