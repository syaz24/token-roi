import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readJsonlFrom, walk } from '@/lib/adapters/jsonl';
import { normaliseClaudeLine } from '@/lib/adapters/claude-code';
import { fixturePath, tmpDir } from './helpers';

const CLAUDE = fixturePath('claude-code', 'sample.jsonl');

describe('corrupt JSONL handling', () => {
  it('skips a corrupt line without throwing and keeps parsing the rest', () => {
    const good: number[] = [];
    const bad: Array<{ line: number; err: string }> = [];
    expect(() =>
      readJsonlFrom(
        CLAUDE,
        0,
        0,
        (r) => good.push(r.line),
        (line, err) => bad.push({ line, err }),
      ),
    ).not.toThrow();

    expect(bad).toHaveLength(1);
    expect(bad[0].line).toBe(3);
    expect(bad[0].err).toBeTruthy();
    // Records before AND after the corrupt line still parse.
    expect(good).toContain(1);
    expect(good).toContain(2);
    expect(good).toContain(6);
    expect(good).toHaveLength(5);
  });

  it('still produces the surrounding good events end-to-end', () => {
    const events: string[] = [];
    readJsonlFrom(
      CLAUDE,
      0,
      0,
      (r) => {
        const e = normaliseClaudeLine(r.json, CLAUDE, r.line, 'none');
        if (e) events.push(e.eventId);
      },
      () => {},
    );
    expect(events).toHaveLength(2);
  });
});

describe('readJsonlFrom resume semantics', () => {
  const dir = tmpDir('token-roi-jsonl-');
  const file = path.join(dir, 'append.jsonl').replace(/\\/g, '/');
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('resumes from a byte offset and does not re-emit earlier lines', () => {
    fs.writeFileSync(file, '{"a":1}\n{"a":2}\n', 'utf8');
    const first: unknown[] = [];
    const r1 = readJsonlFrom(file, 0, 0, (r) => first.push(r.json), () => {});
    expect(first).toHaveLength(2);
    expect(r1.endLine).toBe(2);

    fs.appendFileSync(file, '{"a":3}\n', 'utf8');
    const second: unknown[] = [];
    const r2 = readJsonlFrom(file, r1.endOffset, r1.endLine, (r) => second.push(r.json), () => {});
    expect(second).toEqual([{ a: 3 }]);
    expect(r2.endLine).toBe(3);
  });

  it('never emits a trailing partial line', () => {
    fs.writeFileSync(file, '{"a":1}\n{"a":2', 'utf8');
    const got: unknown[] = [];
    const r = readJsonlFrom(file, 0, 0, (rec) => got.push(rec.json), () => {});
    expect(got).toEqual([{ a: 1 }]);
    expect(r.endOffset).toBe(8); // only the complete line was consumed
  });

  it('restarts from zero when the file was truncated below the stored offset', () => {
    fs.writeFileSync(file, '{"a":9}\n', 'utf8');
    const got: unknown[] = [];
    readJsonlFrom(file, 10_000, 50, (rec) => got.push(rec.json), () => {});
    expect(got).toEqual([{ a: 9 }]);
  });
});

describe('walk()', () => {
  it('finds files by predicate and respects the depth cap', () => {
    const root = fixturePath();
    const all = walk(root, (n) => n.endsWith('.jsonl'), 8);
    expect(all.some((f) => f.endsWith('claude-code/sample.jsonl'))).toBe(true);
    expect(all.some((f) => f.includes('/chats/'))).toBe(true);
    const shallow = walk(root, (n) => n.endsWith('.jsonl'), 0);
    expect(shallow).toHaveLength(0);
  });
});
