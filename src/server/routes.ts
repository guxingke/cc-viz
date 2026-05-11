import { readFile } from 'node:fs/promises';
import type { ProjectSummary, SessionDetail, SessionSummary } from '../lib/types';
import {
  isAuthorized,
  makeAuthCookie,
  unauthorizedJson,
  verifyToken,
} from './auth';
import { getParsedSession } from './cache';
import { findSessionById, listProjects } from './scanner';
import { searchSessions, type SearchHit } from './search';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function sumTokens(t: SessionSummary['totalTokens']): number {
  return (
    (Number(t.input_tokens) || 0) +
    (Number(t.output_tokens) || 0) +
    (Number(t.cache_creation_input_tokens) || 0) +
    (Number(t.cache_read_input_tokens) || 0)
  );
}

async function getAllSessionSummaries(): Promise<SessionSummary[]> {
  const projects = await listProjects();
  const tasks = projects.flatMap((p) =>
    p.sessions.map(async (s) => {
      const parsed = await getParsedSession(s.absPath, s.id, p.id);
      const { entries: _entries, tree: _tree, ...summary } = parsed.detail;
      return summary as SessionSummary;
    }),
  );
  const results = await Promise.all(tasks);
  results.sort((a, b) => Date.parse(b.startedAt || '') - Date.parse(a.startedAt || ''));
  return results;
}

async function getProjectSummaries(): Promise<ProjectSummary[]> {
  const projects = await listProjects();
  const all = await Promise.all(
    projects.map(async (p) => {
      let totalTokens = 0;
      let totalCostUsd = 0;
      let lastActiveMs = 0;
      let cwd = '';
      await Promise.all(
        p.sessions.map(async (s) => {
          const parsed = await getParsedSession(s.absPath, s.id, p.id);
          totalTokens += sumTokens(parsed.detail.totalTokens);
          totalCostUsd += parsed.detail.totalCostUsd;
          if (s.mtimeMs > lastActiveMs) lastActiveMs = s.mtimeMs;
          if (!cwd && parsed.detail.cwd) cwd = parsed.detail.cwd;
        }),
      );
      return {
        id: p.id,
        cwd: cwd || decodeProjectId(p.id),
        sessionCount: p.sessions.length,
        totalTokens,
        totalCostUsd,
        lastActiveAt: lastActiveMs ? new Date(lastActiveMs).toISOString() : '',
      } satisfies ProjectSummary;
    }),
  );
  all.sort((a, b) => Date.parse(b.lastActiveAt || '') - Date.parse(a.lastActiveAt || ''));
  return all;
}

function decodeProjectId(id: string): string {
  // Best-effort: replace leading "-" with "/" then convert dashes between segments.
  // Not perfect, but only used when no session reveals the cwd.
  return id.replace(/^-/, '/').replace(/-/g, '/');
}

async function getSessionDetail(id: string): Promise<SessionDetail | null> {
  const file = await findSessionById(id);
  if (!file) return null;
  const parsed = await getParsedSession(file.absPath, file.id, file.projectId);
  return parsed.detail;
}

async function getSessionRaw(id: string): Promise<Response> {
  const file = await findSessionById(id);
  if (!file) return json({ error: 'not_found' }, 404);
  const text = await readFile(file.absPath, 'utf8');
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  });
}

async function handleLogin(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  let body: { token?: unknown };
  try {
    body = (await req.json()) as { token?: unknown };
  } catch {
    body = {};
  }
  const supplied = typeof body.token === 'string' ? body.token.trim() : '';
  if (!supplied || !verifyToken(supplied)) return unauthorizedJson();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': makeAuthCookie(supplied),
    },
  });
}

export async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  try {
    // Always-allowed auth endpoints.
    if (p === '/api/_auth/login') return await handleLogin(req);
    if (p === '/api/_auth/check') {
      return isAuthorized(req) ? json({ ok: true }) : unauthorizedJson();
    }

    if (!isAuthorized(req)) return unauthorizedJson();

    if (p === '/api/projects') return json(await getProjectSummaries());
    if (p === '/api/sessions') return json(await getAllSessionSummaries());

    let m = p.match(/^\/api\/sessions\/([^/]+)\/raw$/);
    if (m) return await getSessionRaw(m[1]);

    m = p.match(/^\/api\/sessions\/([^/]+)$/);
    if (m) {
      const detail = await getSessionDetail(m[1]);
      if (!detail) return json({ error: 'session_not_found', id: m[1] }, 404);
      return json(detail);
    }

    if (p === '/api/search') {
      const q = url.searchParams.get('q') || '';
      const hits: SearchHit[] = await searchSessions(q);
      return json(hits);
    }

    return json({ error: 'not_found', path: p }, 404);
  } catch (err) {
    console.error('[api]', p, err);
    return json({ error: (err as Error).message ?? 'internal_error' }, 500);
  }
}
