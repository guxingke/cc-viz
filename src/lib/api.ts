import type {
  ProjectSummary,
  SessionDetail,
  SessionSummary,
  Share,
  ShareCreateInput,
  ShareTTL,
} from './types';

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function send<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  projects: () => get<ProjectSummary[]>('/api/projects'),
  sessions: () => get<SessionSummary[]>('/api/sessions'),
  session: (id: string) => get<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`),
  search: (q: string) =>
    get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  authCheck: async (): Promise<boolean> => {
    const r = await fetch('/api/_auth/check');
    return r.ok;
  },
  authLogin: async (token: string): Promise<boolean> => {
    const r = await fetch('/api/_auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return r.ok;
  },
  shareList: (sessionId: string) =>
    get<Share[]>(`/api/_share?sessionId=${encodeURIComponent(sessionId)}`),
  shareCreate: (input: ShareCreateInput) =>
    send<Share>('/api/_share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  shareRevoke: async (token: string): Promise<boolean> => {
    const res = await fetch(`/api/_share/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    });
    return res.ok;
  },
  sharedSession: (token: string) =>
    get<SessionDetail>(`/api/share/${encodeURIComponent(token)}/session`),
};

export type { ShareTTL };

export type SearchHit = {
  sessionId: string;
  projectId: string;
  title: string;
  cwd: string;
  snippet: string;
  matchCount: number;
};
