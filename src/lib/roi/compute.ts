/**
 * ROI mathematics.
 *
 * Every function here is total: zero cost, missing cost and negative inputs all
 * return an explicit null/flag rather than Infinity or NaN. "No cost recorded"
 * and "ROI of zero" are different answers and are never conflated.
 */

export type CostBasis = 'api_equivalent' | 'allocated_cash' | 'blended';

export interface ValueEventLike {
  amount: number;
  date: string;
  recurring: boolean;
  recurrencePeriod?: string | null;
  recurrenceEnd?: string | null;
  realised: boolean;
}

export interface RoiInput {
  value: number;
  cost: number;
  /** False when we know the cost figure is incomplete (unpriced models etc.). */
  costKnown?: boolean;
}

export interface RoiResult {
  netValue: number | null;
  roiPct: number | null;
  roiMultiple: number | null;
  /** Why a figure is null, for honest UI labelling. */
  note: 'ok' | 'no_cost' | 'no_value' | 'cost_unknown';
}

export function roi({ value, cost, costKnown = true }: RoiInput): RoiResult {
  if (!costKnown) return { netValue: null, roiPct: null, roiMultiple: null, note: 'cost_unknown' };
  if (!Number.isFinite(cost) || cost <= 0) {
    // Value with no cost is not "infinite ROI" — report net value only.
    return {
      netValue: Number.isFinite(value) ? value : null,
      roiPct: null,
      roiMultiple: null,
      note: 'no_cost',
    };
  }
  if (!Number.isFinite(value)) return { netValue: null, roiPct: null, roiMultiple: null, note: 'no_value' };
  const net = value - cost;
  return { netValue: net, roiPct: (net / cost) * 100, roiMultiple: value / cost, note: 'ok' };
}

export function valuePerMillionTokens(value: number, tokens: number): number | null {
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  return value / (tokens / 1_000_000);
}

export function revenueToCostRatio(value: number, cost: number): number | null {
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return value / cost;
}

/** Break-even value = the cost. Returns how much more value is needed. */
export function breakEven(value: number, cost: number): {
  passed: boolean;
  requiredValue: number;
  remaining: number;
} {
  const required = Math.max(0, cost);
  return { passed: value >= required && required > 0, requiredValue: required, remaining: Math.max(0, required - value) };
}

/**
 * Expand a recurring value event into per-month occurrences within [from, to].
 * A monthly $500 subscription entered once therefore contributes correctly to
 * each period rather than being counted once at its start date.
 */
export function expandValueEvent(ev: ValueEventLike, from: Date, to: Date): Array<{ date: Date; amount: number }> {
  const start = new Date(ev.date);
  if (Number.isNaN(start.getTime())) return [];
  if (!ev.recurring) {
    return start >= from && start <= to ? [{ date: start, amount: ev.amount }] : [];
  }
  const stepMonths =
    ev.recurrencePeriod === 'yearly' ? 12 : ev.recurrencePeriod === 'quarterly' ? 3 : ev.recurrencePeriod === 'weekly' ? 0 : 1;
  const end = ev.recurrenceEnd ? new Date(ev.recurrenceEnd) : to;
  const hardEnd = end < to ? end : to;
  const out: Array<{ date: Date; amount: number }> = [];
  const cursor = new Date(start);
  let guard = 0;
  while (cursor <= hardEnd && guard++ < 2000) {
    if (cursor >= from) out.push({ date: new Date(cursor), amount: ev.amount });
    if (stepMonths === 0) cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + stepMonths);
  }
  return out;
}

export interface CumulativePoint {
  date: string;
  cost: number;
  value: number;
  cumCost: number;
  cumValue: number;
}

/** Cumulative cost vs value, plus the first date value overtakes cost. */
export function cumulative(
  series: Array<{ date: string; cost: number; value: number }>,
): { points: CumulativePoint[]; breakEvenDate: string | null } {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  let cumCost = 0;
  let cumValue = 0;
  let breakEvenDate: string | null = null;
  const points = sorted.map((s) => {
    cumCost += s.cost;
    cumValue += s.value;
    if (!breakEvenDate && cumCost > 0 && cumValue >= cumCost) breakEvenDate = s.date;
    return { ...s, cumCost, cumValue };
  });
  return { points, breakEvenDate };
}

/** Payback period in days: days from first cost until cumulative break-even. */
export function paybackDays(points: CumulativePoint[]): number | null {
  const first = points.find((p) => p.cumCost > 0);
  const be = points.find((p) => p.cumCost > 0 && p.cumValue >= p.cumCost);
  if (!first || !be) return null;
  const d = (Date.parse(be.date) - Date.parse(first.date)) / 86_400_000;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
}

/**
 * Choose the cost figure for the selected basis.
 *
 *  - api_equivalent: what this usage would have cost at list API prices.
 *  - allocated_cash: the share of real subscription spend attributed here.
 *  - blended:        real cash actually paid, PLUS the API-price of the usage
 *                    that no subscription covered. This is the honest
 *                    out-of-pocket-equivalent: it neither ignores the money
 *                    actually spent nor treats uncovered usage as free.
 *
 * @param uncoveredApiCost API-equivalent cost of usage not covered by any
 *        subscription (e.g. pay-as-you-go keys). Defaults to 0.
 */
export function costForBasis(
  basis: CostBasis,
  apiCost: number,
  cashCost: number,
  uncoveredApiCost = 0,
): number {
  if (basis === 'api_equivalent') return apiCost;
  if (basis === 'allocated_cash') return cashCost;
  // blended
  if (cashCost <= 0) return apiCost;
  return cashCost + Math.max(0, uncoveredApiCost);
}

/** Data completeness: share of token volume that could be priced. */
export function pricingCoverage(pricedTokens: number, totalTokens: number): number {
  if (totalTokens <= 0) return 1;
  return Math.min(1, pricedTokens / totalTokens);
}
