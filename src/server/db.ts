import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_DB_PATH = join(homedir(), '.config', 'cc-viz', 'db.sqlite');

let dbInstance: Database | null = null;

export function getDbPath(): string {
  const env = process.env.CC_VIZ_DB?.trim();
  return env && env.length > 0 ? env : DEFAULT_DB_PATH;
}

export function getDb(): Database {
  if (dbInstance) return dbInstance;
  const path = getDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  dbInstance = db;
  return db;
}

function migrate(db: Database): void {
  const row = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
  const current = row?.user_version ?? 0;

  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shares (
        token       TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        label       TEXT,
        created_at  TEXT NOT NULL,
        expires_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shares_session_id ON shares(session_id);
    `);
    db.exec('PRAGMA user_version = 1');
  }
}
