import { describe, expect, it } from 'vitest';
import { scoreProject, type ScoreInput } from '@/lib/roi/recommend';

const BASE: ScoreInput = {
  roiPct: 0,
  netValue: 0,
  recentValueGrowth: null,
  costTrend: null,
  valuePerMTok: null,
  pricingCoverage: 1,
  realisedShare: 1,
  daysSinceValueUpdate: 10,
  totalTokens: 5_000_000,
  hasValueData: true,
};

describe('scoreProject — insufficient data', () => {
  it('returns Insufficient Data when no value has been recorded', () => {
    const r = scoreProject({ ...BASE, hasValueData: false, roiPct: 900, netValue: 100_000 });
    expect(r.recommendation).toBe('Insufficient Data');
    expect(r.score).toBe(0);
    expect(r.confidence).toBe('low');
    expect(r.factors).toHaveLength(1);
    expect(r.factors[0].detail).toMatch(/No project value has been recorded/);
  });

  it('returns Insufficient Data when token usage is below the threshold', () => {
    const r = scoreProject({ ...BASE, totalTokens: 999 });
    expect(r.recommendation).toBe('Insufficient Data');
    expect(r.factors[0].detail).toMatch(/Too little token usage/);
  });

  it('the 1000-token threshold is inclusive', () => {
    expect(scoreProject({ ...BASE, totalTokens: 1000 }).recommendation).not.toBe('Insufficient Data');
  });
});

describe('scoreProject — stable classifications', () => {
  it('classifies a strong, well-evidenced project as Double Down', () => {
    const r = scoreProject({
      ...BASE,
      roiPct: 400,
      netValue: 5000,
      recentValueGrowth: 1.5,
      costTrend: 1.1,
      valuePerMTok: 200,
    });
    expect(r.recommendation).toBe('Double Down');
    expect(r.score).toBeGreaterThanOrEqual(30);
    expect(r.confidence).toBe('high');
    expect(r.factors.map((f) => f.label)).toEqual([
      'Realised ROI',
      'Net value',
      'Recent value growth',
      'Cost trend',
      'Token efficiency',
    ]);
  });

  it('classifies a modestly positive project as Maintain', () => {
    const r = scoreProject({ ...BASE, roiPct: 50, netValue: 500 });
    expect(r.score).toBeGreaterThanOrEqual(10);
    expect(r.score).toBeLessThan(30);
    expect(r.recommendation).toBe('Maintain');
  });

  it('classifies a neutral project as Validate Further', () => {
    expect(scoreProject(BASE).recommendation).toBe('Validate Further');
    expect(scoreProject(BASE).score).toBe(0);
  });

  it('classifies a mildly loss-making project as Reduce Spend', () => {
    const r = scoreProject({ ...BASE, roiPct: -100, netValue: -100 });
    expect(r.score).toBeLessThan(-5);
    expect(r.score).toBeGreaterThanOrEqual(-20);
    expect(r.recommendation).toBe('Reduce Spend');
  });

  it('classifies a badly loss-making, shrinking project as Pause', () => {
    const r = scoreProject({
      ...BASE,
      roiPct: -500,
      netValue: -5000,
      recentValueGrowth: 0.2,
      costTrend: 2,
      valuePerMTok: 0,
    });
    expect(r.score).toBeLessThan(-20);
    expect(r.recommendation).toBe('Pause');
  });

  it('downgrades great-looking numbers built on estimates to Validate Further', () => {
    const r = scoreProject({
      ...BASE,
      roiPct: 900,
      netValue: 50_000,
      realisedShare: 0.1,
      pricingCoverage: 0.3,
    });
    expect(r.recommendation).toBe('Validate Further');
    expect(r.confidence).toBe('low');
    expect(r.factors.map((f) => f.label)).toContain('Data confidence');
    expect(r.factors.map((f) => f.label)).toContain('Value quality');
  });
});

describe('scoreProject — factor behaviour', () => {
  it('does not penalise rising cost when value rises at least as fast', () => {
    const keeping = scoreProject({ ...BASE, recentValueGrowth: 2, costTrend: 2 });
    const notKeeping = scoreProject({ ...BASE, recentValueGrowth: 1, costTrend: 2 });
    expect(keeping.factors.find((f) => f.label === 'Cost trend')!.points).toBe(0);
    expect(notKeeping.factors.find((f) => f.label === 'Cost trend')!.points).toBeLessThan(0);
  });

  it('penalises stale value data only beyond 90 days', () => {
    expect(
      scoreProject({ ...BASE, daysSinceValueUpdate: 90 }).factors.map((f) => f.label),
    ).not.toContain('Stale value data');
    const stale = scoreProject({ ...BASE, daysSinceValueUpdate: 300 });
    expect(stale.factors.find((f) => f.label === 'Stale value data')!.points).toBeLessThan(0);
  });

  it('reports confidence from coverage and realised share', () => {
    expect(scoreProject({ ...BASE, pricingCoverage: 1, realisedShare: 1 }).confidence).toBe('high');
    expect(scoreProject({ ...BASE, pricingCoverage: 0.8, realisedShare: 1 }).confidence).toBe('medium');
    expect(scoreProject({ ...BASE, pricingCoverage: 0.4, realisedShare: 1 }).confidence).toBe('low');
  });
});

describe('scoreProject — determinism', () => {
  const input: ScoreInput = {
    roiPct: 137.4,
    netValue: 2871.55,
    recentValueGrowth: 1.23,
    costTrend: 1.4,
    valuePerMTok: 88.125,
    pricingCoverage: 0.82,
    realisedShare: 0.71,
    daysSinceValueUpdate: 145,
    totalTokens: 12_345_678,
    hasValueData: true,
  };

  it('identical input always produces an identical result', () => {
    const runs = Array.from({ length: 25 }, () => scoreProject({ ...input }));
    for (const r of runs) expect(r).toEqual(runs[0]);
    expect(JSON.stringify(runs.at(-1))).toBe(JSON.stringify(runs[0]));
  });

  it('is a pure function — it does not mutate its input', () => {
    const copy = { ...input };
    scoreProject(copy);
    expect(copy).toEqual(input);
  });

  it('a different input produces a different score', () => {
    expect(scoreProject({ ...input, roiPct: 1000 }).score).not.toBe(scoreProject(input).score);
  });
});
