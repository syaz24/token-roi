import { dataBounds, type Dataset, type Filters } from './queries';
import { getSetting } from './settings';
import type { CostBasis } from './roi/compute';

export type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const RANGE_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};

export function resolveFilters(sp: SearchParams): Filters & { range: string } {
  const dataset = ((getSetting('dataset') ?? 'real') as Dataset) satisfies Dataset;
  const range = one(sp.range) ?? getSetting('general.defaultRange') ?? '30d';
  const basisRaw = one(sp.basis) ?? getSetting('costBasis') ?? 'api_equivalent';
  const basis = (['api_equivalent', 'allocated_cash', 'blended'].includes(basisRaw)
    ? basisRaw
    : 'api_equivalent') as CostBasis;

  let from: string;
  let to = new Date().toISOString();

  if (range === 'all') {
    const b = dataBounds(dataset);
    from = b.lo ?? new Date(Date.now() - 365 * 86_400_000).toISOString();
    to = b.hi && b.hi > to ? b.hi : to;
  } else {
    const days = RANGE_DAYS[range] ?? 30;
    from = new Date(Date.now() - days * 86_400_000).toISOString();
  }

  return { dataset, from, to, basis, projectId: one(sp.project), range };
}

export function qs(sp: SearchParams, extra: Record<string, string | null> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = one(v);
    if (val) p.set(k, val);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const num = (v: string | string[] | undefined): number | null => {
  const s = one(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export const str = one;
