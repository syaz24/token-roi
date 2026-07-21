import Link from 'next/link';
import { PageHeader } from '@/components/shell';
import { Badge, Empty, Panel, Tip } from '@/components/ui';
import { CostValueScatter } from '@/components/charts';
import { ExportButton } from '@/components/export-button';
import { resolveFilters, type SearchParams } from '@/lib/params';
import { projectRoiTable, type ProjectRoi } from '@/lib/queries';
import { compactNumber, money, multiple, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function RoiPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = resolveFilters(sp);
  const rows = projectRoiTable(f);

  const basisLabel =
    f.basis === 'api_equivalent' ? 'API Equivalent' : f.basis === 'allocated_cash' ? 'Allocated Cash' : 'Blended';

  const withRoi = rows.filter((r) => r.roiPct != null);
  const highestRoi = [...withRoi].sort((a, b) => (b.roiPct ?? 0) - (a.roiPct ?? 0)).slice(0, 5);
  const lowestRoi = [...withRoi].sort((a, b) => (a.roiPct ?? 0) - (b.roiPct ?? 0)).slice(0, 5);
  const highestNet = [...rows].sort((a, b) => (b.netValue ?? -Infinity) - (a.netValue ?? -Infinity)).slice(0, 5);
  const highestSpend = [...rows].sort((a, b) => b.cost - a.cost).slice(0, 5);
  const nearBreakEven = rows
    .filter((r) => !r.breakEvenPassed && r.cost > 0 && r.value > 0)
    .sort((a, b) => a.breakEvenRemaining - b.breakEvenRemaining)
    .slice(0, 5);
  const noValueData = rows.filter((r) => r.value === 0 && r.tokens > 0);
  const incompleteCost = rows.filter((r) => r.pricingCoverage < 0.95 && r.tokens > 0);
  const declining = rows.filter(
    (r) => r.recommendation.factors.some((x) => x.label === 'Recent value growth' && x.points < 0),
  );

  const scatter = rows.filter((r) => r.tokens > 0 || r.value > 0).map((r) => ({
    name: r.name,
    cost: r.cost,
    value: r.value,
    tokens: r.tokens,
  }));

  const grouped = groupBy(rows);

  return (
    <>
      <PageHeader
        title="ROI Analysis"
        description={`Where your AI budget is earning its keep. All figures use the ${basisLabel} cost basis — change it in the top bar.`}
        right={<ExportButton type="roi" label="Export CSV" />}
      />

      {!rows.length ? (
        <Panel>
          <Empty
            title="No projects to analyse."
            hint="Register a project folder and record some value to see ROI."
            action={
              <Link href="/projects" className="mt-2 text-[11.5px] text-roi hover:underline">
                Add a project →
              </Link>
            }
          />
        </Panel>
      ) : (
        <>
          <Panel
            title="Focus Recommendation"
            subtitle="Deterministic scoring over your own numbers — never an external model, and never financial advice"
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[11px]">
                <thead>
                  <tr className="border-b border-hair text-left">
                    <th className="label-xs px-3.5 py-1.5 font-medium">Project</th>
                    <th className="label-xs px-2 py-1.5 font-medium">Recommendation</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Score</th>
                    <th className="label-xs px-2 py-1.5 font-medium">Confidence</th>
                    <th className="label-xs px-3.5 py-1.5 font-medium">Contributing factors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hair">
                  {[...rows]
                    .sort((a, b) => b.recommendation.score - a.recommendation.score)
                    .map((p) => (
                      <tr key={p.id} className="align-top hover:bg-white/[0.03]">
                        <td className="px-3.5 py-2">
                          <Link href={`/projects/${p.id}`} className="text-ink hover:text-roi">
                            {p.name}
                          </Link>
                        </td>
                        <td className="px-2 py-2">
                          <Badge tone={toneFor(p.recommendation.recommendation)}>{p.recommendation.recommendation}</Badge>
                        </td>
                        <td className="num px-2 py-2 text-right text-ink2">{p.recommendation.score}</td>
                        <td className="px-2 py-2 text-ink3">{p.recommendation.confidence}</td>
                        <td className="px-3.5 py-2">
                          <ul className="space-y-0.5">
                            {p.recommendation.factors.map((fa, i) => (
                              <li key={i} className="flex items-baseline gap-1.5 text-[10.5px]">
                                <span
                                  className={`num w-9 shrink-0 text-right ${
                                    fa.points > 0 ? 'text-pos' : fa.points < 0 ? 'text-neg' : 'text-ink3'
                                  }`}
                                >
                                  {fa.points > 0 ? '+' : ''}
                                  {fa.points}
                                </span>
                                <span className="text-ink3">
                                  <span className="text-ink2">{fa.label}:</span> {fa.detail}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            <Panel
              title="Portfolio Matrix"
              subtitle="Cost versus value · bubble size is token volume · dashed lines are medians"
              right={<Tip text="Top-left: high return for low cost. Bottom-right: high cost with little recorded return." />}
              bodyClassName="p-2"
            >
              {scatter.length ? <CostValueScatter data={scatter} height={320} /> : <Empty title="No data to plot." />}
            </Panel>

            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-1">
              <RankList title="Highest ROI Projects" rows={highestRoi} render={(p) => pct(p.roiPct, 0)} tone="pos" />
              <RankList title="Lowest ROI Projects" rows={lowestRoi} render={(p) => pct(p.roiPct, 0)} tone="neg" />
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            <RankList title="Highest Net Value" rows={highestNet} render={(p) => money(p.netValue)} tone="pos" />
            <RankList title="Highest Token Spend" rows={highestSpend} render={(p) => money(p.cost)} />
            <RankList
              title="Nearest to Break-even"
              rows={nearBreakEven}
              render={(p) => `${money(p.breakEvenRemaining)} to go`}
              empty="Every project with value has passed break-even."
            />
            <RankList
              title="Declining Marginal ROI"
              rows={declining}
              render={(p) => multiple(p.roiMultiple)}
              tone="neg"
              empty="No project shows declining value growth."
            />
          </div>

          <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            <Panel title="Projects With Insufficient Value Data" subtitle="Cost is known, return is not">
              {noValueData.length ? (
                <ul className="space-y-1.5">
                  {noValueData.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 border-b border-hair pb-1.5 text-[11px] last:border-0">
                      <Link href={`/projects/${p.id}?tab=Value`} className="truncate text-ink hover:text-roi">
                        {p.name}
                      </Link>
                      <span className="num shrink-0 text-ink3">
                        {compactNumber(p.tokens)} tokens · {money(p.cost)} spent
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="Every active project has recorded value." />
              )}
            </Panel>

            <Panel title="Projects With Incomplete Cost Coverage" subtitle="Some tokens could not be priced">
              {incompleteCost.length ? (
                <ul className="space-y-1.5">
                  {incompleteCost.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 border-b border-hair pb-1.5 text-[11px] last:border-0">
                      <Link href={`/projects/${p.id}`} className="truncate text-ink hover:text-roi">
                        {p.name}
                      </Link>
                      <Badge tone="warn">{(p.pricingCoverage * 100).toFixed(0)}% priced</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="All project costs have full pricing coverage." />
              )}
            </Panel>
          </div>

          {Object.keys(grouped).length > 1 && (
            <Panel title="ROI by Project Category" className="mt-2.5" bodyClassName="p-0">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-hair text-left">
                    <th className="label-xs px-3.5 py-1.5 font-medium">Category</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Projects</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Cost</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Value</th>
                    <th className="label-xs px-3.5 py-1.5 text-right font-medium">ROI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hair">
                  {Object.entries(grouped).map(([cat, g]) => {
                    const cost = g.reduce((s, r) => s + r.cost, 0);
                    const value = g.reduce((s, r) => s + r.value, 0);
                    const roi = cost > 0 ? ((value - cost) / cost) * 100 : null;
                    return (
                      <tr key={cat} className="hover:bg-white/[0.03]">
                        <td className="px-3.5 py-1.5 text-ink">{cat}</td>
                        <td className="num px-2 py-1.5 text-right text-ink2">{g.length}</td>
                        <td className="num px-2 py-1.5 text-right text-ink2">{money(cost)}</td>
                        <td className="num px-2 py-1.5 text-right text-ink2">{money(value)}</td>
                        <td className={`num px-3.5 py-1.5 text-right ${roi == null ? 'text-ink3' : roi >= 0 ? 'text-pos' : 'text-neg'}`}>
                          {roi == null ? '—' : pct(roi, 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}
        </>
      )}
    </>
  );
}

function RankList({
  title,
  rows,
  render,
  tone,
  empty,
}: {
  title: string;
  rows: ProjectRoi[];
  render: (p: ProjectRoi) => string;
  tone?: 'pos' | 'neg';
  empty?: string;
}) {
  return (
    <Panel title={title}>
      {rows.length ? (
        <ol className="space-y-1.5">
          {rows.map((p, i) => (
            <li key={p.id} className="flex items-center justify-between gap-2 border-b border-hair pb-1.5 text-[11px] last:border-0">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="num w-3 shrink-0 text-ink3">{i + 1}</span>
                <Link href={`/projects/${p.id}`} className="truncate text-ink hover:text-roi">
                  {p.name}
                </Link>
              </span>
              <span className={`num shrink-0 ${tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : 'text-ink2'}`}>
                {render(p)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <Empty title={empty ?? 'Not enough data.'} />
      )}
    </Panel>
  );
}

function toneFor(r: string): 'pos' | 'neg' | 'warn' | 'info' | 'neutral' {
  switch (r) {
    case 'Double Down':
      return 'pos';
    case 'Maintain':
      return 'info';
    case 'Validate Further':
      return 'warn';
    case 'Reduce Spend':
      return 'warn';
    case 'Pause':
      return 'neg';
    default:
      return 'neutral';
  }
}

function groupBy(rows: ProjectRoi[]): Record<string, ProjectRoi[]> {
  const out: Record<string, ProjectRoi[]> = {};
  for (const r of rows) {
    const k = r.category || 'Uncategorised';
    (out[k] ??= []).push(r);
  }
  return out;
}
