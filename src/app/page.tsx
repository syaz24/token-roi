import Link from 'next/link';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { Badge, Empty, MetricCard, Panel, SegmentBar, Tip, SERIES_PALETTE } from '@/components/ui';
import { CostBarsChart, CostValueScatter, CumulativeChart, TokenVolumeChart } from '@/components/charts';
import { GrainTabs } from '@/components/grain-tabs';
import { RecentSessions } from '@/components/recent-sessions';
import { resolveFilters, str, type SearchParams } from '@/lib/params';
import {
  allocatedCash,
  byModel,
  cumulativeSeries,
  listEvents,
  previousWindow,
  projectRoiTable,
  tokenSeries,
  totals,
  unassignedUsage,
  valueTotals,
  type Grain,
} from '@/lib/queries';
import { compactNumber, deltaPct, fullNumber, money, multiple, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = resolveFilters(sp);
  const grain = (str(sp.grain) ?? 'day') as Grain;

  const t = totals(f);
  const prevF = previousWindow(f);
  const prev = totals(prevF);

  const series = tokenSeries(f, grain);
  const daily = tokenSeries(f, 'day');
  const cash = allocatedCash(f);
  const prevCash = allocatedCash(prevF);
  const value = valueTotals(f.dataset, f.projectId ?? null, f.from, f.to);
  const prevValue = valueTotals(f.dataset, f.projectId ?? null, prevF.from, prevF.to);

  const projects = projectRoiTable(f);
  const models = byModel(f);
  const unassigned = unassignedUsage(f);
  const cum = cumulativeSeries(f);
  const recent = listEvents({ ...f, limit: 12 });

  const cost =
    f.basis === 'api_equivalent' ? t.apiCost : f.basis === 'allocated_cash' ? cash.totalCash : cash.totalCash || t.apiCost;
  const prevCost =
    f.basis === 'api_equivalent' ? prev.apiCost : f.basis === 'allocated_cash' ? prevCash.totalCash : prevCash.totalCash || prev.apiCost;

  // ROI is only meaningful once some value has been recorded. Showing -100%
  // for a portfolio that simply has no value entries yet would be fake
  // precision, so those figures stay null until there is something to divide.
  const hasValue = value.count > 0;
  const netValue = hasValue ? value.total - cost : null;
  const roiPct = hasValue && cost > 0 ? ((value.total - cost) / cost) * 100 : null;
  const roiMult = hasValue && cost > 0 ? value.total / cost : null;
  const prevRoi = prevValue.count > 0 && prevCost > 0 ? ((prevValue.total - prevCost) / prevCost) * 100 : null;

  const basisLabel =
    f.basis === 'api_equivalent' ? 'API Equivalent' : f.basis === 'allocated_cash' ? 'Allocated Cash' : 'Blended';

  // Monthly API vs cash comparison.
  const monthly = tokenSeries(f, 'month');
  const monthCash = monthlyCashByBucket(cash.totalCash, monthly.length);
  const apiVsCash = monthly.map((m, i) => ({ bucket: m.bucket, api: m.cost, cash: monthCash[i] ?? 0 }));

  const scatter = projects
    .filter((p) => p.tokens > 0 || p.value > 0)
    .map((p) => ({ name: p.name, cost: p.cost, value: p.value, tokens: p.tokens }));

  const topModelCost = Math.max(...models.map((m) => m.cost), 1);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`AI development investment and return across ${f.projectId ? 'the selected project' : 'your portfolio'}. Cost basis: ${basisLabel}.`}
        right={
          <>
            {t.unpricedTokens > 0 && (
              <Badge tone="warn">
                <AlertTriangle size={9} />
                {compactNumber(t.unpricedTokens)} unpriced tokens
              </Badge>
            )}
            {unassigned.events > 0 && (
              <Link href="/projects#unassigned">
                <Badge tone="info">{compactNumber(unassigned.tokens)} tokens unassigned</Badge>
              </Link>
            )}
          </>
        }
      />

      {t.events === 0 ? (
        <Panel>
          <Empty
            title="No indexed token events in this range."
            hint="Verified local sources are indexed automatically, so this usually means no supported AI history was found on this machine, or the date range excludes it. Check the Data Sources page to see what was detected."
            action={
              <Link href="/sources" className="mt-2 text-[11.5px] text-roi hover:underline">
                Go to Data Sources →
              </Link>
            }
          />
        </Panel>
      ) : (
        <>
          {/* ---- metric row ---- */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Total Tokens"
              value={compactNumber(t.tokens)}
              exact={`${fullNumber(t.tokens)} tokens`}
              delta={deltaPct(t.tokens, prev.tokens)}
              spark={daily.map((d) => d.tokens)}
              tooltip="Sum of input, output, cache read/write and reasoning tokens for every indexed event in range."
              footnote={`${compactNumber(t.events)} requests · ${compactNumber(t.sessions)} sessions`}
            />
            <MetricCard
              label="API-Equivalent Cost"
              value={money(t.apiCost)}
              delta={deltaPct(t.apiCost, prev.apiCost)}
              invertDelta
              spark={daily.map((d) => d.cost)}
              tooltip="What this usage would have cost at list API prices, using the pricing effective on each event's date."
              warning={
                t.pricingCoverage < 0.999
                  ? `${(t.pricingCoverage * 100).toFixed(1)}% of tokens priced`
                  : undefined
              }
              footnote={t.pricingCoverage >= 0.999 ? 'All tokens priced' : undefined}
            />
            <MetricCard
              label="Allocated Subscription Cost"
              value={money(cash.totalCash)}
              delta={deltaPct(cash.totalCash, prevCash.totalCash)}
              invertDelta
              tooltip="Real subscription spend for the billing months in range, allocated across projects by the method you configured."
              warning={cash.unallocated > 0.01 ? `${money(cash.unallocated)} unallocated` : undefined}
              footnote={cash.totalCash === 0 ? 'No subscriptions configured' : `Confidence ${(cash.confidence * 100).toFixed(0)}%`}
            />
            <MetricCard
              label="Project Value"
              value={money(value.total)}
              delta={deltaPct(value.total, prevValue.total)}
              tone="pos"
              tooltip="Value you recorded for this period. Realised and estimated value are tracked separately."
              footnote={`${money(value.realised)} realised · ${money(value.estimated)} estimated`}
            />
            <MetricCard
              label="Net ROI"
              value={roiPct == null ? '—' : pct(roiPct, 0)}
              delta={roiPct != null && prevRoi != null ? roiPct - prevRoi : null}
              tone={roiPct == null ? 'neutral' : roiPct >= 0 ? 'pos' : 'neg'}
              tooltip="((Project Value − AI Cost) ÷ AI Cost) × 100, on the selected cost basis. Shown only when a cost is known."
              footnote={
                !hasValue
                  ? 'No project value recorded yet'
                  : roiPct == null
                    ? 'No cost recorded on this basis'
                    : `Net ${money(netValue)}`
              }
            />
            <MetricCard
              label="ROI Multiple"
              value={multiple(roiMult)}
              tone={roiMult == null ? 'neutral' : roiMult >= 1 ? 'pos' : 'neg'}
              tooltip="Project Value ÷ AI Cost. A multiple below 1.0× means the project has not yet returned its AI cost."
              footnote={
                value.count === 0
                  ? 'No value recorded yet'
                  : roiMult != null && roiMult >= 1
                    ? 'Past break-even'
                    : 'Below break-even'
              }
            />
          </div>

          {/* ---- A + B ---- */}
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-3">
            <Panel
              title="Token Volume"
              subtitle="Input, output, cache and reasoning tokens over time"
              className="xl:col-span-2"
              right={<GrainTabs current={grain} />}
              bodyClassName="p-2"
            >
              <TokenVolumeChart data={series} />
            </Panel>

            <Panel title="Model Usage Distribution" subtitle={`${models.length} models in range`} bodyClassName="p-0">
              <ul className="divide-y divide-hair">
                {models.slice(0, 7).map((m, i) => (
                  <li key={`${m.model}-${i}`} className="px-3.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono flex min-w-0 items-center gap-1.5 truncate text-[11px] text-ink">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: SERIES_PALETTE[i % SERIES_PALETTE.length] }}
                        />
                        {m.model ?? 'unknown'}
                        {/* Same model can be used via different providers at
                            different prices, so disambiguate the row. */}
                        {m.provider && <span className="shrink-0 text-ink3">· {m.provider}</span>}
                      </span>
                      <span className="num shrink-0 text-[11px] text-ink2">{(m.share * 100).toFixed(1)}%</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-4 gap-2 text-[10px] text-ink3">
                      <span className="num">{compactNumber(m.tokens)} tok</span>
                      <span className="num">{compactNumber(m.sessions, 0)} sess</span>
                      <span className="num">{m.priced ? money(m.cost) : <span className="text-warn">unpriced</span>}</span>
                      <span className="num text-right">{compactNumber(m.avgTokensPerRequest, 0)}/req</span>
                    </div>
                  </li>
                ))}
                {!models.length && <li className="p-4 text-center text-[11px] text-ink3">No model data.</li>}
              </ul>
            </Panel>
          </div>

          {/* ---- C + D ---- */}
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            <Panel title="Cost Allocation by Model" subtitle="API cost, allocated cash and effective rate">
              <div className="space-y-2.5">
                {models.slice(0, 8).map((m, i) => {
                  const shareOfCash = t.tokens > 0 ? (m.tokens / t.tokens) * cash.totalCash : 0;
                  const eff = m.tokens > 0 ? (f.basis === 'allocated_cash' ? shareOfCash : m.cost) / (m.tokens / 1e6) : null;
                  return (
                    <div key={`${m.model}-${i}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="mono truncate text-[11px] text-ink2">
                          {m.model ?? 'unknown'}
                          {m.provider && <span className="text-ink3"> · {m.provider}</span>}
                        </span>
                        <span className="num shrink-0 text-[11px] text-ink">
                          {m.priced ? money(m.cost) : <span className="text-warn">unpriced</span>}
                        </span>
                      </div>
                      <SegmentBar
                        className="mt-1"
                        segments={[
                          { value: m.cost, color: SERIES_PALETTE[i % SERIES_PALETTE.length], label: 'API cost' },
                          { value: Math.max(0, topModelCost - m.cost), color: 'rgba(255,255,255,0.05)', label: 'remainder' },
                        ]}
                      />
                      <div className="mt-1 flex justify-between text-[10px] text-ink3">
                        <span className="num">{compactNumber(m.tokens)} tokens</span>
                        <span className="num">cash {money(shareOfCash)}</span>
                        <span className="num">{eff != null ? `${money(eff)}/Mtok` : '—'}</span>
                      </div>
                    </div>
                  );
                })}
                {!models.length && <Empty title="No models in range." />}
              </div>
            </Panel>

            <Panel
              title="API Versus Subscription Cost"
              subtitle="What list pricing would have cost vs what you actually paid"
              right={
                <Badge tone={t.apiCost >= cash.totalCash ? 'pos' : 'neg'}>
                  {t.apiCost >= cash.totalCash ? 'Saving ' : 'Premium '}
                  {money(Math.abs(t.apiCost - cash.totalCash))}
                </Badge>
              }
              bodyClassName="p-2"
            >
              {cash.totalCash === 0 ? (
                <Empty
                  title="No subscriptions configured."
                  hint="Add your AI plans in Settings › Subscriptions to compare real cash spend against API-equivalent cost."
                />
              ) : (
                <CostBarsChart data={apiVsCash} />
              )}
            </Panel>
          </div>

          {/* ---- E + F ---- */}
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            <Panel
              title="Project ROI Ranking"
              subtitle={`Ranked by net value · ${basisLabel} basis`}
              right={
                <Link href="/roi" className="text-[10px] text-ink3 hover:text-ink">
                  Full analysis <ArrowUpRight size={9} className="inline" />
                </Link>
              }
              bodyClassName="p-0"
            >
              {projects.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-hair text-left">
                        <th className="label-xs px-3.5 py-1.5 font-medium">Project</th>
                        <th className="label-xs px-2 py-1.5 text-right font-medium">Cost</th>
                        <th className="label-xs px-2 py-1.5 text-right font-medium">Value</th>
                        <th className="label-xs px-2 py-1.5 text-right font-medium">Net</th>
                        <th className="label-xs px-3.5 py-1.5 text-right font-medium">ROI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hair">
                      {[...projects]
                        .sort((a, b) => (b.netValue ?? -Infinity) - (a.netValue ?? -Infinity))
                        .slice(0, 8)
                        .map((p) => (
                          <tr key={p.id} className="transition-colors hover:bg-white/[0.03]">
                            <td className="max-w-[180px] truncate px-3.5 py-1.5">
                              <Link href={`/projects/${p.id}`} className="text-ink hover:text-roi">
                                {p.name}
                              </Link>
                            </td>
                            <td className="num px-2 py-1.5 text-right text-ink2">{money(p.cost)}</td>
                            <td className="num px-2 py-1.5 text-right text-ink2">{money(p.value)}</td>
                            <td
                              className={`num px-2 py-1.5 text-right ${
                                p.netValue == null ? 'text-ink3' : p.netValue >= 0 ? 'text-pos' : 'text-neg'
                              }`}
                            >
                              {money(p.netValue)}
                            </td>
                            <td
                              className={`num px-3.5 py-1.5 text-right ${
                                p.roiPct == null ? 'text-ink3' : p.roiPct >= 0 ? 'text-pos' : 'text-neg'
                              }`}
                            >
                              {p.roiPct == null ? '—' : pct(p.roiPct, 0)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="No projects registered."
                  hint="Register a project folder so token events can be attributed to it."
                  action={
                    <Link href="/projects" className="mt-2 text-[11.5px] text-roi hover:underline">
                      Add a project →
                    </Link>
                  }
                />
              )}
            </Panel>

            <Panel
              title="Cost Versus Project Value"
              subtitle="Bubble size is token volume · dashed lines are portfolio medians"
              right={<Tip text="Top-left is high return for low cost. Bottom-right is high cost with little recorded return." />}
              bodyClassName="p-2"
            >
              {scatter.length ? <CostValueScatter data={scatter} /> : <Empty title="No project cost or value data yet." />}
            </Panel>
          </div>

          {/* ---- G ---- */}
          <div className="mt-2.5">
            <Panel
              title="Cumulative Value Versus Cost"
              subtitle={
                cum.breakEvenDate
                  ? `Break-even reached ${cum.breakEvenDate}${cum.payback != null ? ` · payback ${cum.payback} days` : ''}`
                  : 'Break-even not yet reached in this range'
              }
              bodyClassName="p-2"
            >
              {cum.points.length ? (
                <CumulativeChart data={cum.points} breakEvenDate={cum.breakEvenDate} />
              ) : (
                <Empty title="Not enough data to plot cumulative cost and value." />
              )}
            </Panel>
          </div>

          {/* ---- H ---- */}
          <div className="mt-2.5">
            <RecentSessions rows={recent.rows} />
          </div>
        </>
      )}
    </>
  );
}

/** Spread total cash evenly across the month buckets shown. */
function monthlyCashByBucket(totalCash: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const per = totalCash / buckets;
  return Array.from({ length: buckets }, () => per);
}
