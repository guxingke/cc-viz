import { readFile } from 'node:fs/promises';
import type {
  ContentBlock,
  ParsedEntry,
  ProjectSummary,
  SessionDetail,
  SessionSummary,
  ShareCreateInput,
  ShareTTL,
} from '../lib/types';
import {
  isAuthorized,
  makeAuthCookie,
  unauthorizedJson,
  verifyToken,
} from './auth';
import { getParsedSession } from './cache';
import { findSessionById, listProjects, listSubagentMetas } from './scanner';
import { searchSessions, type SearchHit } from './search';
import {
  createShare,
  listSharesBySession,
  resolveActiveShare,
  revokeShare,
} from './shares';

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
        source: p.source,
        cwd: cwd || p.cwd || decodeProjectId(p.id, p.source),
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

function decodeProjectId(id: string, source: 'claude' | 'codex'): string {
  if (source === 'codex') return id.replace(/^codex:/, '') || '(unknown cwd)';
  // Best-effort: replace leading "-" with "/" then convert dashes between segments.
  // Not perfect, but only used when no session reveals the cwd.
  return id.replace(/^-/, '/').replace(/-/g, '/');
}

async function getSessionDetail(id: string): Promise<SessionDetail | null> {
  const file = await findSessionById(id);
  if (!file) return null;
  const parsed = await getParsedSession(file.absPath, file.id, file.projectId);
  const links = await buildSubagentLinks(id, parsed.detail.entries);
  if (Object.keys(links).length === 0) return parsed.detail;
  return { ...parsed.detail, subagentLinks: links };
}

const AGENT_TOOL_NAMES = new Set(['Task', 'Agent']);

async function buildSubagentLinks(
  parentId: string,
  entries: ParsedEntry[],
): Promise<Record<string, string>> {
  const metas = await listSubagentMetas(parentId);
  if (metas.length === 0) return {};
  const used = new Set<number>();
  const links: Record<string, string> = {};
  for (const e of entries) {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message!.content as ContentBlock[]) {
      if (block.type !== 'tool_use') continue;
      const b = block as { id?: unknown; name?: unknown; input?: unknown };
      const name = typeof b.name === 'string' ? b.name : '';
      if (!AGENT_TOOL_NAMES.has(name)) continue;
      const tid = typeof b.id === 'string' ? b.id : '';
      if (!tid) continue;
      const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<
        string,
        unknown
      >;
      const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : '';
      const description = typeof input.description === 'string' ? input.description : '';
      for (let i = 0; i < metas.length; i++) {
        if (used.has(i)) continue;
        if (metas[i].agentType === subagentType && metas[i].description === description) {
          links[tid] = metas[i].sessionId;
          used.add(i);
          break;
        }
      }
    }
  }
  return links;
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

function isValidTtl(v: unknown): v is ShareTTL {
  return v === null || v === undefined || v === '1d' || v === '7d';
}

async function handleShareCreate(req: Request): Promise<Response> {
  let body: Partial<ShareCreateInput> & Record<string, unknown>;
  try {
    body = (await req.json()) as Partial<ShareCreateInput>;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return json({ error: 'sessionId_required' }, 400);

  const file = await findSessionById(sessionId);
  if (!file) return json({ error: 'session_not_found', id: sessionId }, 404);

  const ttl = body.ttl;
  if (!isValidTtl(ttl)) return json({ error: 'invalid_ttl' }, 400);

  const label =
    typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null;

  const share = createShare({ sessionId, label, ttl: ttl ?? null });
  return json(share, 201);
}

async function handleShareList(url: URL): Promise<Response> {
  const sessionId = url.searchParams.get('sessionId')?.trim() || '';
  if (!sessionId) return json({ error: 'sessionId_required' }, 400);
  return json(listSharesBySession(sessionId));
}

async function handleShareRevoke(token: string): Promise<Response> {
  const decoded = decodePathParam(token);
  if (!decoded) return json({ error: 'token_required' }, 400);
  const ok = revokeShare(decoded);
  return json({ ok }, ok ? 200 : 404);
}

async function handleSharedSession(token: string): Promise<Response> {
  const share = resolveActiveShare(decodePathParam(token));
  if (!share) return unauthorizedJson();
  const file = await findSessionById(share.sessionId);
  if (!file) return json({ error: 'session_not_found', id: share.sessionId }, 404);
  const parsed = await getParsedSession(file.absPath, file.id, file.projectId);
  return json(parsed.detail);
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

    // Share-token scoped endpoints — verify against the share itself, not the
    // owner token. Strictly scoped to the bound sessionId.
    let sharedMatch = p.match(/^\/api\/share\/([^/]+)\/session$/);
    if (sharedMatch) return await handleSharedSession(sharedMatch[1]);

    if (!isAuthorized(req)) return unauthorizedJson();

    // Owner-token share management endpoints.
    if (p === '/api/_share') {
      if (req.method === 'GET') return await handleShareList(url);
      if (req.method === 'POST') return await handleShareCreate(req);
      return json({ error: 'method_not_allowed' }, 405);
    }
    const revokeMatch = p.match(/^\/api\/_share\/([^/]+)$/);
    if (revokeMatch) {
      if (req.method !== 'DELETE') return json({ error: 'method_not_allowed' }, 405);
      return await handleShareRevoke(revokeMatch[1]);
    }

    if (p === '/api/projects') return json(await getProjectSummaries());
    if (p === '/api/sessions') return json(await getAllSessionSummaries());

    let m = p.match(/^\/api\/sessions\/([^/]+)\/raw$/);
    if (m) return await getSessionRaw(decodePathParam(m[1]));

    m = p.match(/^\/api\/sessions\/([^/]+)$/);
    if (m) {
      const id = decodePathParam(m[1]);
      const detail = await getSessionDetail(id);
      if (!detail) return json({ error: 'session_not_found', id }, 404);
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

function decodePathParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
