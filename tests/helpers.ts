import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonlFrom } from '@/lib/adapters/jsonl';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Forward-slash absolute path — walk() builds paths with '/' and some adapter
 *  predicates match on '/chats/', so roots must be slash-normalised. */
export function fixturePath(...parts: string[]): string {
  return path.join(REPO_ROOT, 'fixtures', ...parts).replace(/\\/g, '/');
}

export interface ReadResult {
  records: Array<{ line: number; json: unknown }>;
  corrupt: Array<{ line: number; err: string }>;
}

export function readFixtureJsonl(file: string): ReadResult {
  const records: ReadResult['records'] = [];
  const corrupt: ReadResult['corrupt'] = [];
  readJsonlFrom(
    file,
    0,
    0,
    (r) => records.push({ line: r.line, json: r.json }),
    (line, err) => corrupt.push({ line, err }),
  );
  return { records, corrupt };
}

export function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  return dir.replace(/\\/g, '/');
}
