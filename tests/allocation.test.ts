import { describe, expect, it } from 'vitest';
import { allocate, monthlyCashCost, type ProjectUsage } from '@/lib/roi/allocation';

const USAGE: ProjectUsage[] = [
  { projectId: 'a', tokens: 750_000, sessions: 30, activeDays: 15 },
  { projectId: 'b', tokens: 250_000, sessions: 10, activeDays: 5 },
];
const NONE = { tokens: 0, sessions: 0, activeDays: 0 };

describe('allocate — all six methods', () => {
  it('token_share splits by token volume', () => {
    const r = allocate(100, 'token_share', USAGE, {}, NONE);
    expect(r.byProject).toEqual({ a: 75, b: 25 });
    expect(r.unallocated).toBe(0);
    expect(r.confidence).toBe(1);
  });

  it('session_share splits by session count', () => {
    const r = allocate(100, 'session_share', USAGE, {}, NONE);
    expect(r.byProject.a).toBeCloseTo(75, 10);
    expect(r.byProject.b).toBeCloseTo(25, 10);
  });

  it('active_day_share splits by active days', () => {
    const r = allocate(100, 'active_day_share', USAGE, {}, NONE);
    expect(r.byProject.a).toBeCloseTo(75, 10);
    expect(r.byProject.b).toBeCloseTo(25, 10);
  });

  it('equal splits evenly regardless of usage', () => {
    const r = allocate(100, 'equal', USAGE, {}, NONE);
    expect(r.byProject).toEqual({ a: 50, b: 50 });
    expect(r.unallocated).toBe(0);
  });

  it('manual_pct honours explicit percentages', () => {
    const r = allocate(200, 'manual_pct', USAGE, { percentages: { a: 60, b: 40 } });
    expect(r.byProject).toEqual({ a: 120, b: 80 });
    expect(r.unallocated).toBe(0);
    expect(r.confidence).toBe(1);
  });

  it('direct puts the whole cost on one project', () => {
    const r = allocate(100, 'direct', USAGE, { projectId: 'b' });
    expect(r.byProject).toEqual({ b: 100 });
    expect(r.unallocated).toBe(0);
  });

  it('direct with no project selected leaves everything unallocated', () => {
    const r = allocate(100, 'direct', USAGE, {});
    expect(r.byProject).toEqual({});
    expect(r.unallocated).toBe(100);
    expect(r.confidence).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('equal with no projects leaves everything unallocated', () => {
    const r = allocate(100, 'equal', [], {});
    expect(r.unallocated).toBe(100);
    expect(r.confidence).toBe(0);
  });
});

describe('manual percentages', () => {
  it('scales percentages over 100% back down to exactly the amount paid', () => {
    const r = allocate(100, 'manual_pct', USAGE, { percentages: { a: 90, b: 60 } });
    const total = Object.values(r.byProject).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100, 10);
    expect(r.byProject.a).toBeCloseTo(60, 10);
    expect(r.byProject.b).toBeCloseTo(40, 10);
    expect(r.unallocated).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/150\.0%.*scaled down/);
  });

  it('leaves the shortfall unallocated when percentages sum below 100', () => {
    const r = allocate(100, 'manual_pct', USAGE, { percentages: { a: 30, b: 20 } });
    expect(r.byProject).toEqual({ a: 30, b: 20 });
    expect(r.unallocated).toBeCloseTo(50, 10);
    expect(r.confidence).toBeCloseTo(0.5, 10);
    expect(r.warnings.join(' ')).toMatch(/unallocated/);
  });

  it('ignores negative and non-finite percentages', () => {
    const r = allocate(100, 'manual_pct', USAGE, { percentages: { a: -20, b: 50 } });
    expect(r.byProject.a).toBe(0);
    expect(r.byProject.b).toBe(50);
  });
});

describe('unassigned usage and empty periods', () => {
  it('leaves the unassigned share unallocated rather than redistributing it', () => {
    const r = allocate(100, 'token_share', USAGE, {}, { tokens: 1_000_000, sessions: 0, activeDays: 0 });
    expect(r.byProject.a).toBeCloseTo(37.5, 10);
    expect(r.byProject.b).toBeCloseTo(12.5, 10);
    expect(r.unallocated).toBeCloseTo(50, 10);
    expect(r.confidence).toBeCloseTo(0.5, 10);
    expect(r.warnings.join(' ')).toMatch(/unassigned/);
  });

  it('a zero-usage period allocates nothing and warns', () => {
    const r = allocate(
      100,
      'token_share',
      [{ projectId: 'a', tokens: 0, sessions: 0, activeDays: 0 }],
      {},
      NONE,
    );
    expect(r.byProject).toEqual({});
    expect(r.unallocated).toBe(100);
    expect(r.confidence).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/No usage recorded/);
  });

  it('a zero or negative period cost allocates nothing at all', () => {
    for (const cost of [0, -10, Number.NaN]) {
      const r = allocate(cost, 'token_share', USAGE, {}, NONE);
      expect(r.byProject).toEqual({});
      expect(r.unallocated).toBe(0);
    }
  });
});

describe('monthlyCashCost', () => {
  it('multiplies by seats', () => {
    expect(monthlyCashCost({ monthlyPrice: 20, seats: 3, taxPct: 0, discountPct: 0, billingCycle: 'monthly' })).toBe(60);
  });

  it('treats a zero/absent seat count as one seat', () => {
    expect(monthlyCashCost({ monthlyPrice: 20, seats: 0, taxPct: 0, discountPct: 0, billingCycle: 'monthly' })).toBe(20);
  });

  it('spreads annual and quarterly cycles across the months they cover', () => {
    expect(
      monthlyCashCost({ monthlyPrice: 1200, seats: 1, taxPct: 0, discountPct: 0, billingCycle: 'annual' }),
    ).toBe(100);
    expect(
      monthlyCashCost({ monthlyPrice: 300, seats: 1, taxPct: 0, discountPct: 0, billingCycle: 'quarterly' }),
    ).toBe(100);
  });

  it('applies the discount before tax', () => {
    // 100 * 2 seats = 200 ; -10% = 180 ; +8% tax = 194.4
    expect(
      monthlyCashCost({ monthlyPrice: 100, seats: 2, taxPct: 8, discountPct: 10, billingCycle: 'monthly' }),
    ).toBeCloseTo(194.4, 10);
  });

  it('combines seats, cycle, discount and tax together', () => {
    // 1200 * 2 = 2400 annual ; /12 = 200 ; -25% = 150 ; +6% = 159
    expect(
      monthlyCashCost({ monthlyPrice: 1200, seats: 2, taxPct: 6, discountPct: 25, billingCycle: 'annual' }),
    ).toBeCloseTo(159, 10);
  });
});
