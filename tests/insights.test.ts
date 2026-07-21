import { describe, expect, it } from 'vitest';
import { buildInsights, type InsightInput, type SessionInput, type TurnInput } from '@/lib/insights/engine';

const EMPTY: InsightInput = {
  turns: [],
  sessions: [],
  weekdayTokens: [],
  totalTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheSavingsUsd: null,
};

const ids = (i: InsightInput) => buildInsights(i).map((x) => x.id);
const get = (i: InsightInput, id: string) => buildInsights(i).find((x) => x.id === id);

function turn(sessionId: string, turnIndex: number, over: Partial<TurnInput> = {}): TurnInput {
  return { sessionId, turnIndex, promptLength: 100, cost: 0.01, tokens: 1000, toolUses: 0, ...over };
}

function session(sessionId: string, over: Partial<SessionInput> = {}): SessionInput {
  return { sessionId, turns: 5, tokens: 10_000, cost: 1, toolUses: 0, ...over };
}

/** Nine priced turns per session: cheap start, expensive tail. */
function growingSession(sessionId: string): TurnInput[] {
  const costs = [0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 0.05, 0.06, 0.07];
  return costs.map((cost, k) => turn(sessionId, k, { cost }));
}

describe('buildInsights — nothing to say', () => {
  it('returns no insights at all for empty input', () => {
    expect(buildInsights(EMPTY)).toEqual([]);
  });

  it('never invents an insight from zeroed totals', () => {
    expect(buildInsights({ ...EMPTY, totalTokens: 0, outputTokens: 0 })).toEqual([]);
  });
});

describe('rule: short prompts cost more', () => {
  const shorts = Array.from({ length: 6 }, (_, k) => turn('s', k, { promptLength: 12, cost: 0.1 }));
  const longs = Array.from({ length: 6 }, (_, k) => turn('s', 10 + k, { promptLength: 200, cost: 0.02 }));

  it('fires when short prompts are meaningfully more expensive', () => {
    const r = get({ ...EMPTY, turns: [...shorts, ...longs] }, 'short-prompts-cost-more');
    expect(r).toBeDefined();
    expect(r!.tone).toBe('warning');
    expect(r!.detail).toContain('$0.100');
    expect(r!.detail).toContain('5x');
    expect(r!.evidence).toHaveLength(3);
  });

  it('is omitted when the short bucket has fewer than five samples', () => {
    const turns = [...shorts.slice(0, 4), ...longs];
    expect(ids({ ...EMPTY, turns })).not.toContain('short-prompts-cost-more');
  });

  it('is omitted when the long bucket has fewer than five samples', () => {
    expect(ids({ ...EMPTY, turns: [...shorts, ...longs.slice(0, 4)] })).not.toContain('short-prompts-cost-more');
  });

  it('is omitted when the difference is not meaningful', () => {
    const flat = longs.map((t) => ({ ...t, promptLength: 200, cost: 0.1 }));
    expect(ids({ ...EMPTY, turns: [...shorts, ...flat] })).not.toContain('short-prompts-cost-more');
  });

  it('is omitted when no prompt lengths were captured', () => {
    const blind = [...shorts, ...longs].map((t) => ({ ...t, promptLength: null }));
    expect(ids({ ...EMPTY, turns: blind })).not.toContain('short-prompts-cost-more');
  });

  it('is omitted when nothing could be priced', () => {
    const unpriced = [...shorts, ...longs].map((t) => ({ ...t, cost: null }));
    expect(ids({ ...EMPTY, turns: unpriced })).not.toContain('short-prompts-cost-more');
  });
});

describe('rule: cost rises with conversation length', () => {
  const turns = [...growingSession('a'), ...growingSession('b')];

  it('fires across two or more long sessions and reports the multiple', () => {
    const r = get({ ...EMPTY, turns }, 'cost-rises-with-conversation-length');
    expect(r).toBeDefined();
    expect(r!.detail).toContain('2 sessions');
    expect(r!.detail).toMatch(/[\d.]+x/);
  });

  it('is omitted with only one qualifying session', () => {
    expect(ids({ ...EMPTY, turns: growingSession('a') })).not.toContain('cost-rises-with-conversation-length');
  });

  it('is omitted when sessions are shorter than six turns', () => {
    const shortSessions = ['a', 'b'].flatMap((s) => growingSession(s).slice(0, 5));
    expect(ids({ ...EMPTY, turns: shortSessions })).not.toContain('cost-rises-with-conversation-length');
  });

  it('is omitted when cost per turn is flat', () => {
    const flat = turns.map((t) => ({ ...t, cost: 0.02 }));
    expect(ids({ ...EMPTY, turns: flat })).not.toContain('cost-rises-with-conversation-length');
  });

  it('is omitted when early turns cost nothing (no division by zero)', () => {
    const zeroed = turns.map((t) => (t.turnIndex < 3 ? { ...t, cost: 0 } : t));
    const out = buildInsights({ ...EMPTY, turns: zeroed });
    expect(out.map((x) => x.id)).not.toContain('cost-rises-with-conversation-length');
    for (const x of out) expect(x.detail).not.toMatch(/Infinity|NaN/);
  });
});

describe('rule: usage concentrated in a few sessions', () => {
  const skewed: SessionInput[] = [
    session('big', { tokens: 800_000 }),
    ...Array.from({ length: 9 }, (_, k) => session(`small${k}`, { tokens: 10_000 })),
  ];

  it('fires when a minority of sessions carry 80% of tokens', () => {
    const r = get({ ...EMPTY, sessions: skewed }, 'usage-concentrated-in-few-sessions');
    expect(r).toBeDefined();
    expect(r!.detail).toContain('1 of 10 sessions');
    expect(r!.detail).toContain('80%');
  });

  it('is omitted when usage is evenly spread', () => {
    const even = Array.from({ length: 10 }, (_, k) => session(`s${k}`, { tokens: 10_000 }));
    expect(ids({ ...EMPTY, sessions: even })).not.toContain('usage-concentrated-in-few-sessions');
  });

  it('is omitted with fewer than five sessions', () => {
    expect(ids({ ...EMPTY, sessions: skewed.slice(0, 4) })).not.toContain('usage-concentrated-in-few-sessions');
  });

  it('is omitted when every session has zero tokens', () => {
    const zeros = Array.from({ length: 8 }, (_, k) => session(`s${k}`, { tokens: 0 }));
    expect(ids({ ...EMPTY, sessions: zeros })).not.toContain('usage-concentrated-in-few-sessions');
  });
});

describe('rule: output token share', () => {
  it('states the share factually with both numbers', () => {
    const r = get({ ...EMPTY, totalTokens: 1_000_000, outputTokens: 12_000 }, 'output-token-share');
    expect(r).toBeDefined();
    expect(r!.tone).toBe('info');
    expect(r!.detail).toContain('1.2%');
    expect(r!.detail).toContain('12.0k');
    expect(r!.detail).toContain('1.0M');
  });

  it('is omitted when no tokens were recorded', () => {
    expect(ids({ ...EMPTY, totalTokens: 0, outputTokens: 500 })).not.toContain('output-token-share');
  });
});

describe('rule: busiest weekday', () => {
  const week = [
    { weekday: 0, tokens: 1000 },
    { weekday: 1, tokens: 9000 },
    { weekday: 2, tokens: 2000 },
  ];

  it('names the weekday with the most tokens', () => {
    const r = get({ ...EMPTY, weekdayTokens: week }, 'busiest-weekday');
    expect(r).toBeDefined();
    expect(r!.title).toContain('Monday');
    expect(r!.detail).toContain('75%');
    expect(r!.evidence![0]).toContain('Monday');
  });

  it('breaks ties by the earlier weekday, deterministically', () => {
    const tied = [
      { weekday: 5, tokens: 5000 },
      { weekday: 2, tokens: 5000 },
    ];
    expect(get({ ...EMPTY, weekdayTokens: tied }, 'busiest-weekday')!.title).toContain('Tuesday');
  });

  it('is omitted with only one active weekday', () => {
    expect(ids({ ...EMPTY, weekdayTokens: [{ weekday: 3, tokens: 5000 }] })).not.toContain('busiest-weekday');
  });

  it('ignores out-of-range weekday values', () => {
    const bad = [
      { weekday: 9, tokens: 5000 },
      { weekday: -1, tokens: 5000 },
    ];
    expect(ids({ ...EMPTY, weekdayTokens: bad })).not.toContain('busiest-weekday');
  });
});

describe('rule: tool-heavy sessions', () => {
  const sessions = [
    session('heavy', { turns: 10, toolUses: 120 }),
    session('normal1', { turns: 10, toolUses: 5 }),
    session('normal2', { turns: 8, toolUses: 4 }),
  ];

  it('fires and reports the heaviest ratio', () => {
    const r = get({ ...EMPTY, sessions }, 'tool-heavy-sessions');
    expect(r).toBeDefined();
    expect(r!.detail).toContain('12x');
    expect(r!.detail).toContain('120 tool calls');
  });

  it('is omitted when no session exceeds five tool calls per turn', () => {
    const calm = sessions.map((s) => ({ ...s, toolUses: 4 }));
    expect(ids({ ...EMPTY, sessions: calm })).not.toContain('tool-heavy-sessions');
  });

  it('is omitted when there are fewer than three eligible sessions', () => {
    expect(ids({ ...EMPTY, sessions: sessions.slice(0, 2) })).not.toContain('tool-heavy-sessions');
  });

  it('ignores sessions with fewer than three turns', () => {
    const tiny = sessions.map((s) => ({ ...s, turns: 2 }));
    expect(ids({ ...EMPTY, sessions: tiny })).not.toContain('tool-heavy-sessions');
  });
});

describe('rule: cache savings', () => {
  it('fires with a stated estimate', () => {
    const r = get({ ...EMPTY, cacheReadTokens: 5_000_000, cacheSavingsUsd: 12.5 }, 'cache-savings');
    expect(r).toBeDefined();
    expect(r!.tone).toBe('positive');
    expect(r!.detail).toContain('$12.50');
    expect(r!.detail).toContain('5.0M');
    expect(r!.detail).toMatch(/estimate/i);
  });

  it('is omitted when savings could not be priced', () => {
    expect(ids({ ...EMPTY, cacheReadTokens: 5_000_000, cacheSavingsUsd: null })).not.toContain('cache-savings');
  });

  it('is omitted when nothing was served from cache', () => {
    expect(ids({ ...EMPTY, cacheReadTokens: 0, cacheSavingsUsd: 3 })).not.toContain('cache-savings');
  });
});

describe('rule: suggested clear point', () => {
  const turns = ['a', 'b', 'c'].flatMap(growingSession);

  it('fires across three or more sessions and phrases it as guidance', () => {
    const r = get({ ...EMPTY, turns }, 'suggested-clear-point');
    expect(r).toBeDefined();
    expect(r!.detail).toContain('turn 6');
    expect(r!.detail).toMatch(/may be cheaper/);
  });

  it('is omitted with only two qualifying sessions', () => {
    const two = ['a', 'b'].flatMap(growingSession);
    expect(ids({ ...EMPTY, turns: two })).not.toContain('suggested-clear-point');
  });

  it('is omitted when cost never doubles', () => {
    const flat = turns.map((t) => ({ ...t, cost: 0.02 }));
    expect(ids({ ...EMPTY, turns: flat })).not.toContain('suggested-clear-point');
  });

  it('is omitted when early turns are free, avoiding a divide-by-zero baseline', () => {
    const zeroBase = turns.map((t) => (t.turnIndex < 3 ? { ...t, cost: 0 } : t));
    expect(ids({ ...EMPTY, turns: zeroBase })).not.toContain('suggested-clear-point');
  });
});

describe('rule: prompt coverage', () => {
  const mixed = [
    ...Array.from({ length: 10 }, (_, k) => turn('a', k, { promptLength: 80 })),
    ...Array.from({ length: 15 }, (_, k) => turn('b', k, { promptLength: null })),
  ];

  it('fires when a meaningful share of turns has no prompt', () => {
    const r = get({ ...EMPTY, turns: mixed }, 'prompt-coverage');
    expect(r).toBeDefined();
    expect(r!.detail).toContain('40%');
    expect(r!.detail).toContain('25 turns');
  });

  it('is omitted when every turn has a prompt', () => {
    const all = mixed.map((t) => ({ ...t, promptLength: 50 }));
    expect(ids({ ...EMPTY, turns: all })).not.toContain('prompt-coverage');
  });

  it('is omitted when no turn has a prompt at all', () => {
    const none = mixed.map((t) => ({ ...t, promptLength: null }));
    expect(ids({ ...EMPTY, turns: none })).not.toContain('prompt-coverage');
  });

  it('is omitted on too few turns to judge', () => {
    expect(ids({ ...EMPTY, turns: mixed.slice(0, 12) })).not.toContain('prompt-coverage');
  });
});

describe('rule: one session dominates cost', () => {
  const sessions = [
    session('whale', { cost: 40 }),
    ...Array.from({ length: 5 }, (_, k) => session(`s${k}`, { cost: 2 })),
  ];

  it('fires when the top session carries at least a quarter of cost', () => {
    const r = get({ ...EMPTY, sessions }, 'single-session-dominates-cost');
    expect(r).toBeDefined();
    expect(r!.detail).toContain('$40.00');
    expect(r!.detail).toContain('80%');
  });

  it('is omitted when cost is evenly spread', () => {
    const even = sessions.map((s) => ({ ...s, cost: 2 }));
    expect(ids({ ...EMPTY, sessions: even })).not.toContain('single-session-dominates-cost');
  });

  it('is omitted when nothing could be priced', () => {
    const unpriced = sessions.map((s) => ({ ...s, cost: null }));
    expect(ids({ ...EMPTY, sessions: unpriced })).not.toContain('single-session-dominates-cost');
  });
});

/* ------------------------ cross-cutting ------------------------- */

const RICH: InsightInput = {
  turns: [
    ...['a', 'b', 'c'].flatMap(growingSession),
    ...Array.from({ length: 6 }, (_, k) => turn('d', k, { promptLength: 8, cost: 0.4 })),
    ...Array.from({ length: 6 }, (_, k) => turn('e', k, { promptLength: 400, cost: 0.05 })),
    ...Array.from({ length: 6 }, (_, k) => turn('f', k, { promptLength: null, cost: 0.05 })),
  ],
  sessions: [
    session('a', { turns: 9, tokens: 900_000, cost: 40, toolUses: 200 }),
    session('b', { turns: 9, tokens: 20_000, cost: 2, toolUses: 3 }),
    session('c', { turns: 9, tokens: 20_000, cost: 2, toolUses: 3 }),
    session('d', { turns: 6, tokens: 15_000, cost: 2, toolUses: 1 }),
    session('e', { turns: 6, tokens: 15_000, cost: 2, toolUses: 1 }),
    session('f', { turns: 6, tokens: 15_000, cost: 2, toolUses: 1 }),
  ],
  weekdayTokens: [
    { weekday: 1, tokens: 500_000 },
    { weekday: 2, tokens: 300_000 },
    { weekday: 4, tokens: 185_000 },
  ],
  totalTokens: 985_000,
  outputTokens: 9_850,
  cacheReadTokens: 700_000,
  cacheSavingsUsd: 4.25,
};

describe('buildInsights — determinism and safety', () => {
  it('produces identical output for the same input, twenty times over', () => {
    const runs = Array.from({ length: 20 }, () => buildInsights(structuredClone(RICH)));
    const first = JSON.stringify(runs[0]);
    for (const r of runs) expect(JSON.stringify(r)).toBe(first);
    expect(runs[0].length).toBeGreaterThan(4);
  });

  it('is insensitive to the order rows arrive in', () => {
    const shuffled: InsightInput = {
      ...RICH,
      turns: RICH.turns.slice().reverse(),
      sessions: RICH.sessions.slice().reverse(),
      weekdayTokens: RICH.weekdayTokens.slice().reverse(),
    };
    expect(buildInsights(shuffled)).toEqual(buildInsights(RICH));
  });

  it('does not mutate its input', () => {
    const copy = structuredClone(RICH);
    buildInsights(copy);
    expect(copy).toEqual(RICH);
  });

  it('emits no NaN, Infinity, undefined or null in any string', () => {
    for (const i of buildInsights(RICH)) {
      const text = [i.title, i.detail, ...(i.evidence ?? [])].join(' | ');
      expect(text).not.toMatch(/NaN|Infinity|undefined|null/);
      // format.ts renders an unusable number as "—"; prose em dashes are fine.
      expect(text).not.toMatch(/\$\s*—|—\s*(tokens|turns|%)/);
    }
  });

  it('gives every insight a stable id, a tone, a title and numeric detail', () => {
    const out = buildInsights(RICH);
    expect(new Set(out.map((i) => i.id)).size).toBe(out.length);
    for (const i of out) {
      expect(['positive', 'negative', 'warning', 'info']).toContain(i.tone);
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.title).toBe(i.title.replace(/[\u{1F300}-\u{1FAFF}]/gu, ''));
      expect(i.detail).toMatch(/\d/);
    }
  });

  it('survives degenerate numbers without emitting broken output', () => {
    const nasty: InsightInput = {
      ...EMPTY,
      turns: [turn('x', 0, { cost: 0, tokens: 0 }), turn('x', 1, { cost: null, tokens: 0 })],
      sessions: [session('x', { turns: 0, tokens: 0, cost: 0, toolUses: 0 })],
      weekdayTokens: [{ weekday: 0, tokens: 0 }],
      totalTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheSavingsUsd: 0,
    };
    const out = buildInsights(nasty);
    for (const i of out) expect(i.detail).not.toMatch(/NaN|Infinity/);
  });
});
