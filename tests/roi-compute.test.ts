import { describe, expect, it } from 'vitest';
import {
  breakEven,
  costForBasis,
  cumulative,
  expandValueEvent,
  paybackDays,
  pricingCoverage,
  revenueToCostRatio,
  roi,
  valuePerMillionTokens,
  type ValueEventLike,
} from '@/lib/roi/compute';

describe('roi()', () => {
  it('computes net value, percentage and multiple', () => {
    const r = roi({ value: 1500, cost: 500 });
    expect(r.netValue).toBe(1000);
    expect(r.roiPct).toBe(200);
    expect(r.roiMultiple).toBe(3);
    expect(r.note).toBe('ok');
  });

  it('reports a negative return honestly', () => {
    const r = roi({ value: 250, cost: 1000 });
    expect(r.netValue).toBe(-750);
    expect(r.roiPct).toBe(-75);
    expect(r.roiMultiple).toBe(0.25);
    expect(r.note).toBe('ok');
  });

  it('breaking even is exactly 0% / 1x', () => {
    const r = roi({ value: 400, cost: 400 });
    expect(r.roiPct).toBe(0);
    expect(r.roiMultiple).toBe(1);
  });

  it('zero cost returns note "no_cost" with null ratios — never Infinity or NaN', () => {
    const r = roi({ value: 900, cost: 0 });
    expect(r.note).toBe('no_cost');
    expect(r.roiPct).toBeNull();
    expect(r.roiMultiple).toBeNull();
    expect(r.netValue).toBe(900);
    expect(Number.isFinite(r.roiPct as number)).toBe(false);
  });

  it('negative and non-finite costs are treated as "no_cost" too', () => {
    for (const cost of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = roi({ value: 100, cost });
      expect(r.note).toBe('no_cost');
      expect(r.roiPct).toBeNull();
    }
  });

  it('zero value with real cost is -100%, not "no value"', () => {
    const r = roi({ value: 0, cost: 200 });
    expect(r.note).toBe('ok');
    expect(r.roiPct).toBe(-100);
    expect(r.roiMultiple).toBe(0);
  });

  it('non-finite value returns note "no_value"', () => {
    expect(roi({ value: Number.NaN, cost: 100 }).note).toBe('no_value');
  });

  it('an incomplete cost figure short-circuits to "cost_unknown"', () => {
    const r = roi({ value: 1000, cost: 100, costKnown: false });
    expect(r).toEqual({ netValue: null, roiPct: null, roiMultiple: null, note: 'cost_unknown' });
  });
});

describe('valuePerMillionTokens / revenueToCostRatio', () => {
  it('scales value by millions of tokens', () => {
    expect(valuePerMillionTokens(500, 2_000_000)).toBe(250);
    expect(valuePerMillionTokens(500, 500_000)).toBe(1000);
  });
  it('returns null instead of dividing by zero', () => {
    expect(valuePerMillionTokens(500, 0)).toBeNull();
    expect(valuePerMillionTokens(500, Number.NaN)).toBeNull();
    expect(revenueToCostRatio(500, 0)).toBeNull();
    expect(revenueToCostRatio(500, 250)).toBe(2);
  });
});

describe('breakEven()', () => {
  it('reports the remaining value required', () => {
    expect(breakEven(300, 1000)).toEqual({ passed: false, requiredValue: 1000, remaining: 700 });
  });
  it('passes once value reaches cost', () => {
    expect(breakEven(1000, 1000)).toEqual({ passed: true, requiredValue: 1000, remaining: 0 });
  });
  it('does not claim break-even when there is no cost at all', () => {
    expect(breakEven(50, 0)).toEqual({ passed: false, requiredValue: 0, remaining: 0 });
  });
});

describe('expandValueEvent()', () => {
  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date('2026-06-30T00:00:00Z');

  const base: ValueEventLike = {
    amount: 500,
    date: '2026-01-15T12:00:00Z',
    recurring: false,
    realised: true,
  };

  it('emits a one-off event once, and only inside the window', () => {
    expect(expandValueEvent(base, from, to)).toHaveLength(1);
    expect(expandValueEvent({ ...base, date: '2025-11-01T12:00:00Z' }, from, to)).toHaveLength(0);
    expect(expandValueEvent({ ...base, date: '2027-01-01T12:00:00Z' }, from, to)).toHaveLength(0);
  });

  it('expands monthly recurrence across the window', () => {
    const out = expandValueEvent({ ...base, recurring: true, recurrencePeriod: 'monthly' }, from, to);
    expect(out).toHaveLength(6); // Jan..Jun 15th
    expect(out.every((o) => o.amount === 500)).toBe(true);
    expect(out[0].date.toISOString().slice(0, 10)).toBe('2026-01-15');
    expect(out[5].date.toISOString().slice(0, 10)).toBe('2026-06-15');
  });

  it('expands quarterly recurrence', () => {
    const out = expandValueEvent({ ...base, recurring: true, recurrencePeriod: 'quarterly' }, from, to);
    expect(out.map((o) => o.date.toISOString().slice(0, 7))).toEqual(['2026-01', '2026-04']);
  });

  it('expands yearly recurrence', () => {
    const out = expandValueEvent(
      { ...base, recurring: true, recurrencePeriod: 'yearly' },
      from,
      new Date('2029-01-01T00:00:00Z'),
    );
    expect(out.map((o) => o.date.toISOString().slice(0, 7))).toEqual([
      '2026-01',
      '2027-01',
      '2028-01',
    ]);
  });

  it('expands weekly recurrence in 7-day steps', () => {
    const out = expandValueEvent(
      { ...base, date: '2026-01-01T12:00:00Z', recurring: true, recurrencePeriod: 'weekly' },
      from,
      new Date('2026-01-29T23:00:00Z'),
    );
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-01-01',
      '2026-01-08',
      '2026-01-15',
      '2026-01-22',
      '2026-01-29',
    ]);
  });

  it('honours recurrenceEnd', () => {
    const out = expandValueEvent(
      {
        ...base,
        recurring: true,
        recurrencePeriod: 'monthly',
        recurrenceEnd: '2026-03-20T12:00:00Z',
      },
      from,
      to,
    );
    expect(out.map((o) => o.date.toISOString().slice(0, 7))).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('does not emit occurrences before the requested window', () => {
    const out = expandValueEvent(
      { ...base, date: '2025-10-10T12:00:00Z', recurring: true, recurrencePeriod: 'monthly' },
      from,
      new Date('2026-02-28T00:00:00Z'),
    );
    expect(out.map((o) => o.date.toISOString().slice(0, 7))).toEqual(['2026-01', '2026-02']);
  });

  it('returns nothing for an unparseable date', () => {
    expect(expandValueEvent({ ...base, date: 'not-a-date' }, from, to)).toEqual([]);
  });
});

describe('cumulative(), break-even date and paybackDays()', () => {
  const series = [
    { date: '2026-01-01', cost: 100, value: 0 },
    { date: '2026-01-11', cost: 100, value: 50 },
    { date: '2026-01-21', cost: 100, value: 100 },
    { date: '2026-01-31', cost: 100, value: 400 },
    { date: '2026-02-10', cost: 100, value: 100 },
  ];

  it('accumulates cost and value in date order', () => {
    const { points } = cumulative([...series].reverse());
    expect(points.map((p) => p.date)).toEqual(series.map((s) => s.date));
    expect(points.at(-1)!.cumCost).toBe(500);
    expect(points.at(-1)!.cumValue).toBe(650);
  });

  it('reports the first date cumulative value overtakes cumulative cost', () => {
    const { breakEvenDate } = cumulative(series);
    expect(breakEvenDate).toBe('2026-01-31'); // cum 400 cost vs 550 value
  });

  it('returns a null break-even date when value never catches up', () => {
    const { breakEvenDate } = cumulative([
      { date: '2026-01-01', cost: 100, value: 10 },
      { date: '2026-01-02', cost: 100, value: 10 },
    ]);
    expect(breakEvenDate).toBeNull();
  });

  it('measures payback in days from the first cost to break-even', () => {
    const { points } = cumulative(series);
    expect(paybackDays(points)).toBe(30); // 2026-01-01 -> 2026-01-31
  });

  it('returns null payback when break-even never happens', () => {
    const { points } = cumulative([
      { date: '2026-01-01', cost: 100, value: 0 },
      { date: '2026-01-02', cost: 100, value: 0 },
    ]);
    expect(paybackDays(points)).toBeNull();
  });

  it('returns null payback when there is no cost at all', () => {
    const { points } = cumulative([{ date: '2026-01-01', cost: 0, value: 500 }]);
    expect(paybackDays(points)).toBeNull();
  });
});

describe('costForBasis()', () => {
  const apiCost = 400;
  const cashCost = 100;

  it('api_equivalent returns the list-price figure', () => {
    expect(costForBasis('api_equivalent', apiCost, cashCost, 250)).toBe(400);
  });

  it('allocated_cash returns the attributed real spend', () => {
    expect(costForBasis('allocated_cash', apiCost, cashCost, 250)).toBe(100);
  });

  it('blended adds uncovered API-priced usage on top of real cash spend', () => {
    expect(costForBasis('blended', apiCost, cashCost, 250)).toBe(350);
  });

  it('blended defaults uncoveredApiCost to zero', () => {
    expect(costForBasis('blended', apiCost, cashCost)).toBe(100);
  });

  it('blended falls back to the API figure when no cash was spent', () => {
    expect(costForBasis('blended', apiCost, 0, 250)).toBe(400);
  });

  it('blended never subtracts for a negative uncovered figure', () => {
    expect(costForBasis('blended', apiCost, cashCost, -50)).toBe(100);
  });
});

describe('pricingCoverage()', () => {
  it('is the priced share of total token volume', () => {
    expect(pricingCoverage(750, 1000)).toBe(0.75);
    expect(pricingCoverage(0, 1000)).toBe(0);
  });
  it('is 1 when there are no tokens at all, and never exceeds 1', () => {
    expect(pricingCoverage(0, 0)).toBe(1);
    expect(pricingCoverage(1200, 1000)).toBe(1);
  });
});
