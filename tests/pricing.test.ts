import { describe, expect, it } from 'vitest';
import { PricingRegistry, normaliseModelKey, type PriceRow } from '@/lib/pricing/engine';

function row(over: Partial<PriceRow> & Pick<PriceRow, 'id' | 'modelId'>): PriceRow {
  return {
    provider: 'anthropic',
    aliases: [],
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
    reasoningPerMTok: null,
    userOverride: false,
    ...over,
  } as PriceRow;
}

describe('normaliseModelKey', () => {
  it('lowercases and trims', () => {
    expect(normaliseModelKey('  Claude-Sonnet-5 ')).toBe('claude-sonnet-5');
  });
  it('strips provider prefixes', () => {
    expect(normaliseModelKey('anthropic/claude-sonnet-5')).toBe('claude-sonnet-5');
    expect(normaliseModelKey('openai/gpt-5.5')).toBe('gpt-5-5');
    expect(normaliseModelKey('models/gemini-3-pro')).toBe('gemini-3-pro');
    expect(normaliseModelKey('google/gemini-3-pro')).toBe('gemini-3-pro');
  });
  it('strips a trailing 8-digit date stamp', () => {
    expect(normaliseModelKey('claude-sonnet-5-20260115')).toBe('claude-sonnet-5');
    expect(normaliseModelKey('claude-opus-4-8-20260115')).toBe('claude-opus-4-8');
  });
  it('strips a -latest suffix and normalises dots/underscores', () => {
    expect(normaliseModelKey('gpt-5.5-latest')).toBe('gpt-5-5');
    expect(normaliseModelKey('gpt_5_5')).toBe('gpt-5-5');
  });
});

describe('PricingRegistry.resolve', () => {
  it('resolves by canonical model id', () => {
    const reg = new PricingRegistry([row({ id: 'r1', modelId: 'claude-sonnet-5' })]);
    expect(reg.resolve('claude-sonnet-5', '2026-07-01T00:00:00Z')?.id).toBe('r1');
  });

  it('resolves through an alias', () => {
    const reg = new PricingRegistry([
      row({ id: 'r1', modelId: 'claude-sonnet-5', aliases: ['sonnet-5', 'claude-sonnet-5-20260115'] }),
    ]);
    expect(reg.resolve('sonnet-5', '2026-07-01T00:00:00Z')?.id).toBe('r1');
    expect(reg.resolve('Anthropic/Sonnet-5', '2026-07-01T00:00:00Z')?.id).toBe('r1');
  });

  it('falls back to the longest registered prefix family for unseen variants', () => {
    const reg = new PricingRegistry([
      row({ id: 'family', modelId: 'gpt-5' }),
      row({ id: 'specific', modelId: 'gpt-5-mini', inputPerMTok: 0.25 }),
    ]);
    // exact key is unknown; longest prefix wins
    expect(reg.resolve('gpt-5-mini-high', '2026-07-01T00:00:00Z')?.id).toBe('specific');
    expect(reg.resolve('gpt-5-turbo-preview', '2026-07-01T00:00:00Z')?.id).toBe('family');
  });

  it('returns null for a completely unknown model and for null input', () => {
    const reg = new PricingRegistry([row({ id: 'r1', modelId: 'claude-sonnet-5' })]);
    expect(reg.resolve('some-local-llama', '2026-07-01T00:00:00Z')).toBeNull();
    expect(reg.resolve(null, '2026-07-01T00:00:00Z')).toBeNull();
    expect(reg.resolve(undefined, '2026-07-01T00:00:00Z')).toBeNull();
  });
});

describe('effective-date pricing windows', () => {
  const old = row({
    id: 'old',
    modelId: 'claude-sonnet-5',
    effectiveFrom: '2025-01-01',
    effectiveTo: '2026-01-01',
    inputPerMTok: 10,
  });
  const current = row({
    id: 'current',
    modelId: 'claude-sonnet-5',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    inputPerMTok: 3,
  });
  const reg = new PricingRegistry([old, current]);

  it('picks the row whose window contains the event date', () => {
    expect(reg.resolve('claude-sonnet-5', '2025-06-15T12:00:00Z')?.id).toBe('old');
    expect(reg.resolve('claude-sonnet-5', '2026-07-13T12:00:00Z')?.id).toBe('current');
  });

  it('treats effectiveTo as exclusive and effectiveFrom as inclusive', () => {
    expect(reg.resolve('claude-sonnet-5', '2026-01-01T00:00:00Z')?.id).toBe('current');
    expect(reg.resolve('claude-sonnet-5', '2025-12-31T23:59:59Z')?.id).toBe('old');
  });

  it('returns null before any window opens', () => {
    expect(reg.resolve('claude-sonnet-5', '2024-06-01T00:00:00Z')).toBeNull();
  });

  it('prices the same tokens differently either side of the boundary', () => {
    const tokens = { inputTokens: 1_000_000 };
    expect(reg.cost('claude-sonnet-5', '2025-06-01T00:00:00Z', tokens)!.total).toBe(10);
    expect(reg.cost('claude-sonnet-5', '2026-06-01T00:00:00Z', tokens)!.total).toBe(3);
  });

  it('prefers a user override over a bundled default in the same window', () => {
    const reg2 = new PricingRegistry([
      row({ id: 'seed', modelId: 'gpt-5.5', inputPerMTok: 1.25 }),
      row({ id: 'mine', modelId: 'gpt-5.5', inputPerMTok: 0.9, userOverride: true }),
    ]);
    expect(reg2.resolve('gpt-5.5', '2026-07-01T00:00:00Z')?.id).toBe('mine');
  });
});

describe('API-equivalent cost maths', () => {
  const reg = new PricingRegistry([
    row({
      id: 'sonnet',
      modelId: 'claude-sonnet-5',
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3.75,
    }),
  ]);

  it('computes each component exactly for a known token count', () => {
    const c = reg.cost('claude-sonnet-5', '2026-07-13T00:00:00Z', {
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 100_000,
    })!;
    // 1.0M * 3 = 3.00 | 0.2M * 15 = 3.00 | 0.5M * 0.3 = 0.15 | 0.1M * 3.75 = 0.375
    expect(c.inputCost).toBeCloseTo(3, 10);
    expect(c.outputCost).toBeCloseTo(3, 10);
    expect(c.cacheReadCost).toBeCloseTo(0.15, 10);
    expect(c.cacheWriteCost).toBeCloseTo(0.375, 10);
    expect(c.reasoningCost).toBe(0);
    expect(c.total).toBeCloseTo(6.525, 10);
    expect(c.pricingId).toBe('sonnet');
  });

  it('handles the real claude fixture record exactly', () => {
    // input 2, output 4, cache write 26221, cache read 0
    const c = reg.cost('claude-sonnet-5', '2026-07-13T10:14:21.525Z', {
      inputTokens: 2,
      outputTokens: 4,
      cacheWriteTokens: 26221,
      cacheReadTokens: 0,
    })!;
    const expected = (2 / 1e6) * 3 + (4 / 1e6) * 15 + (26221 / 1e6) * 3.75;
    expect(c.total).toBeCloseTo(expected, 12);
    expect(c.total).toBeCloseTo(0.09839475, 10);
  });

  it('treats missing token counts as zero, not NaN', () => {
    const c = reg.cost('claude-sonnet-5', '2026-07-13T00:00:00Z', {
      inputTokens: null,
      outputTokens: 1_000_000,
    })!;
    expect(c.inputCost).toBe(0);
    expect(c.total).toBe(15);
  });

  it('bills reasoning tokens only when a distinct reasoning price exists', () => {
    const noReason = reg.cost('claude-sonnet-5', '2026-07-13T00:00:00Z', {
      outputTokens: 1_000_000,
      reasoningTokens: 500_000,
    })!;
    expect(noReason.reasoningCost).toBe(0);
    expect(noReason.total).toBe(15);

    const withReason = new PricingRegistry([
      row({ id: 'rz', modelId: 'o3', outputPerMTok: 8, reasoningPerMTok: 4 }),
    ]).cost('o3', '2026-07-13T00:00:00Z', { outputTokens: 1_000_000, reasoningTokens: 500_000 })!;
    expect(withReason.reasoningCost).toBe(2);
    expect(withReason.total).toBe(10);
  });
});

describe('unpriced models', () => {
  const reg = new PricingRegistry([row({ id: 'r1', modelId: 'claude-sonnet-5' })]);

  it('returns null — never zero — when no pricing row matches', () => {
    const c = reg.cost('llama-3-70b-local', '2026-07-13T00:00:00Z', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(c).toBeNull();
    expect(c).not.toBe(0);
  });

  it('returns null when the model is outside every effective window', () => {
    const dated = new PricingRegistry([
      row({ id: 'd', modelId: 'claude-sonnet-5', effectiveFrom: '2026-01-01' }),
    ]);
    expect(dated.cost('claude-sonnet-5', '2024-01-01T00:00:00Z', { inputTokens: 100 })).toBeNull();
  });

  it('returns null for a null/empty model id', () => {
    expect(reg.cost(null, '2026-07-13T00:00:00Z', { inputTokens: 10 })).toBeNull();
    expect(reg.cost('', '2026-07-13T00:00:00Z', { inputTokens: 10 })).toBeNull();
  });
});
