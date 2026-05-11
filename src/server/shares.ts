import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Share, ShareCreateInput, ShareTTL } from '../lib/types';
import { getDb } from './db';

type Row = {
  token: string;
  session_id: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
};

function rowToShare(r: Row): Share {
  return {
    token: r.token,
    sessionId: r.session_id,
    label: r.label,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

function ttlToExpires(ttl: ShareTTL, fromMs: number): string | null {
  if (!ttl) return null;
  const day = 24 * 3600 * 1000;
  const delta = ttl === '1d' ? day : ttl === '7d' ? 7 * day : null;
  if (delta === null) return null;
  return new Date(fromMs + delta).toISOString();
}

export function isExpired(s: Share, nowMs: number = Date.now()): boolean {
  if (!s.expiresAt) return false;
  const t = Date.parse(s.expiresAt);
  if (Number.isNaN(t)) return false;
  return t <= nowMs;
}

export function createShare(input: ShareCreateInput): Share {
  const sessionId = input.sessionId?.trim();
  if (!sessionId) throw new Error('sessionId is required');
  const now = Date.now();
  const share: Share = {
    token: randomBytes(24).toString('base64url'),
    sessionId,
    label: input.label?.trim() || null,
    createdAt: new Date(now).toISOString(),
    expiresAt: ttlToExpires(input.ttl ?? null, now),
  };
  getDb()
    .query(
      'INSERT INTO shares (token, session_id, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(share.token, share.sessionId, share.label, share.createdAt, share.expiresAt);
  return share;
}

export function listSharesBySession(sessionId: string): Share[] {
  const rows = getDb()
    .query<Row, [string]>(
      'SELECT token, session_id, label, created_at, expires_at FROM shares WHERE session_id = ? ORDER BY created_at DESC',
    )
    .all(sessionId);
  return rows.map(rowToShare);
}

export function revokeShare(token: string): boolean {
  const res = getDb().query('DELETE FROM shares WHERE token = ?').run(token);
  return res.changes > 0;
}

export function findShareByToken(token: string): Share | null {
  if (!token) return null;
  const rows = getDb()
    .query<Row, []>('SELECT token, session_id, label, created_at, expires_at FROM shares')
    .all();
  const supplied = Buffer.from(token, 'utf8');
  for (const r of rows) {
    const candidate = Buffer.from(r.token, 'utf8');
    if (candidate.length !== supplied.length) continue;
    if (timingSafeEqual(candidate, supplied)) return rowToShare(r);
  }
  return null;
}

/** Returns share iff it exists, is not expired, and matches `sessionId` when provided. */
export function resolveActiveShare(
  token: string,
  sessionId?: string,
): Share | null {
  const s = findShareByToken(token);
  if (!s) return null;
  if (isExpired(s)) return null;
  if (sessionId && s.sessionId !== sessionId) return null;
  return s;
}
