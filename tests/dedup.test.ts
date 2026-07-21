import { describe, expect, it } from 'vitest';
import { sha1 } from '@/lib/adapters/jsonl';
import { normaliseClaudeLine } from '@/lib/adapters/claude-code';
import { newCodexState, normaliseCodexLine } from '@/lib/adapters/codex';
import { normaliseGeminiLine, type GeminiFileState } from '@/lib/adapters/gemini';
import { fixturePath, readFixtureJsonl } from './helpers';

describe('stable event ids (deduplication)', () => {
  it('sha1 is stable for identical input and different for different input', () => {
    expect(sha1('a|b')).toBe(sha1('a|b'));
    expect(sha1('a|b')).not.toBe(sha1('a|c'));
  });

  it('claude: the same record always yields the same id', () => {
    const file = fixturePath('claude-code', 'sample.jsonl');
    const { records } = readFixtureJsonl(file);
    const rec = records[0];
    const a = normaliseClaudeLine(rec.json, file, rec.line, 'preview')!;
    const b = normaliseClaudeLine(structuredClone(rec.json), file, rec.line, 'preview')!;
    expect(a.eventId).toBe(b.eventId);
    // ... and is independent of the file path / line it was read from
    const c = normaliseClaudeLine(rec.json, 'somewhere/else.jsonl', 999, 'preview')!;
    expect(c.eventId).toBe(a.eventId);
  });

  it('claude: a different requestId yields a different id', () => {
    const file = fixturePath('claude-code', 'sample.jsonl');
    const { records } = readFixtureJsonl(file);
    const base = records[0].json as Record<string, any>;
    const a = normaliseClaudeLine(base, file, 1, 'none')!;
    const b = normaliseClaudeLine({ ...base, requestId: 'req_other' }, file, 1, 'none')!;
    expect(b.eventId).not.toBe(a.eventId);
  });

  it('gemini: a re-emitted $set snapshot collapses to the same ids', () => {
    const file = fixturePath('gemini', 'chats', 'session-sample.jsonl');
    const { records } = readFixtureJsonl(file);
    const st: GeminiFileState = { sessionId: null, cwd: null };
    const all = records.flatMap((r) => normaliseGeminiLine(r.json, st, file, r.line, 'none'));
    expect(all).toHaveLength(3);
    const unique = new Set(all.map((e) => e.eventId));
    expect(unique.size).toBe(2); // the repeated message dedupes away
    expect(all[0].eventId).toBe(all[1].eventId);
    expect(all[2].eventId).not.toBe(all[0].eventId);
  });

  it('codex: re-reading a whole file from scratch reproduces identical ids', () => {
    const file = fixturePath('codex', 'rollout-sample.jsonl');
    const { records } = readFixtureJsonl(file);
    const run = () => {
      const st = newCodexState();
      return records
        .map((r) => normaliseCodexLine(r.json, st, file, r.line, 'none'))
        .filter(Boolean)
        .map((e) => e!.eventId);
    };
    expect(run()).toEqual(run());
    const ids = run();
    expect(new Set(ids).size).toBe(ids.length); // distinct turns keep distinct ids
  });
});
