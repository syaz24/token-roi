import { describe, expect, it } from 'vitest';
import { chargesInMonth, lifetimeCashCost, monthlyCashCost } from '@/lib/roi/allocation';
import { SUBSCRIPTION_PRESETS, findPreset, CUSTOM_PRESET_ID } from '@/lib/subscriptions/presets';

describe('one-time purchases', () => {
  const oneTime = { billingCycle: 'one_time', billingStart: '2026-03-14', billingEnd: null };

  it('charges only in the month of purchase', () => {
    expect(chargesInMonth(oneTime, '2026-02')).toBe(false);
    expect(chargesInMonth(oneTime, '2026-03')).toBe(true);
    expect(chargesInMonth(oneTime, '2026-04')).toBe(false);
    expect(chargesInMonth(oneTime, '2027-03')).toBe(false);
  });

  it('is not spread across months like an annual plan', () => {
    const base = { monthlyPrice: 120, seats: 1, taxPct: 0, discountPct: 0 };
    expect(monthlyCashCost({ ...base, billingCycle: 'one_time' })).toBe(120);
    expect(monthlyCashCost({ ...base, billingCycle: 'annual' })).toBe(10);
    expect(monthlyCashCost({ ...base, billingCycle: 'quarterly' })).toBe(40);
    expect(monthlyCashCost({ ...base, billingCycle: 'monthly' })).toBe(120);
  });

  it('still applies seats, tax and discount', () => {
    const cost = monthlyCashCost({
      monthlyPrice: 100,
      seats: 2,
      taxPct: 10,
      discountPct: 50,
      billingCycle: 'one_time',
    });
    // 100 * 2 seats = 200, less 50% = 100, plus 10% tax = 110
    expect(cost).toBeCloseTo(110, 6);
  });
});

describe('recurring plans', () => {
  it('charges every month from start until end', () => {
    const sub = { billingCycle: 'monthly', billingStart: '2026-01-10', billingEnd: '2026-03-31' };
    expect(chargesInMonth(sub, '2025-12')).toBe(false);
    expect(chargesInMonth(sub, '2026-01')).toBe(true);
    expect(chargesInMonth(sub, '2026-02')).toBe(true);
    expect(chargesInMonth(sub, '2026-03')).toBe(true);
    expect(chargesInMonth(sub, '2026-04')).toBe(false);
  });

  it('runs indefinitely when no end date is set', () => {
    const sub = { billingCycle: 'annual', billingStart: '2026-01-01', billingEnd: null };
    expect(chargesInMonth(sub, '2026-01')).toBe(true);
    expect(chargesInMonth(sub, '2030-11')).toBe(true);
  });
});

describe('spend to date', () => {
  const base = { monthlyPrice: 20, seats: 1, taxPct: 0, discountPct: 0 };
  const asOf = new Date('2026-07-21T00:00:00.000Z');

  it('accumulates every month since an earlier billing start', () => {
    // 2025-01 through 2026-07 inclusive is 19 months.
    const r = lifetimeCashCost(
      { ...base, billingCycle: 'monthly', billingStart: '2025-01-01', billingEnd: null },
      asOf,
    );
    expect(r.months).toBe(19);
    expect(r.total).toBeCloseTo(380, 6);
  });

  it('counts the current month for a plan started this month', () => {
    const r = lifetimeCashCost(
      { ...base, billingCycle: 'monthly', billingStart: '2026-07-20', billingEnd: null },
      asOf,
    );
    expect(r.months).toBe(1);
    expect(r.total).toBeCloseTo(20, 6);
  });

  it('stops at the billing end date', () => {
    const r = lifetimeCashCost(
      { ...base, billingCycle: 'monthly', billingStart: '2026-01-01', billingEnd: '2026-03-31' },
      asOf,
    );
    expect(r.months).toBe(3);
    expect(r.total).toBeCloseTo(60, 6);
  });

  it('spreads an annual plan across the months it covers', () => {
    const r = lifetimeCashCost(
      { monthlyPrice: 240, seats: 1, taxPct: 0, discountPct: 0, billingCycle: 'annual', billingStart: '2026-01-01', billingEnd: null },
      asOf,
    );
    // 240/12 = 20 per month, across 7 months of 2026.
    expect(r.months).toBe(7);
    expect(r.total).toBeCloseTo(140, 6);
  });

  it('counts a one-time purchase exactly once, never per month', () => {
    const r = lifetimeCashCost(
      { monthlyPrice: 50, seats: 1, taxPct: 0, discountPct: 0, billingCycle: 'one_time', billingStart: '2025-01-01', billingEnd: null },
      asOf,
    );
    expect(r.months).toBe(1);
    expect(r.total).toBeCloseTo(50, 6);
  });

  it('returns zero for a plan that has not started yet', () => {
    const future = lifetimeCashCost(
      { ...base, billingCycle: 'monthly', billingStart: '2027-01-01', billingEnd: null },
      asOf,
    );
    expect(future).toEqual({ months: 0, total: 0 });

    const futureOneOff = lifetimeCashCost(
      { ...base, billingCycle: 'one_time', billingStart: '2027-01-01', billingEnd: null },
      asOf,
    );
    expect(futureOneOff).toEqual({ months: 0, total: 0 });
  });

  it('applies seats, tax and discount to every accumulated month', () => {
    const r = lifetimeCashCost(
      { monthlyPrice: 100, seats: 2, taxPct: 10, discountPct: 50, billingCycle: 'monthly', billingStart: '2026-06-01', billingEnd: null },
      asOf,
    );
    // 100 * 2 = 200, less 50% = 100, plus 10% = 110, across June + July.
    expect(r.months).toBe(2);
    expect(r.total).toBeCloseTo(220, 6);
  });

  it('never produces NaN from a malformed date', () => {
    const r = lifetimeCashCost(
      { ...base, billingCycle: 'monthly', billingStart: 'not-a-date', billingEnd: null },
      asOf,
    );
    expect(Number.isFinite(r.total)).toBe(true);
    expect(r).toEqual({ months: 0, total: 0 });
  });
});

describe('subscription presets', () => {
  it('every preset is complete and has a positive price', () => {
    for (const p of SUBSCRIPTION_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.provider).toBeTruthy();
      expect(p.planName).toBeTruthy();
      expect(p.price).toBeGreaterThan(0);
      expect(['monthly', 'annual', 'one_time']).toContain(p.cycle);
    }
  });

  it('preset ids are unique so selection is unambiguous', () => {
    const ids = SUBSCRIPTION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves a known preset and rejects the custom sentinel', () => {
    expect(findPreset('claude-max-20')).toMatchObject({ provider: 'Anthropic', price: 200 });
    expect(findPreset(CUSTOM_PRESET_ID)).toBeUndefined();
    expect(findPreset('nope')).toBeUndefined();
  });
});
