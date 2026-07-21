import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newClaudeState, normaliseClaudeLine } from '@/lib/adapters/claude-code';
import { newCodexState, normaliseCodexLine } from '@/lib/adapters/codex';
import { normaliseGeminiLine, type GeminiFileState } from '@/lib/adapters/gemini';
import { normaliseGenericRow, parseCsv } from '@/lib/adapters/generic';
import type { NormalisedEvent } from '@/lib/adapters/types';
import { fixturePath, readFixtureJsonl } from './helpers';

describe('claude-code adapter token normalisation', () => {
  const file = fixturePath('claude-code', 'sample.jsonl');
  const { records } = readFixtureJsonl(file);
  // Conversation state is carried across the file, exactly as the scanner does.
  const st = newClaudeState();
  const events = records
    .map((r) => normaliseClaudeLine(r.json, file, r.line, 'preview', st))
    .filter((e): e is NormalisedEvent => e !== null);

  it('emits only billable assistant records', () => {
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.source === 'claude-code')).toBe(true);
  });

  it('splits the four claude usage counters verbatim (no cached subtraction)', () => {
    const [first] = events;
    expect(first.inputTokens).toBe(2);
    expect(first.outputTokens).toBe(4);
    expect(first.cacheWriteTokens).toBe(26221);
    expect(first.cacheReadTokens).toBe(0);
    // Claude reports cache tokens OUTSIDE input_tokens, so total is a plain sum.
    expect(first.totalTokens).toBe(2 + 4 + 26221 + 0);
    expect(first.model).toBe('claude-sonnet-5');
    expect(first.provider).toBe('anthropic');
    expect(first.workingDirectory).toBe('C:\\Users\\Dev\\demo-project');
    expect(first.sessionId).toBe('sess-claude-1');
  });

  it('reads the second record independently', () => {
    const second = events[1];
    expect(second.inputTokens).toBe(100);
    expect(second.outputTokens).toBe(200);
    expect(second.cacheReadTokens).toBe(5000);
    expect(second.cacheWriteTokens).toBe(0);
    expect(second.totalTokens).toBe(5300);
  });

  it('skips "<synthetic>" model records', () => {
    const synthetic = records.find(
      (r) => (r.json as any)?.message?.model === '<synthetic>',
    );
    expect(synthetic).toBeDefined();
    expect(normaliseClaudeLine(synthetic!.json, file, synthetic!.line, 'preview')).toBeNull();
  });

  it('skips non-assistant line types', () => {
    for (const r of records) {
      const type = (r.json as any)?.type;
      if (type !== 'assistant') {
        expect(normaliseClaudeLine(r.json, file, r.line, 'preview')).toBeNull();
      }
    }
  });

  it('stores the USER prompt as the preview, redacted, and honours policy "none"', () => {
    // The preview is the prompt that CAUSED the turn, not the model's reply —
    // that is what prompt rankings and per-turn cost need.
    expect(events[0].promptPreview).toContain('Wire up the exporter');
    expect(events[0].promptPreview).toContain('[REDACTED:email]');
    expect(events[0].promptPreview).toContain('[REDACTED:anthropic-key]');
    expect(events[1].promptPreview).toContain('and now the tests please');

    const noneState = newClaudeState();
    const none = records
      .map((r) => normaliseClaudeLine(r.json, file, r.line, 'none', noneState))
      .filter((e): e is NormalisedEvent => e !== null);
    expect(none.every((e) => e.promptPreview === null)).toBe(true);
  });

  it('ignores tool_result blocks, which are harness output rather than prompts', () => {
    // The fixture feeds a tool_result back between the two real prompts. If it
    // were mistaken for a prompt it would start a spurious third turn.
    expect(events.map((e) => e.turnIndex)).toEqual([1, 2]);
  });

  it('counts tool calls and marks only the first event of a turn', () => {
    expect(events[0].toolUses).toBe(2);
    expect(events[1].toolUses).toBe(0);
    expect(events.every((e) => e.isTurnStart)).toBe(true);
  });
});

describe('codex adapter token normalisation', () => {
  const file = fixturePath('codex', 'rollout-sample.jsonl');
  const { records } = readFixtureJsonl(file);
  const st = newCodexState();
  const events = records
    .map((r) => normaliseCodexLine(r.json, st, file, r.line, 'none'))
    .filter((e): e is NormalisedEvent => e !== null);

  it('records only per-request deltas, not cumulative totals', () => {
    expect(events).toHaveLength(2); // the third token_count is an all-zero delta
    expect(events[0].totalTokens).toBe(27511);
    expect(events[1].totalTokens).toBe(30500);
  });

  it('subtracts cached_input_tokens out of input_tokens', () => {
    const raw = 27073;
    const cached = 13696;
    expect(events[0].inputTokens).toBe(raw - cached); // 13377 uncached
    expect(events[0].cacheReadTokens).toBe(cached);
    // and the two together must still equal the reported input figure
    expect(events[0].inputTokens! + events[0].cacheReadTokens!).toBe(raw);
  });

  it('reports reasoning tokens without double-counting them into the total', () => {
    expect(events[0].reasoningTokens).toBe(17);
    expect(events[0].outputTokens).toBe(438);
    expect(events[0].totalTokens).toBe(13377 + 13696 + 438); // reasoning excluded
  });

  it('carries session_meta and turn_context state onto later token events', () => {
    expect(events[0].sessionId).toBe('codex-sess-1');
    expect(events[0].model).toBe('gpt-5.5');
    expect(events[0].provider).toBe('openai');
    expect(events[0].workingDirectory).toBe('C:\\Users\\Dev\\demo-project');
    expect(events[0].sourceVersion).toBe('0.143.0');
  });

  it('returns null for meta/context lines themselves', () => {
    const fresh = newCodexState();
    expect(normaliseCodexLine(records[0].json, fresh, file, 1, 'none')).toBeNull();
    expect(normaliseCodexLine(records[1].json, fresh, file, 2, 'none')).toBeNull();
    expect(fresh.model).toBe('gpt-5.5');
  });
});

describe('gemini adapter token normalisation', () => {
  const file = fixturePath('gemini', 'chats', 'session-sample.jsonl');
  const { records } = readFixtureJsonl(file);
  const st: GeminiFileState = { sessionId: null, cwd: null };
  const events = records.flatMap((r) => normaliseGeminiLine(r.json, st, file, r.line, 'preview'));

  it('picks up the session id from the header line', () => {
    expect(st.sessionId).toBe('gemini-sess-1');
    expect(normaliseGeminiLine(records[0].json, st, file, 1, 'preview')).toEqual([]);
  });

  it('expands a $set snapshot into one event per token-bearing message', () => {
    // snapshot 1 -> 1 event, snapshot 2 -> 2 events (the first is a re-emission)
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.source === 'gemini-cli')).toBe(true);
  });

  it('subtracts cached tokens out of input tokens', () => {
    const e = events[0];
    expect(e.inputTokens).toBe(12577 - 3815); // 8762 uncached
    expect(e.cacheReadTokens).toBe(3815);
    expect(e.inputTokens! + e.cacheReadTokens!).toBe(12577);
  });

  it('treats thoughts as reasoning tokens counted in total but not in output', () => {
    const e = events[0];
    expect(e.reasoningTokens).toBe(389);
    expect(e.outputTokens).toBe(161);
    expect(e.totalTokens).toBe(13127);
    expect(e.inputTokens! + e.cacheReadTokens! + e.outputTokens! + e.reasoningTokens!).toBe(13127);
  });

  it('ignores messages that carry no tokens object', () => {
    const userMsg = { id: 'msg-user-1', type: 'user', content: 'hi' };
    expect(normaliseGeminiLine({ $set: { messages: [userMsg] } }, st, file, 9, 'preview')).toEqual([]);
  });
});

describe('generic adapter token normalisation', () => {
  const file = fixturePath('generic', 'usage.csv');
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));

  it('parses quoted CSV fields containing commas and escaped quotes', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0].description).toBe('Refactor auth, then add tests');
    expect(rows[1].description).toBe('Wrote the "ROI" report, with charts');
  });

  it('maps tolerant column names onto the normalised token fields', () => {
    const e = normaliseGenericRow(rows[0], 'generic-csv', file, 2, 'preview')!;
    expect(e.inputTokens).toBe(1000);
    expect(e.outputTokens).toBe(250);
    expect(e.cacheReadTokens).toBe(100);
    expect(e.totalTokens).toBe(1350); // summed, cache read included
    expect(e.model).toBe('gpt-5.5');
    expect(e.provider).toBe('openai');
    expect(e.sessionId).toBe('gen-1');
    expect(e.timestamp).toBe('2026-07-01T08:00:00.000Z');
  });

  it('returns null for a zero-token row', () => {
    expect(normaliseGenericRow(rows[2], 'generic-csv', file, 4, 'preview')).toBeNull();
  });

  it('accepts camelCase and snake_case synonyms alike', () => {
    const a = normaliseGenericRow(
      { promptTokens: 10, completionTokens: 5, model: 'gpt-5' },
      'generic-jsonl',
      'x',
      1,
      'none',
    )!;
    const b = normaliseGenericRow(
      { prompt_tokens: 10, completion_tokens: 5, model: 'gpt-5' },
      'generic-jsonl',
      'x',
      1,
      'none',
    )!;
    expect(a.inputTokens).toBe(10);
    expect(a.outputTokens).toBe(5);
    expect(b.inputTokens).toBe(10);
    expect(b.outputTokens).toBe(5);
  });
});
