/**
 * Subscription cost allocation.
 *
 * A subscription is a fixed cash cost for a billing period. It is spread across
 * projects using an explicit, user-chosen method. The engine never pretends the
 * whole plan price belongs to one project unless that is literally what the
 * user configured (method 'direct').
 *
 * Any share of the period cost that cannot be attributed (e.g. tokens produced
 * by unassigned sessions, or manual percentages summing below 100) is returned
 * as `unallocated` rather than being quietly redistributed.
 */

export type AllocationMethod =
  | 'token_share'
  | 'session_share'
  | 'active_day_share'
  | 'equal'
  | 'manual_pct'
  | 'direct';

export interface ProjectUsage {
  projectId: string;
  tokens: number;
  sessions: number;
  activeDays: number;
}

export interface AllocationConfig {
  /** manual_pct: projectId -> percentage (0-100). */
  percentages?: Record<string, number>;
  /** direct: the single project that carries the whole cost. */
  projectId?: string;
}

export interface AllocationResult {
  byProject: Record<string, number>;
  unallocated: number;
  /** How much of the driver metric was attributable to a known project. */
  confidence: number;
  warnings: string[];
}

/**
 * @param periodCost Cash cost of the billing period, tax/discount/seats applied.
 * @param usage      Per-project usage within the same period.
 * @param unassigned Driver totals that belong to no project (drives `unallocated`).
 */
export function allocate(
  periodCost: number,
  method: AllocationMethod,
  usage: ProjectUsage[],
  config: AllocationConfig = {},
  unassigned: { tokens: number; sessions: number; activeDays: number } = {
    tokens: 0,
    sessions: 0,
    activeDays: 0,
  },
): AllocationResult {
  const byProject: Record<string, number> = {};
  const warnings: string[] = [];
  if (!Number.isFinite(periodCost) || periodCost <= 0) {
    return { byProject, unallocated: 0, confidence: 1, warnings };
  }

  if (method === 'direct') {
    const id = config.projectId;
    if (!id) {
      warnings.push('Direct allocation has no project selected; full cost left unallocated.');
      return { byProject, unallocated: periodCost, confidence: 0, warnings };
    }
    byProject[id] = periodCost;
    return { byProject, unallocated: 0, confidence: 1, warnings };
  }

  if (method === 'manual_pct') {
    const pct = config.percentages ?? {};
    let sum = 0;
    for (const [id, v] of Object.entries(pct)) {
      const clean = Number.isFinite(v) ? Math.max(0, v) : 0;
      sum += clean;
      byProject[id] = (byProject[id] ?? 0) + (periodCost * clean) / 100;
    }
    if (sum > 100.0001) {
      // Scale back rather than billing more than was actually paid.
      const scale = 100 / sum;
      for (const id of Object.keys(byProject)) byProject[id] *= scale;
      warnings.push(`Manual percentages total ${sum.toFixed(1)}%; scaled down to 100%.`);
      return { byProject, unallocated: 0, confidence: 1, warnings };
    }
    const unallocated = periodCost * ((100 - sum) / 100);
    if (unallocated > 0.0001) warnings.push(`${(100 - sum).toFixed(1)}% of this plan is unallocated.`);
    return { byProject, unallocated, confidence: sum / 100, warnings };
  }

  if (method === 'equal') {
    const ids = usage.map((u) => u.projectId);
    if (!ids.length) return { byProject, unallocated: periodCost, confidence: 0, warnings };
    const each = periodCost / ids.length;
    for (const id of ids) byProject[id] = each;
    return { byProject, unallocated: 0, confidence: 1, warnings };
  }

  const driver = (u: { tokens: number; sessions: number; activeDays: number }) =>
    method === 'token_share' ? u.tokens : method === 'session_share' ? u.sessions : u.activeDays;

  const assigned = usage.reduce((s, u) => s + Math.max(0, driver(u)), 0);
  const outside = Math.max(0, driver(unassigned));
  const denom = assigned + outside;

  if (denom <= 0) {
    warnings.push('No usage recorded in this period; the full plan cost is unallocated.');
    return { byProject, unallocated: periodCost, confidence: 0, warnings };
  }
  for (const u of usage) {
    const d = Math.max(0, driver(u));
    if (d > 0) byProject[u.projectId] = (periodCost * d) / denom;
  }
  const unallocated = (periodCost * outside) / denom;
  if (unallocated > 0.0001) {
    warnings.push('Part of this plan maps to unassigned sessions and is left unallocated.');
  }
  return { byProject, unallocated, confidence: assigned / denom, warnings };
}

export type BillingCycle = 'monthly' | 'quarterly' | 'annual' | 'one_time';

/**
 * Effective cash cost attributable to ONE month of a subscription, in USD.
 *
 * Recurring plans spread their price across the months they cover, so an annual
 * plan contributes a twelfth per month. A one-time purchase (a credit top-up,
 * say) is not spread: its full amount lands in the single month it was bought,
 * and `allocatedCash` is responsible for charging it only in that month.
 */
export function monthlyCashCost(sub: {
  monthlyPrice: number;
  seats: number;
  taxPct: number;
  discountPct: number;
  billingCycle: string;
}): number {
  const base = sub.monthlyPrice * Math.max(1, sub.seats || 1);
  const perMonth =
    sub.billingCycle === 'annual'
      ? base / 12
      : sub.billingCycle === 'quarterly'
        ? base / 3
        : base; // 'monthly' and 'one_time' both charge the full amount
  const afterDiscount = perMonth * (1 - (sub.discountPct || 0) / 100);
  return afterDiscount * (1 + (sub.taxPct || 0) / 100);
}

/** Whether a plan contributes cost in the given YYYY-MM month. */
export function chargesInMonth(
  sub: { billingCycle: string; billingStart: string; billingEnd?: string | null },
  month: string,
): boolean {
  const start = sub.billingStart.slice(0, 7);
  if (month < start) return false;
  // A one-time purchase is charged once, in the month it was made.
  if (sub.billingCycle === 'one_time') return month === start;
  if (sub.billingEnd && month > sub.billingEnd.slice(0, 7)) return false;
  return true;
}
