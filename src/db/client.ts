
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as schema from './schema';

export function dbPath(): string {
  if (process.env.TOKEN_ROI_DB) return process.env.TOKEN_ROI_DB;
  const dir = path.join(os.homedir(), '.project-token-roi');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'token-roi.db');
}

let _sqlite: Database.Database | null = null;

export function raw(): Database.Database {
  if (_sqlite) return _sqlite;
  _sqlite = new Database(dbPath());
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('synchronous = NORMAL');
  _sqlite.pragma('foreign_keys = ON');
  return _sqlite;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!_db) _db = drizzle(raw(), { schema });
  return _db;
}

export { schema };
