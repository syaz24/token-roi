import { raw } from '@/db/client';
import {
  allocate,
  chargesInMonth,
  lifetimeCashCost,
  monthlyCashCost,
  type AllocationMethod,
} from './roi/allocation';
import {
  breakEven,
  costForBasis,
  cumulative,
  expandValueEvent,
  paybackDays,
  roi,
  valuePerMillionTokens,
  type CostBasis,
} from './roi/compute';
import { scoreProject, type ScoreResult } from './roi/recommend';

export type Dataset = 'real' | 'sample';

export interface Filters {
  dataset: Dataset;
  from: string;
  to: string;
  projectId?: string | null;
  basis: CostBasis;
}

export function defaultRange(days = 30): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** True once any real event exists — used to auto-leave sample mode. */
export function hasRealData(): boolean {
  try {
    const r = raw().prepare(`SELECT 1 FROM events WHERE dataset='real' LIMIT 1`).get();
    return !!r;
  } catch {
    return false;
  }
}

function where(f: Filters, alias = 'e') {
  const clauses = [`${alias}.dataset = @dataset`, `${alias}.timestamp >= @from`, `${alias}.timestamp <= @to`];
  if (f.projectId) clauses.push(`${alias}.project_id = @projectId`);
  return clauses.join(' AND ');
}

function params(f: Filters) {
  return { dataset: f.dataset, from: f.from, to: f.to, projectId: f.projectId ?? null };
}

export interface Totals {
  events: number;
  sessions: number;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  apiCost: number;
  unpricedEvents: number;
  unpricedTokens: number;
  pricingCoverage: number;
}

export function totals(f: Filters): Totals {
  const r = raw()
    .prepare(
      `SELECT COUNT(*) events, COUNT(DISTINCT session_id) sessions,
              COALESCE(SUM(total_tokens),0) tokens,
              COALESCE(SUM(input_tokens),0) input,
              COALESCE(SUM(output_tokens),0) output,
              COALESCE(SUM(cache_read_tokens),0) cacheRead,
              COALESCE(SUM(cache_write_tokens),0) cacheWrite,
              COALESCE(SUM(reasoning_tokens),0) reasoning,
              COALESCE(SUM(calculated_cost_usd),0) apiCost,
              COALESCE(SUM(CASE WHEN priced=0 THEN 1 ELSE 0 END),0) unpricedEvents,
              COALESCE(SUM(CASE WHEN priced=0 THEN total_tokens ELSE 0 END),0) unpricedTokens
         FROM events e WHERE ${where(f)}`,
    )
    .get(params(f)) as any;
  const tokens = r.tokens as number;
  return {
    ...r,
    pricingCoverage: tokens > 0 ? (tokens - r.unpricedTokens) / tokens : 1,
  } as Totals;
}

/** Same window length, immediately before `from` — for period-over-period deltas. */
export function previousWindow(f: Filters): Filters {
  const span = Date.parse(f.to) - Date.parse(f.from);
  return {
    ...f,
    from: new Date(Date.parse(f.from) - span).toISOString(),
    to: f.from,
  };
}

export type Grain = 'hour' | 'day' | 'week' | 'month';

const GRAIN_SQL: Record<Grain, string> = {
  hour: `substr(timestamp,1,13)`,
  day: `substr(timestamp,1,10)`,
  week: `strftime('%Y-W%W', timestamp)`,
  month: `substr(timestamp,1,7)`,
};

export interface SeriesPoint {
  bucket: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  tokens: number;
  cost: number;
  events: number;
}

export function tokenSeries(f: Filters, grain: Grain): SeriesPoint[] {
  return raw()
    .prepare(
      `SELECT ${GRAIN_SQL[grain]} bucket,
              COALESCE(SUM(input_tokens),0) input,
              COALESCE(SUM(output_tokens),0) output,
              COALESCE(SUM(cache_read_tokens),0) cacheRead,
              COALESCE(SUM(cache_write_tokens),0) cacheWrite,
              COALESCE(SUM(reasoning_tokens),0) reasoning,
              COALESCE(SUM(total_tokens),0) tokens,
              COALESCE(SUM(calculated_cost_usd),0) cost,
              COUNT(*) events
         FROM events e WHERE ${where(f)}
        GROUP BY bucket ORDER BY bucket`,
    )
    .all(params(f)) as SeriesPoint[];
}

export interface ModelRow {
  model: string | null;
  provider: string | null;
  events: number;
  sessions: number;
  tokens: number;
  cost: number;
  priced: number;
  avgTokensPerRequest: number;
  share: number;
}

export function byModel(f: Filters): ModelRow[] {
  const rows = raw()
    .prepare(
      `SELECT model, provider, COUNT(*) events, COUNT(DISTINCT session_id) sessions,
              COALESCE(SUM(total_tokens),0) tokens,
              COALESCE(SUM(calculated_cost_usd),0) cost,
              MIN(priced) priced
         FROM events e WHERE ${where(f)}
        GROUP BY model, provider ORDER BY tokens DESC`,
    )
    .all(params(f)) as any[];
  const total = rows.reduce((s, r) => s + r.tokens, 0) || 1;
  return rows.map((r) => ({
    ...r,
    avgTokensPerRequest: r.events ? r.tokens / r.events : 0,
    share: r.tokens / total,
  }));
}

export function byProvider(f: Filters) {
  return raw()
    .prepare(
      `SELECT COALESCE(provider,'unknown') provider, COUNT(*) events,
              COALESCE(SUM(total_tokens),0) tokens,
              COALESCE(SUM(calculated_cost_usd),0) cost
         FROM events e WHERE ${where(f)}
        GROUP BY provider ORDER BY tokens DESC`,
    )
    .all(params(f)) as Array<{ provider: string; events: number; tokens: number; cost: number }>;
}

export function bySource(f: Filters) {
  return raw()
    .prepare(
      `SELECT source, COUNT(*) events, COALESCE(SUM(total_tokens),0) tokens,
              COALESCE(SUM(calculated_cost_usd),0) cost
         FROM events e WHERE ${where(f)} GROUP BY source ORDER BY tokens DESC`,
    )
    .all(params(f)) as Array<{ source: string; events: number; tokens: number; cost: number }>;
}

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  category: string | null;
  status: string;
  archived: number;
  tokens: number;
  events: number;
  sessions: number;
  apiCost: number;
  unpricedTokens: number;
}

export function projectUsage(f: Filters): ProjectRow[] {
  return raw()
    .prepare(
      `SELECT p.id, p.name, p.path, p.category, p.status, p.archived,
              COALESCE(SUM(e.total_tokens),0) tokens,
              COUNT(e.event_id) events,
              COUNT(DISTINCT e.session_id) sessions,
              COALESCE(SUM(e.calculated_cost_usd),0) apiCost,
              COALESCE(SUM(CASE WHEN e.priced=0 THEN e.total_tokens ELSE 0 END),0) unpricedTokens
         FROM projects p
         LEFT JOIN events e
           ON e.project_id = p.id AND e.dataset = @dataset
          AND e.timestamp >= @from AND e.timestamp <= @to
        WHERE p.dataset = @dataset
        GROUP BY p.id ORDER BY tokens DESC`,
    )
    .all({ dataset: f.dataset, from: f.from, to: f.to }) as ProjectRow[];
}

export function unassignedUsage(f: Filters) {
  const r = raw()
    .prepare(
      `SELECT COUNT(*) events, COUNT(DISTINCT session_id) sessions,
              COALESCE(SUM(total_tokens),0) tokens,
              COALESCE(SUM(calculated_cost_usd),0) cost
         FROM events e
        WHERE e.dataset=@dataset AND e.timestamp>=@from AND e.timestamp<=@to
          AND e.project_id IS NULL`,
    )
    .get({ dataset: f.dataset, from: f.from, to: f.to }) as any;
  return r as { events: number; sessions: number; tokens: number; cost: number };
}

export function activeDays(f: Filters, projectId?: string | null): number {
  const r = raw()
    .prepare(
      `SELECT COUNT(DISTINCT substr(timestamp,1,10)) d FROM events e
        WHERE e.dataset=@dataset AND e.timestamp>=@from AND e.timestamp<=@to
          ${projectId ? 'AND e.project_id = @pid' : ''}`,
    )
    .get({ dataset: f.dataset, from: f.from, to: f.to, pid: projectId ?? null }) as any;
  return r.d as number;
}

/* ------------------------- value ------------------------- */

export interface ValueRow {
  id: string;
  projectId: string;
  valueType: string;
  amount: number;
  date: string;
  recurring: number;
  recurrencePeriod: string | null;
  recurrenceEnd: string | null;
  realised: number;
  confidence: string;
  description: string | null;
}

export function valueEventsFor(dataset: Dataset, projectId?: string | null): ValueRow[] {
  return raw()
    .prepare(
      `SELECT id, project_id projectId, value_type valueType, amount, date, recurring,
              recurrence_period recurrencePeriod, recurrence_end recurrenceEnd,
              realised, confidence, description
         FROM value_events
        WHERE dataset = ? ${projectId ? 'AND project_id = ?' : ''}
        ORDER BY date DESC`,
    )
    .all(...(projectId ? [dataset, projectId] : [dataset])) as ValueRow[];
}

export interface ValueTotals {
  realised: number;
  estimated: number;
  total: number;
  lastUpdate: string | null;
  count: number;
}

/** Sum value in window, expanding recurring entries into occurrences. */
export function valueTotals(dataset: Dataset, projectId: string | null, from: string, to: string): ValueTotals {
  const rows = valueEventsFor(dataset, projectId);
  const f = new Date(from);
  const t = new Date(to);
  let realised = 0;
  let estimated = 0;
  let last: string | null = null;
  for (const v of rows) {
    const occ = expandValueEvent(
      {
        amount: v.amount,
        date: v.date,
        recurring: !!v.recurring,
        recurrencePeriod: v.recurrencePeriod,
        recurrenceEnd: v.recurrenceEnd,
        realised: !!v.realised,
      },
      f,
      t,
    );
    const sum = occ.reduce((s, o) => s + o.amount, 0);
    if (v.realised) realised += sum;
    else estimated += sum;
    if (occ.length && (!last || v.date > last)) last = v.date;
  }
  return { realised, estimated, total: realised + estimated, lastUpdate: last, count: rows.length };
}

/* --------------------- subscriptions --------------------- */

export interface SubRow {
  id: string;
  provider: string;
  planName: string;
  monthlyPrice: number;
  seats: number;
  taxPct: number;
  discountPct: number;
  billingCycle: string;
  billingStart: string;
  billingEnd: string | null;
  active: number;
  allocationMethod: string;
  allocationConfig: string;
  notes: string | null;
}

export function subscriptions(dataset: Dataset): SubRow[] {
  return raw()
    .prepare(
      `SELECT id, provider, plan_name planName, monthly_price monthlyPrice, seats,
              tax_pct taxPct, discount_pct discountPct, billing_cycle billingCycle,
              billing_start billingStart, billing_end billingEnd, active,
              allocation_method allocationMethod, allocation_config allocationConfig, notes
         FROM subscriptions WHERE dataset = ? ORDER BY provider, plan_name`,
    )
    .all(dataset) as SubRow[];
}

/** Months (YYYY-MM) covered by the filter window. */
function monthsIn(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from);
  d.setUTCDate(1);
  const end = new Date(to);
  let guard = 0;
  while (d <= end && guard++ < 240) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out.length ? out : [from.slice(0, 7)];
}

export interface CashAllocation {
  byProject: Record<string, number>;
  unallocated: number;
  totalCash: number;
  confidence: number;
  warnings: string[];
}

/**
 * Allocate every active subscription across projects for each month in the
 * window, using per-month usage as the driver so a project only carries cost
 * for the months it was actually worked on.
 */
export function allocatedCash(f: Filters): CashAllocation {
  const subs = subscriptions(f.dataset).filter((s) => s.active);
  const out: CashAllocation = { byProject: {}, unallocated: 0, totalCash: 0, confidence: 1, warnings: [] };
  if (!subs.length) return out;

  const months = monthsIn(f.from, f.to);
  const usageStmt = raw().prepare(
    `SELECT project_id pid, COALESCE(SUM(total_tokens),0) tokens,
            COUNT(DISTINCT session_id) sessions,
            COUNT(DISTINCT substr(timestamp,1,10)) activeDays
       FROM events
      WHERE dataset=@dataset AND substr(timestamp,1,7)=@month
      GROUP BY project_id`,
  );

  const confidences: number[] = [];
  for (const month of months) {
    const rows = usageStmt.all({ dataset: f.dataset, month }) as any[];
    const usage = rows
      .filter((r) => r.pid)
      .map((r) => ({ projectId: r.pid as string, tokens: r.tokens, sessions: r.sessions, activeDays: r.activeDays }));
    const un = rows.find((r) => !r.pid);
    const unassigned = { tokens: un?.tokens ?? 0, sessions: un?.sessions ?? 0, activeDays: un?.activeDays ?? 0 };

    for (const s of subs) {
      // Only bill months inside the plan's own billing period. One-time
      // purchases are charged solely in the month they were made.
      if (!chargesInMonth(s, month)) continue;

      const cost = monthlyCashCost(s);
      out.totalCash += cost;
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(s.allocationConfig || '{}');
      } catch {
        out.warnings.push(`${s.provider} ${s.planName}: invalid allocation config.`);
      }
      const res = allocate(cost, s.allocationMethod as AllocationMethod, usage, config as any, unassigned);
      for (const [pid, amt] of Object.entries(res.byProject)) {
        out.byProject[pid] = (out.byProject[pid] ?? 0) + amt;
      }
      out.unallocated += res.unallocated;
      confidences.push(res.confidence);
      for (const w of res.warnings) if (!out.warnings.includes(w)) out.warnings.push(w);
    }
  }
  out.confidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 1;
  return out;
}

/* ------------------------- ROI --------------------------- */

export interface ProjectRoi extends ProjectRow {
  cashCost: number;
  cost: number;
  value: number;
  realisedValue: number;
  estimatedValue: number;
  netValue: number | null;
  roiPct: number | null;
  roiMultiple: number | null;
  roiNote: string;
  valuePerMTok: number | null;
  breakEvenPassed: boolean;
  breakEvenRemaining: number;
  pricingCoverage: number;
  realisedShare: number;
  savingsVsApi: number;
  effectiveCostPerMTok: number | null;
  recommendation: ScoreResult;
}

export function projectRoiTable(f: Filters): ProjectRoi[] {
  const rows = projectUsage(f);
  const cash = allocatedCash(f);
  const prev = previousWindow(f);
  const prevRows = new Map(projectUsage(prev).map((r) => [r.id, r]));
  const prevCash = allocatedCash(prev);

  return rows.map((p) => {
    const cashCost = cash.byProject[p.id] ?? 0;
    const cost = costForBasis(f.basis, p.apiCost, cashCost);
    const v = valueTotals(f.dataset, p.id, f.from, f.to);
    // "No value has been recorded" is not the same statement as "this project
    // returned nothing". Reporting -100% for an un-measured project would be
    // fake precision, so ROI stays null until some value exists.
    const r =
      v.count === 0
        ? { netValue: null, roiPct: null, roiMultiple: null, note: 'no_value' as const }
        : roi({ value: v.total, cost });
    const coverage = p.tokens > 0 ? (p.tokens - p.unpricedTokens) / p.tokens : 1;
    const realisedShare = v.total > 0 ? v.realised / v.total : 0;

    const prevP = prevRows.get(p.id);
    const prevCost = prevP ? costForBasis(f.basis, prevP.apiCost, prevCash.byProject[p.id] ?? 0) : 0;
    const prevV = valueTotals(f.dataset, p.id, prev.from, prev.to);

    const be = breakEven(v.total, cost);
    const daysSince = v.lastUpdate
      ? Math.round((Date.now() - Date.parse(v.lastUpdate)) / 86_400_000)
      : null;

    const recommendation = scoreProject({
      roiPct: r.roiPct,
      netValue: r.netValue,
      recentValueGrowth: prevV.total > 0 ? v.total / prevV.total : v.total > 0 ? 2 : null,
      costTrend: prevCost > 0 ? cost / prevCost : null,
      valuePerMTok: valuePerMillionTokens(v.total, p.tokens),
      pricingCoverage: coverage,
      realisedShare,
      daysSinceValueUpdate: daysSince,
      totalTokens: p.tokens,
      hasValueData: v.count > 0,
    });

    return {
      ...p,
      cashCost,
      cost,
      value: v.total,
      realisedValue: v.realised,
      estimatedValue: v.estimated,
      netValue: r.netValue,
      roiPct: r.roiPct,
      roiMultiple: r.roiMultiple,
      roiNote: r.note,
      valuePerMTok: valuePerMillionTokens(v.total, p.tokens),
      breakEvenPassed: be.passed,
      breakEvenRemaining: be.remaining,
      pricingCoverage: coverage,
      realisedShare,
      savingsVsApi: p.apiCost - cashCost,
      effectiveCostPerMTok: p.tokens > 0 ? cost / (p.tokens / 1_000_000) : null,
      recommendation,
    };
  });
}

/** Cumulative cost vs value by day, plus break-even date and payback. */
export function cumulativeSeries(f: Filters) {
  const costRows = raw()
    .prepare(
      `SELECT substr(timestamp,1,10) date, COALESCE(SUM(calculated_cost_usd),0) cost
         FROM events e WHERE ${where(f)} GROUP BY date ORDER BY date`,
    )
    .all(params(f)) as Array<{ date: string; cost: number }>;

  const vRows = valueEventsFor(f.dataset, f.projectId ?? null);
  const valueByDay = new Map<string, number>();
  for (const v of vRows) {
    for (const occ of expandValueEvent(
      {
        amount: v.amount,
        date: v.date,
        recurring: !!v.recurring,
        recurrencePeriod: v.recurrencePeriod,
        recurrenceEnd: v.recurrenceEnd,
        realised: !!v.realised,
      },
      new Date(f.from),
      new Date(f.to),
    )) {
      const k = occ.date.toISOString().slice(0, 10);
      valueByDay.set(k, (valueByDay.get(k) ?? 0) + occ.amount);
    }
  }
  const days = new Set<string>([...costRows.map((c) => c.date), ...valueByDay.keys()]);
  const merged = [...days].sort().map((date) => ({
    date,
    cost: costRows.find((c) => c.date === date)?.cost ?? 0,
    value: valueByDay.get(date) ?? 0,
  }));
  const { points, breakEvenDate } = cumulative(merged);
  return { points, breakEvenDate, payback: paybackDays(points) };
}

/* ----------------------- sessions ------------------------ */

export interface SessionFilters extends Filters {
  source?: string | null;
  provider?: string | null;
  model?: string | null;
  status?: string | null;
  minTokens?: number | null;
  minCost?: number | null;
  assigned?: 'all' | 'assigned' | 'unassigned';
  pricedOnly?: 'all' | 'priced' | 'unpriced';
  search?: string | null;
  limit?: number;
  cursor?: string | null;
}

export interface EventRow {
  eventId: string;
  timestamp: string;
  projectId: string | null;
  projectName: string | null;
  source: string;
  provider: string | null;
  model: string | null;
  totalTokens: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  calculatedCostUsd: number | null;
  priced: number;
  durationMs: number | null;
  status: string;
  sessionId: string;
  promptPreview: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  mappingMethod: string | null;
  metadata: string | null;
  pricingId: string | null;
  workingDirectory: string | null;
}

/** Cursor-paginated event listing. Cursor is "<timestamp>|<eventId>". */
export function listEvents(f: SessionFilters): { rows: EventRow[]; nextCursor: string | null } {
  const limit = Math.min(500, f.limit ?? 100);
  const clauses = [`e.dataset = @dataset`, `e.timestamp >= @from`, `e.timestamp <= @to`];
  const p: Record<string, unknown> = params(f);

  if (f.projectId) clauses.push(`e.project_id = @projectId`);
  if (f.source) {
    clauses.push(`e.source = @source`);
    p.source = f.source;
  }
  if (f.provider) {
    clauses.push(`e.provider = @provider`);
    p.provider = f.provider;
  }
  if (f.model) {
    clauses.push(`e.model = @model`);
    p.model = f.model;
  }
  if (f.status) {
    clauses.push(`e.status = @status`);
    p.status = f.status;
  }
  if (f.minTokens) {
    clauses.push(`e.total_tokens >= @minTokens`);
    p.minTokens = f.minTokens;
  }
  if (f.minCost) {
    clauses.push(`COALESCE(e.calculated_cost_usd,0) >= @minCost`);
    p.minCost = f.minCost;
  }
  if (f.assigned === 'assigned') clauses.push(`e.project_id IS NOT NULL`);
  if (f.assigned === 'unassigned') clauses.push(`e.project_id IS NULL`);
  if (f.pricedOnly === 'priced') clauses.push(`e.priced = 1`);
  if (f.pricedOnly === 'unpriced') clauses.push(`e.priced = 0`);
  if (f.search) {
    clauses.push(
      `(e.session_id LIKE @q OR e.model LIKE @q OR e.prompt_preview LIKE @q OR e.source_file LIKE @q OR e.status LIKE @q OR p.name LIKE @q)`,
    );
    p.q = `%${f.search}%`;
  }
  if (f.cursor) {
    const [ts, id] = f.cursor.split('|');
    clauses.push(`(e.timestamp < @curTs OR (e.timestamp = @curTs AND e.event_id < @curId))`);
    p.curTs = ts;
    p.curId = id;
  }

  const rows = raw()
    .prepare(
      `SELECT e.event_id eventId, e.timestamp, e.project_id projectId, p.name projectName,
              e.source, e.provider, e.model, e.total_tokens totalTokens,
              e.input_tokens inputTokens, e.output_tokens outputTokens,
              e.cache_read_tokens cacheReadTokens, e.cache_write_tokens cacheWriteTokens,
              e.reasoning_tokens reasoningTokens, e.calculated_cost_usd calculatedCostUsd,
              e.priced, e.duration_ms durationMs, e.status, e.session_id sessionId,
              e.prompt_preview promptPreview, e.source_file sourceFile, e.source_line sourceLine,
              e.mapping_method mappingMethod, e.metadata, e.pricing_id pricingId,
              e.working_directory workingDirectory
         FROM events e LEFT JOIN projects p ON p.id = e.project_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY e.timestamp DESC, e.event_id DESC
        LIMIT @limit`,
    )
    .all({ ...p, limit: limit + 1 }) as EventRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { rows: page, nextCursor: hasMore && last ? `${last.timestamp}|${last.eventId}` : null };
}

export function distinctValues(dataset: Dataset) {
  const d = raw();
  const col = (c: string) =>
    (d.prepare(`SELECT DISTINCT ${c} v FROM events WHERE dataset=? AND ${c} IS NOT NULL ORDER BY v`).all(dataset) as any[])
      .map((r) => String(r.v));
  return { sources: col('source'), providers: col('provider'), models: col('model'), statuses: col('status') };
}

/** Sessions with no project, for the Unassigned workflow. */
export function unassignedSessions(dataset: Dataset, limit = 200) {
  return raw()
    .prepare(
      `SELECT session_id sessionId, working_directory workingDirectory, source,
              COUNT(*) events, COALESCE(SUM(total_tokens),0) tokens,
              COALESCE(SUM(calculated_cost_usd),0) cost,
              MIN(timestamp) firstSeen, MAX(timestamp) lastSeen
         FROM events WHERE dataset=? AND project_id IS NULL
        GROUP BY session_id, working_directory, source
        ORDER BY tokens DESC LIMIT ?`,
    )
    .all(dataset, limit) as Array<{
    sessionId: string;
    workingDirectory: string | null;
    source: string;
    events: number;
    tokens: number;
    cost: number;
    firstSeen: string;
    lastSeen: string;
  }>;
}

export interface SubscriptionSpend {
  id: string;
  months: number;
  total: number;
}

/**
 * Running total each plan has cost since its billing start.
 *
 * Independent of the dashboard's date range: a plan billed from an earlier date
 * has been costing money all along, and that total does not change because you
 * are currently looking at the last 30 days.
 */
export function subscriptionSpendToDate(dataset: Dataset): {
  perSub: Record<string, SubscriptionSpend>;
  total: number;
  activeMonthly: number;
} {
  const subs = subscriptions(dataset);
  const perSub: Record<string, SubscriptionSpend> = {};
  let total = 0;
  let activeMonthly = 0;

  for (const s of subs) {
    const life = lifetimeCashCost(s);
    perSub[s.id] = { id: s.id, months: life.months, total: life.total };
    total += life.total;
    if (s.active && s.billingCycle !== 'one_time') activeMonthly += monthlyCashCost(s);
  }
  return { perSub, total, activeMonthly };
}

/* ------------------ conversation-level views ------------------ */

export interface SessionRow {
  sessionId: string;
  projectId: string | null;
  projectName: string | null;
  source: string;
  model: string | null;
  /** The prompt that opened the conversation, when the source exposes one. */
  firstPrompt: string | null;
  requests: number;
  turns: number;
  toolUses: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number | null;
  startedAt: string;
  endedAt: string;
}

/**
 * One row per conversation rather than per request.
 *
 * `turns` counts is_turn_start rather than rows, so a long tool loop inside a
 * single turn is not mistaken for many turns. Sources that do not expose turns
 * report 0, which the UI renders as "—" instead of implying zero activity.
 */
export function listSessions(f: SessionFilters): { rows: SessionRow[]; nextCursor: string | null } {
  const limit = Math.min(500, f.limit ?? 60);
  const clauses = [`e.dataset = @dataset`, `e.timestamp >= @from`, `e.timestamp <= @to`];
  const p: Record<string, unknown> = params(f);

  if (f.projectId) clauses.push(`e.project_id = @projectId`);
  if (f.source) {
    clauses.push(`e.source = @source`);
    p.source = f.source;
  }
  if (f.model) {
    clauses.push(`e.model = @model`);
    p.model = f.model;
  }
  if (f.assigned === 'assigned') clauses.push(`e.project_id IS NOT NULL`);
  if (f.assigned === 'unassigned') clauses.push(`e.project_id IS NULL`);
  if (f.search) {
    clauses.push(
      `(e.session_id LIKE @q OR e.model LIKE @q OR e.prompt_preview LIKE @q OR p.name LIKE @q)`,
    );
    p.q = `%${f.search}%`;
  }

  const rows = raw()
    .prepare(
      `SELECT e.session_id sessionId,
              MAX(e.project_id) projectId,
              MAX(p.name) projectName,
              MAX(e.source) source,
              MAX(e.model) model,
              COUNT(*) requests,
              COALESCE(SUM(e.is_turn_start),0) turns,
              COALESCE(SUM(e.tool_uses),0) toolUses,
              COALESCE(SUM(e.total_tokens),0) tokens,
              COALESCE(SUM(e.input_tokens),0) inputTokens,
              COALESCE(SUM(e.output_tokens),0) outputTokens,
              COALESCE(SUM(e.cache_read_tokens),0) cacheReadTokens,
              COALESCE(SUM(e.cache_write_tokens),0) cacheWriteTokens,
              SUM(e.calculated_cost_usd) cost,
              MIN(e.timestamp) startedAt,
              MAX(e.timestamp) endedAt,
              (SELECT e2.prompt_preview FROM events e2
                WHERE e2.session_id = e.session_id AND e2.prompt_preview IS NOT NULL
                ORDER BY e2.timestamp LIMIT 1) firstPrompt
         FROM events e LEFT JOIN projects p ON p.id = e.project_id
        WHERE ${clauses.join(' AND ')}
        GROUP BY e.session_id
        ORDER BY tokens DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({ ...p, limit: limit + 1, offset: Number(f.cursor ?? 0) }) as SessionRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { rows: page, nextCursor: hasMore ? String(Number(f.cursor ?? 0) + limit) : null };
}

export interface TurnRow {
  turnIndex: number;
  prompt: string | null;
  tokens: number;
  cost: number | null;
  requests: number;
  toolUses: number;
  timestamp: string;
}

/** Per-turn cost curve for one conversation, used by the session detail view. */
export function sessionTurns(dataset: Dataset, sessionId: string): TurnRow[] {
  return raw()
    .prepare(
      `SELECT COALESCE(turn_index, 0) turnIndex,
              MAX(prompt_preview) prompt,
              COALESCE(SUM(total_tokens),0) tokens,
              SUM(calculated_cost_usd) cost,
              COUNT(*) requests,
              COALESCE(SUM(tool_uses),0) toolUses,
              MIN(timestamp) timestamp
         FROM events
        WHERE dataset = ? AND session_id = ?
        GROUP BY turn_index
        ORDER BY turnIndex`,
    )
    .all(dataset, sessionId) as TurnRow[];
}

export function sessionMeta(dataset: Dataset, sessionId: string): SessionRow | null {
  const r = raw()
    .prepare(
      `SELECT e.session_id sessionId, MAX(e.project_id) projectId, MAX(p.name) projectName,
              MAX(e.source) source, MAX(e.model) model, COUNT(*) requests,
              COALESCE(SUM(e.is_turn_start),0) turns, COALESCE(SUM(e.tool_uses),0) toolUses,
              COALESCE(SUM(e.total_tokens),0) tokens,
              COALESCE(SUM(e.input_tokens),0) inputTokens,
              COALESCE(SUM(e.output_tokens),0) outputTokens,
              COALESCE(SUM(e.cache_read_tokens),0) cacheReadTokens,
              COALESCE(SUM(e.cache_write_tokens),0) cacheWriteTokens,
              SUM(e.calculated_cost_usd) cost,
              MIN(e.timestamp) startedAt, MAX(e.timestamp) endedAt,
              (SELECT e2.prompt_preview FROM events e2
                WHERE e2.session_id = e.session_id AND e2.prompt_preview IS NOT NULL
                ORDER BY e2.timestamp LIMIT 1) firstPrompt
         FROM events e LEFT JOIN projects p ON p.id = e.project_id
        WHERE e.dataset = ? AND e.session_id = ?
        GROUP BY e.session_id`,
    )
    .get(dataset, sessionId) as SessionRow | undefined;
  return r ?? null;
}

/** Headline figures for the shareable stats card. */
export function shareStats(f: Filters) {
  const t = totals(f);
  const cacheable = t.cacheRead + t.input;
  return {
    tokens: t.tokens,
    sessions: t.sessions,
    requests: t.events,
    apiCost: t.apiCost,
    cacheHitRate: cacheable > 0 ? t.cacheRead / cacheable : 0,
    from: f.from,
    to: f.to,
  };
}

export function dataBounds(dataset: Dataset) {
  const r = raw()
    .prepare(`SELECT MIN(timestamp) lo, MAX(timestamp) hi, COUNT(*) n FROM events WHERE dataset=?`)
    .get(dataset) as any;
  return r as { lo: string | null; hi: string | null; n: number };
}
