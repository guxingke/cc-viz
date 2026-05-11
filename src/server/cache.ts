import { readFile, stat } from 'node:fs/promises';
import { parseSessionText, type ParseResult } from './parser';

type CacheEntry = { mtimeMs: number; result: ParseResult };

const cache = new Map<string, CacheEntry>();

export async function getParsedSession(
  absPath: string,
  sessionId: string,
  projectId: string,
): Promise<ParseResult> {
  const s = await stat(absPath);
  const hit = cache.get(absPath);
  if (hit && hit.mtimeMs === s.mtimeMs) return hit.result;
  const text = await readFile(absPath, 'utf8');
  const result = parseSessionText(text, sessionId, projectId);
  cache.set(absPath, { mtimeMs: s.mtimeMs, result });
  return result;
}

export function invalidateCache(absPath?: string) {
  if (absPath) cache.delete(absPath);
  else cache.clear();
}

export function cacheSize(): number {
  return cache.size;
}
