import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MIGRATIONS } from './ddl';

export function resolveDbPath(): string {
  if (process.env.TOKEN_ROI_DB) return process.env.TOKEN_ROI_DB;
  const dir = path.join(os.homedir(), '.project-token-roi');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'token-roi.db');
}

export function runMigrations(target?: string): { applied: string[]; dbFile: string } {
  const file = target ?? resolveDbPath();
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  d.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = new Set(
    (d.prepare(`SELECT id FROM _migrations`).all() as { id: string }[]).map((r) => r.id),
  );
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    const tx = d.transaction(() => {
      d.exec(m.sql);
      d.prepare(`INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`).run(
        m.id,
        new Date().toISOString(),
      );
    });
    try {
      tx();
      applied.push(m.id);
    } catch (err) {
      d.close();
      throw new Error(`Migration ${m.id} failed: ${(err as Error).message}`);
    }
  }
  d.close();
  return { applied, dbFile: file };
}

/*
 * This module is intentionally side-effect free and free of `import.meta` and
 * top-level `await`, so it can be bundled to CommonJS for the published CLI.
 * The command-line behaviour lives in src/cli/migrate.ts.
 */
