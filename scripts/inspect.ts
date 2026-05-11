#!/usr/bin/env bun
// Inspect parser output for one JSONL session (or the latest one).
// Usage:
//   bun scripts/inspect.ts                       # latest session across all projects
//   bun scripts/inspect.ts <path/to/session.jsonl>
//   bun scripts/inspect.ts <sessionId>           # by uuid

import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { findSessionById, listProjects } from '../src/server/scanner';
import { pairToolCalls, parseSessionText } from '../src/server/parser';

async function pickTarget(arg?: string) {
  if (arg && arg.endsWith('.jsonl')) {
    // For paths like .../<project>/<parent>/subagents/agent-xxx.jsonl,
    // walk up past `subagents` and the parent-session dir to find projectId.
    let dir = dirname(arg);
    if (basename(dir) === 'subagents') dir = dirname(dirname(dir));
    return {
      absPath: arg,
      sessionId: basename(arg).replace(/\.jsonl$/, ''),
      projectId: basename(dir),
    };
  }
  if (arg) {
    const hit = await findSessionById(arg);
    if (!hit) throw new Error(`session ${arg} not found in ~/.claude/projects/`);
    return { absPath: hit.absPath, sessionId: hit.id, projectId: hit.projectId };
  }
  const projects = await listProjects();
  const all = projects.flatMap((p) => p.sessions);
  if (all.length === 0) throw new Error('no .jsonl found under ~/.claude/projects/');
  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const top = all[0];
  return { absPath: top.absPath, sessionId: top.id, projectId: top.projectId };
}

function pad(n: number) {
  return n.toLocaleString();
}

const { absPath, sessionId, projectId } = await pickTarget(process.argv[2]);
const text = await readFile(absPath, 'utf8');
const { detail, skippedLines, parseErrors } = parseSessionText(text, sessionId, projectId);
const toolPairs = pairToolCalls(detail.entries);

console.log('═══ Session ═══');
console.log('  file       :', absPath);
console.log('  projectId  :', projectId);
console.log('  sessionId  :', sessionId);
console.log('  cwd        :', detail.cwd);
console.log('  title      :', detail.title);
console.log('  started    :', detail.startedAt);
console.log('  ended      :', detail.endedAt);
console.log('  model      :', detail.model);
console.log('  hasSubagent:', detail.hasSubagents);
console.log('═══ Counts ═══');
console.log('  messages       :', pad(detail.messageCount));
console.log('  tool calls     :', pad(detail.toolCallCount));
console.log('  parsed entries :', pad(detail.entries.length));
console.log('  blank lines    :', pad(skippedLines));
console.log('  parse errors   :', pad(parseErrors));
console.log('═══ Tokens ═══');
console.log('  input          :', pad(detail.totalTokens.input_tokens || 0));
console.log('  output         :', pad(detail.totalTokens.output_tokens || 0));
console.log('  cache_creation :', pad(detail.totalTokens.cache_creation_input_tokens || 0));
console.log('  cache_read     :', pad(detail.totalTokens.cache_read_input_tokens || 0));
console.log('  cost USD       : $' + detail.totalCostUsd.toFixed(4));
console.log('═══ Entry-type breakdown ═══');
const typeHist = new Map<string, number>();
for (const e of detail.entries) typeHist.set(e.type, (typeHist.get(e.type) || 0) + 1);
for (const [t, n] of [...typeHist].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(24)} ${pad(n)}`);
}
console.log('═══ Tool-call breakdown ═══');
const toolHist = new Map<string, number>();
for (const tc of toolPairs) toolHist.set(tc.name, (toolHist.get(tc.name) || 0) + 1);
if (toolHist.size === 0) console.log('  (none)');
for (const [name, n] of [...toolHist].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(24)} ${pad(n)}`);
}
const unmatched = toolPairs.filter((tc) => !tc.result).length;
console.log('  unmatched tool_use:', unmatched);
console.log('═══ Tree ═══');
console.log(
  '  root uuid =',
  detail.tree?.uuid?.slice(0, 8) ?? '∅',
  '  children =',
  detail.tree?.children.length ?? 0,
);

// Optional: dump first 2 entries fully for spot check
console.log('═══ First 2 entries (raw) ═══');
for (const e of detail.entries.slice(0, 2)) {
  console.log(JSON.stringify(e, null, 2).slice(0, 600), '...');
}
