import { randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'cc_viz_auth';

let TOKEN = '';
let GENERATED = false;

export function loadToken(): { token: string; generated: boolean } {
  const env = process.env.CC_VIZ_TOKEN?.trim();
  if (env) {
    TOKEN = env;
    GENERATED = false;
  } else {
    TOKEN = randomBytes(24).toString('base64url');
    GENERATED = true;
  }
  return { token: TOKEN, generated: GENERATED };
}

export function getToken(): string {
  return TOKEN;
}

export function authDisabled(): boolean {
  return process.env.CC_VIZ_NO_AUTH === '1';
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function extractRequestToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const cookies = parseCookies(req.headers.get('cookie'));
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  const url = new URL(req.url);
  const q = url.searchParams.get('token');
  if (q) return q;
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyToken(supplied: string): boolean {
  if (!TOKEN || !supplied) return false;
  return safeEqual(supplied, TOKEN);
}

export function isAuthorized(req: Request): boolean {
  if (authDisabled()) return true;
  const supplied = extractRequestToken(req);
  if (!supplied) return false;
  return verifyToken(supplied);
}

export function unauthorizedJson(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function makeAuthCookie(token: string): string {
  const maxAge = 30 * 24 * 3600;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
