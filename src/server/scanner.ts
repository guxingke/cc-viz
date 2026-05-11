import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PROJECTS_ROOT = join(homedir(), '.claude', 'projects');

export type ProjectDir = {
  /** encoded-cwd folder name */
  id: string;
  absPath: string;
  sessions: SessionFile[];
};

export type SessionFile = {
  /** uuid (filename without extension) */
  id: string;
  projectId: string;
  absPath: string;
  size: number;
  mtimeMs: number;
  /** If this file lives under a `<parent-session-uuid>/subagents/` dir, the parent uuid. */
  parentSessionId?: string;
};

export async function projectsRootExists(): Promise<boolean> {
  try {
    const s = await stat(PROJECTS_ROOT);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function listProjects(): Promise<ProjectDir[]> {
  if (!(await projectsRootExists())) return [];
  const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
  const out: ProjectDir[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const abs = join(PROJECTS_ROOT, ent.name);
    const sessions = await listSessionsIn(abs, ent.name);
    out.push({ id: ent.name, absPath: abs, sessions });
  }
  return out;
}

export async function listSessionsIn(absDir: string, projectId: string): Promise<SessionFile[]> {
  const entries = await readdir(absDir, { withFileTypes: true }).catch(() => []);
  const files: SessionFile[] = [];
  for (const ent of entries) {
    const abs = join(absDir, ent.name);
    if (ent.isFile() && ent.name.endsWith('.jsonl')) {
      try {
        const s = await stat(abs);
        files.push({
          id: ent.name.replace(/\.jsonl$/, ''),
          projectId,
          absPath: abs,
          size: s.size,
          mtimeMs: s.mtimeMs,
        });
      } catch {
        // ignore
      }
    } else if (ent.isDirectory()) {
      // Sub-agent layout: <project>/<parent-session-uuid>/subagents/agent-XXX.jsonl
      const parentSessionId = ent.name; // dir name === parent session uuid
      const subDir = join(abs, 'subagents');
      const subNames = await readdir(subDir).catch(() => []);
      for (const name of subNames) {
        if (!name.endsWith('.jsonl')) continue;
        const subAbs = join(subDir, name);
        try {
          const s = await stat(subAbs);
          files.push({
            id: name.replace(/\.jsonl$/, ''),
            projectId,
            absPath: subAbs,
            size: s.size,
            mtimeMs: s.mtimeMs,
            parentSessionId,
          });
        } catch {
          // ignore
        }
      }
    }
  }
  return files;
}

export async function findSessionById(sessionId: string): Promise<SessionFile | null> {
  const projects = await listProjects();
  for (const p of projects) {
    const hit = p.sessions.find((s) => s.id === sessionId);
    if (hit) return hit;
  }
  return null;
}
