import type { ContentBlock } from '../lib/types';
import { getParsedSession } from './cache';
import { listProjects } from './scanner';

export type SearchHit = {
  sessionId: string;
  projectId: string;
  title: string;
  cwd: string;
  snippet: string;
  matchCount: number;
};

export async function searchSessions(q: string): Promise<SearchHit[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const projects = await listProjects();
  const hits: SearchHit[] = [];

  await Promise.all(
    projects.flatMap((p) =>
      p.sessions.map(async (s) => {
        const parsed = await getParsedSession(s.absPath, s.id, p.id);
        let count = 0;
        let snippet = '';
        for (const e of parsed.detail.entries) {
          if (e.type !== 'user' && e.type !== 'assistant') continue;
          const content = e.message?.content;
          const text = extractText(content);
          if (!text) continue;
          const lower = text.toLowerCase();
          let idx = lower.indexOf(query);
          while (idx !== -1) {
            count++;
            if (!snippet) {
              const start = Math.max(0, idx - 40);
              const end = Math.min(text.length, idx + query.length + 80);
              snippet =
                (start > 0 ? '…' : '') +
                text.slice(start, end).replace(/\s+/g, ' ') +
                (end < text.length ? '…' : '');
            }
            idx = lower.indexOf(query, idx + query.length);
          }
        }
        if (count > 0) {
          hits.push({
            sessionId: parsed.detail.id,
            projectId: parsed.detail.projectId,
            title: parsed.detail.title,
            cwd: parsed.detail.cwd,
            snippet,
            matchCount: count,
          });
        }
      }),
    ),
  );

  hits.sort((a, b) => b.matchCount - a.matchCount);
  return hits.slice(0, 100);
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text);
    } else if (block.type === 'thinking' && typeof (block as { thinking?: unknown }).thinking === 'string') {
      parts.push((block as { thinking: string }).thinking);
    }
  }
  return parts.join('\n');
}
