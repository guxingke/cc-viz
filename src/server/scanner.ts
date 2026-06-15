import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { SessionSource } from '../lib/types';

export const CLAUDE_PROJECTS_ROOT = join(homedir(), '.claude', 'projects');
export const CODEX_SESSIONS_ROOT = join(homedir(), '.codex', 'sessions');
export const KIMI_SESSIONS_ROOT = join(homedir(), '.kimi-code', 'sessions');
export const PROJECTS_ROOT = CLAUDE_PROJECTS_ROOT;
const SCAN_CACHE_TTL_MS = 1000;
let scanCache: { at: number; projects: ProjectDir[] } | null = null;

export type ProjectDir = {
  /** encoded-cwd folder name */
  id: string;
  source: SessionSource;
  cwd?: string;
  absPath: string;
  sessions: SessionFile[];
};

export type SessionFile = {
  /** uuid (filename without extension) */
  id: string;
  source: SessionSource;
  projectId: string;
  absPath: string;
  size: number;
  mtimeMs: number;
  /** Project working directory, when known. */
  cwd?: string;
  /** If this file lives under a `<parent-session-uuid>/subagents/` dir, the parent uuid. */
  parentSessionId?: string;
};

export async function projectsRootExists(): Promise<boolean> {
  return (
    (await dirExists(CLAUDE_PROJECTS_ROOT)) ||
    (await dirExists(CODEX_SESSIONS_ROOT)) ||
    (await dirExists(KIMI_SESSIONS_ROOT))
  );
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function listProjects(): Promise<ProjectDir[]> {
  if (scanCache && Date.now() - scanCache.at < SCAN_CACHE_TTL_MS) {
    return cloneProjects(scanCache.projects);
  }
  const [claude, codex, kimi] = await Promise.all([
    listClaudeProjects(),
    listCodexProjects(),
    listKimiProjects(),
  ]);
  const projects = [...claude, ...codex, ...kimi];
  scanCache = { at: Date.now(), projects };
  return cloneProjects(projects);
}

function cloneProjects(projects: ProjectDir[]): ProjectDir[] {
  return projects.map((p) => ({
    ...p,
    sessions: p.sessions.map((s) => ({ ...s })),
  }));
}

async function listClaudeProjects(): Promise<ProjectDir[]> {
  if (!(await dirExists(CLAUDE_PROJECTS_ROOT))) return [];
  const entries = await readdir(CLAUDE_PROJECTS_ROOT, { withFileTypes: true });
  const out: ProjectDir[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const abs = join(CLAUDE_PROJECTS_ROOT, ent.name);
    const sessions = await listSessionsIn(abs, ent.name);
    out.push({ id: ent.name, source: 'claude', absPath: abs, sessions });
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
          source: 'claude',
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
            source: 'claude',
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

async function listCodexProjects(): Promise<ProjectDir[]> {
  if (!(await dirExists(CODEX_SESSIONS_ROOT))) return [];
  const files = await listCodexSessionFiles(CODEX_SESSIONS_ROOT);
  const byProject = new Map<string, ProjectDir>();
  await Promise.all(
    files.map(async (absPath) => {
      const meta = await readCodexFileMeta(absPath);
      const s = await stat(absPath).catch(() => null);
      if (!s) return;
      const rawId = meta.sessionId || basename(absPath).replace(/\.jsonl$/, '');
      const cwd = meta.cwd || '(unknown cwd)';
      const projectId = `codex:${encodeProjectId(cwd)}`;
      let project = byProject.get(projectId);
      if (!project) {
        project = {
          id: projectId,
          source: 'codex',
          cwd,
          absPath: CODEX_SESSIONS_ROOT,
          sessions: [],
        };
        byProject.set(projectId, project);
      }
      project.sessions.push({
        id: `codex:${rawId}`,
        source: 'codex',
        projectId,
        absPath,
        size: s.size,
        mtimeMs: s.mtimeMs,
        cwd,
      });
    }),
  );
  return [...byProject.values()];
}

async function listCodexSessionFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  await Promise.all(
    entries.map(async (ent) => {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        out.push(...(await listCodexSessionFiles(abs)));
      } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
        out.push(abs);
      }
    }),
  );
  return out;
}

async function readCodexFileMeta(
  absPath: string,
): Promise<{ sessionId: string; cwd: string }> {
  const text = await readFileHead(absPath, 128 * 1024);
  let sessionId = '';
  let cwd = '';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as {
        type?: unknown;
        payload?: Record<string, unknown>;
      };
      const p = obj.payload;
      if (!p || typeof p !== 'object') continue;
      if (!sessionId && obj.type === 'session_meta' && typeof p.id === 'string') {
        sessionId = p.id;
      }
      if (!cwd && (obj.type === 'session_meta' || obj.type === 'turn_context')) {
        if (typeof p.cwd === 'string') cwd = p.cwd;
      }
      if (sessionId && cwd) break;
    } catch {
      // ignore malformed rows; parser handles them later
    }
  }
  return { sessionId, cwd };
}

async function readFileHead(absPath: string, byteLimit: number): Promise<string> {
  const fh = await open(absPath, 'r').catch(() => null);
  if (!fh) return '';
  try {
    const buf = Buffer.alloc(byteLimit);
    const { bytesRead } = await fh.read(buf, 0, byteLimit, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close().catch(() => undefined);
  }
}

function encodeProjectId(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

async function listKimiProjects(): Promise<ProjectDir[]> {
  if (!(await dirExists(KIMI_SESSIONS_ROOT))) return [];
  const indexPath = join(homedir(), '.kimi-code', 'session_index.jsonl');
  const indexText = await readFile(indexPath, 'utf8').catch(() => '');
  const byProject = new Map<string, ProjectDir>();

  for (const line of indexText.split('\n')) {
    if (!line.trim()) continue;
    try {
      const idx = JSON.parse(line) as {
        sessionId?: string;
        sessionDir?: string;
        workDir?: string;
      };
      const sessionId = idx.sessionId;
      const sessionDir = idx.sessionDir;
      const workDir = idx.workDir;
      if (!sessionId || !sessionDir || !workDir) continue;

      const state = await readKimiState(join(sessionDir, 'state.json'));
      const projectId = `kimi:${encodeProjectId(workDir)}`;
      let project = byProject.get(projectId);
      if (!project) {
        project = {
          id: projectId,
          source: 'kimi',
          cwd: workDir,
          absPath: KIMI_SESSIONS_ROOT,
          sessions: [],
        };
        byProject.set(projectId, project);
      }

      // Main agent is always present.
      const mainPath = join(sessionDir, 'agents', 'main', 'wire.jsonl');
      const mainStat = await stat(mainPath).catch(() => null);
      if (mainStat) {
        const mainId = `kimi:${sessionId}`;
        project.sessions.push({
          id: mainId,
          source: 'kimi',
          projectId,
          absPath: mainPath,
          size: mainStat.size,
          mtimeMs: mainStat.mtimeMs,
          cwd: workDir,
        });

        // Sub-agents, if any.
        for (const agentId of Object.keys(state.agents)) {
          if (agentId === 'main') continue;
          const agent = state.agents[agentId];
          if (agent.type !== 'sub') continue;
          const agentPath = join(sessionDir, 'agents', agentId, 'wire.jsonl');
          const agentStat = await stat(agentPath).catch(() => null);
          if (!agentStat) continue;
          project.sessions.push({
            id: `kimi:${sessionId}@${agentId}`,
            source: 'kimi',
            projectId,
            absPath: agentPath,
            size: agentStat.size,
            mtimeMs: agentStat.mtimeMs,
            cwd: workDir,
            parentSessionId: mainId,
          });
        }
      }
    } catch {
      // ignore malformed index rows or unreadable session dirs
    }
  }

  return [...byProject.values()];
}

type KimiState = {
  title?: string;
  agents: Record<
    string,
    {
      type: 'main' | 'sub';
      parentAgentId?: string | null;
    }
  >;
};

async function readKimiState(absPath: string): Promise<KimiState> {
  try {
    const text = await readFile(absPath, 'utf8');
    const obj = JSON.parse(text) as KimiState;
    if (!obj || typeof obj !== 'object' || !obj.agents) return { agents: {} };
    return obj;
  } catch {
    return { agents: {} };
  }
}

export type SubagentMeta = {
  sessionId: string;
  agentType: string;
  description: string;
  mtimeMs: number;
};

/**
 * Reads the `.meta.json` sidecars next to every sub-agent JSONL whose
 * `parentSessionId === parentId`. Returns chronologically (by file mtime).
 * Files lacking a meta.json (older Claude Code versions) are skipped.
 */
export async function listSubagentMetas(parentId: string): Promise<SubagentMeta[]> {
  const projects = await listProjects();
  for (const p of projects) {
    const subs = p.sessions.filter((s) => s.parentSessionId === parentId);
    if (subs.length === 0) continue;
    const out: SubagentMeta[] = [];
    for (const s of subs) {
      const metaPath = s.absPath.replace(/\.jsonl$/, '.meta.json');
      try {
        const text = await readFile(metaPath, 'utf8');
        const obj = JSON.parse(text) as Record<string, unknown>;
        out.push({
          sessionId: s.id,
          agentType: typeof obj.agentType === 'string' ? obj.agentType : '',
          description: typeof obj.description === 'string' ? obj.description : '',
          mtimeMs: s.mtimeMs,
        });
      } catch {
        // meta.json missing or unreadable — skip (older format)
      }
    }
    out.sort((a, b) => a.mtimeMs - b.mtimeMs);
    return out;
  }
  return [];
}

export async function findSessionById(sessionId: string): Promise<SessionFile | null> {
  const projects = await listProjects();
  for (const p of projects) {
    const hit = p.sessions.find((s) => s.id === sessionId);
    if (hit) return hit;
  }
  return null;
}
