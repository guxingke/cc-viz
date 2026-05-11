import { useState } from 'react';
import type { ToolCallPairClient } from '../lib/toolCalls';
import { CodeBlock } from './CodeBlock';
import { DiffViewer } from './DiffViewer';
import { truncate } from '../lib/format';

const TOOL_COLORS: Record<string, string> = {
  Read: 'bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-900',
  Write: 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900',
  Edit: 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900',
  MultiEdit: 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900',
  Bash: 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800',
  Grep: 'bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-900',
  Glob: 'bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-900',
  Task: 'bg-pink-50 dark:bg-pink-950/50 border-pink-300 dark:border-pink-800',
  WebFetch: 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-900',
  WebSearch: 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-900',
};

export function ToolCallCard({
  call,
  defaultExpanded = false,
}: {
  call: ToolCallPairClient;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  const color = TOOL_COLORS[call.name] || 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800';
  const summary = summarizeInput(call);
  const isError = !!call.result?.isError;
  const durationMs = call.assistantTimestamp && call.result?.userTimestamp
    ? Date.parse(call.result.userTimestamp) - Date.parse(call.assistantTimestamp)
    : null;

  return (
    <div className={`rounded border my-1.5 ${color} ${isError ? 'ring-1 ring-red-400' : ''}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-xs"
      >
        <span className="font-mono font-semibold shrink-0">{call.name}</span>
        <span className="text-gray-600 dark:text-gray-400 truncate flex-1 font-mono">
          {summary}
        </span>
        {isError && (
          <span className="text-red-600 dark:text-red-400 text-[10px] uppercase tracking-wide shrink-0">
            error
          </span>
        )}
        {durationMs !== null && durationMs > 0 && (
          <span className="text-gray-400 text-[10px] shrink-0 tabular-nums">
            {durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`}
          </span>
        )}
        <span className="text-gray-400 text-[10px] shrink-0">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 border-t border-gray-200 dark:border-gray-800 space-y-2">
          <ToolBody call={call} />
        </div>
      )}
    </div>
  );
}

function ToolBody({ call }: { call: ToolCallPairClient }) {
  const input = call.input || {};
  const result = call.result?.content;
  const resultText = stringifyResult(result);

  switch (call.name) {
    case 'Write': {
      const file = String(input.file_path ?? '');
      const content = String(input.content ?? '');
      return (
        <>
          <Label>Created</Label>
          <DiffViewer oldText="" newText={content} filePath={file} />
        </>
      );
    }
    case 'Edit': {
      return (
        <>
          <DiffViewer
            oldText={String(input.old_string ?? '')}
            newText={String(input.new_string ?? '')}
            filePath={String(input.file_path ?? '')}
          />
          {call.result && (
            <>
              <Label>Result</Label>
              <CodeBlock code={resultText} />
            </>
          )}
        </>
      );
    }
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [];
      const filePath = String(input.file_path ?? '');
      return (
        <div className="space-y-2">
          {edits.map((e, i) => (
            <DiffViewer
              key={i}
              oldText={String(e.old_string ?? '')}
              newText={String(e.new_string ?? '')}
              filePath={`${filePath} — edit ${i + 1}`}
            />
          ))}
        </div>
      );
    }
    case 'Read': {
      const file = String(input.file_path ?? '');
      const offset = input.offset != null ? `from ${input.offset}` : '';
      const limit = input.limit != null ? `${input.limit} lines` : '';
      return (
        <>
          <Label>{`${file} ${offset} ${limit}`.trim()}</Label>
          {resultText && <CodeBlock code={resultText} maxLines={30} />}
        </>
      );
    }
    case 'Bash': {
      const cmd = String(input.command ?? '');
      return (
        <>
          <CodeBlock code={`$ ${cmd}`} lang="bash" maxLines={6} />
          {resultText && (
            <>
              <Label>Output</Label>
              <CodeBlock code={resultText} maxLines={20} />
            </>
          )}
        </>
      );
    }
    case 'Grep':
    case 'Glob': {
      return (
        <>
          <CodeBlock
            code={`${call.name} ${String(input.pattern ?? '')}${input.path ? ' in ' + input.path : ''}`}
          />
          {resultText && <CodeBlock code={resultText} maxLines={20} />}
        </>
      );
    }
    case 'Task': {
      return (
        <>
          <Label>Task description</Label>
          <CodeBlock code={String(input.description ?? input.prompt ?? '')} maxLines={6} />
          {input.subagent_type && (
            <div className="text-xs text-gray-500">
              Subagent: <code>{String(input.subagent_type)}</code>
            </div>
          )}
          {resultText && (
            <>
              <Label>Result</Label>
              <CodeBlock code={resultText} maxLines={20} />
            </>
          )}
        </>
      );
    }
    case 'WebFetch':
    case 'WebSearch': {
      return (
        <>
          <CodeBlock code={JSON.stringify(input, null, 2)} maxLines={6} />
          {resultText && <CodeBlock code={resultText} maxLines={20} />}
        </>
      );
    }
    default: {
      return (
        <>
          <Label>Input</Label>
          <CodeBlock code={JSON.stringify(input, null, 2)} maxLines={12} />
          {resultText && (
            <>
              <Label>Result</Label>
              <CodeBlock code={resultText} maxLines={20} />
            </>
          )}
        </>
      );
    }
  }
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-2">
      {children}
    </div>
  );
}

function summarizeInput(call: ToolCallPairClient): string {
  const i = call.input || {};
  switch (call.name) {
    case 'Bash':
      return truncate(String(i.command ?? ''), 100);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return truncate(String(i.file_path ?? ''), 100);
    case 'Grep':
    case 'Glob':
      return truncate(String(i.pattern ?? ''), 80) + (i.path ? ` in ${i.path}` : '');
    case 'Task':
      return truncate(String(i.description ?? i.prompt ?? ''), 100);
    case 'WebFetch':
      return truncate(String(i.url ?? ''), 80);
    case 'WebSearch':
      return truncate(String(i.query ?? ''), 80);
    default: {
      const keys = Object.keys(i);
      if (keys.length === 0) return '';
      return truncate(JSON.stringify(i), 100);
    }
  }
}

function stringifyResult(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object' && 'text' in block && typeof (block as { text: unknown }).text === 'string') {
        parts.push((block as { text: string }).text);
      } else {
        parts.push(JSON.stringify(block));
      }
    }
    return parts.join('\n');
  }
  return JSON.stringify(content, null, 2);
}
