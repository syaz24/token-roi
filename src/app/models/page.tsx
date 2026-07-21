import { PageHeader } from '@/components/shell';
import { Badge, Empty, MetricCard, Panel, SegmentBar, SERIES_PALETTE } from '@/components/ui';
import { HorizontalBars } from '@/components/charts';
import { ExportButton } from '@/components/export-button';
import { resolveFilters, type SearchParams } from '@/lib/params';
import { byModel, byProvider, totals } from '@/lib/queries';
import { compactNumber, fullNumber, money } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ModelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = resolveFilters(sp);
  const models = byModel(f);
  const providers = byProvider(f);
  const t = totals(f);

  const unpriced = models.filter((m) => !m.priced);
  const priced = models.filter((m) => m.priced);
  const cheapest = [...priced].filter((m) => m.tokens > 0).sort((a, b) => a.cost / a.tokens - b.cost / b.tokens)[0];
  const costliest = [...priced].sort((a, b) => b.cost - a.cost)[0];

  return (
    <>
      <PageHeader
        title="Models"
        description="Which models you actually used, what they cost at list prices, and where value per token is best."
        right={<ExportButton type="models" label="Export CSV" />}
      />

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <MetricCard label="Models Used" value={String(models.length)} footnote={`${providers.length} providers`} />
        <MetricCard label="Highest Spend" value={costliest?.model ?? '—'} footnote={costliest ? money(costliest.cost) : undefined} />
        <MetricCard
          label="Lowest Cost per Token"
          value={cheapest?.model ?? '—'}
          tone="pos"
          footnote={cheapest ? `${money((cheapest.cost / cheapest.tokens) * 1e6)}/Mtok` : undefined}
        />
        <MetricCard
          label="Unpriced Models"
          value={String(unpriced.length)}
          tone={unpriced.length ? 'neg' : 'neutral'}
          warning={unpriced.length ? `${compactNumber(t.unpricedTokens)} tokens excluded from cost` : undefined}
          footnote={unpriced.length ? undefined : 'Full pricing coverage'}
        />
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-3">
        <Panel title="Model Usage" subtitle="Ranked by token volume" className="xl:col-span-2" bodyClassName="p-0">
          {models.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[11px]">
                <thead>
                  <tr className="border-b border-hair text-left">
                    <th className="label-xs px-3.5 py-1.5 font-medium">Model</th>
                    <th className="label-xs px-2 py-1.5 font-medium">Provider</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Requests</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Sessions</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Tokens</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Avg/req</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">API Cost</th>
                    <th className="label-xs px-3.5 py-1.5 font-medium">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hair">
                  {models.map((m, i) => (
                    <tr key={i} className="hover:bg-white/[0.03]">
                      <td className="mono px-3.5 py-1.5 text-ink">{m.model ?? 'unknown'}</td>
                      <td className="px-2 py-1.5 text-ink3">{m.provider ?? '—'}</td>
                      <td className="num px-2 py-1.5 text-right text-ink2">{fullNumber(m.events)}</td>
                      <td className="num px-2 py-1.5 text-right text-ink2">{fullNumber(m.sessions)}</td>
                      <td className="num px-2 py-1.5 text-right text-ink2">{compactNumber(m.tokens)}</td>
                      <td className="num px-2 py-1.5 text-right text-ink3">{compactNumber(m.avgTokensPerRequest, 0)}</td>
                      <td className="num px-2 py-1.5 text-right text-ink">
                        {m.priced ? money(m.cost) : <Badge tone="warn">unpriced</Badge>}
                      </td>
                      <td className="px-3.5 py-1.5">
                        <div className="flex items-center gap-2">
                          <SegmentBar
                            className="w-16"
                            segments={[
                              { value: m.share, color: SERIES_PALETTE[i % SERIES_PALETTE.length], label: 'share' },
                              { value: 1 - m.share, color: 'rgba(255,255,255,0.05)', label: 'rest' },
                            ]}
                          />
                          <span className="num text-[10px] text-ink3">{(m.share * 100).toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No model usage in this range." />
          )}
        </Panel>

        <div className="space-y-2.5">
          <Panel title="Cost by Provider" bodyClassName="p-2">
            {providers.length ? (
              <HorizontalBars data={providers.map((p) => ({ name: p.provider, value: p.cost }))} height={200} />
            ) : (
              <Empty title="No provider data." />
            )}
          </Panel>

          <Panel title="Tokens by Provider" bodyClassName="p-2">
            {providers.length ? (
              <HorizontalBars data={providers.map((p) => ({ name: p.provider, value: p.tokens }))} kind="number" height={200} />
            ) : (
              <Empty title="No provider data." />
            )}
          </Panel>
        </div>
      </div>

      {unpriced.length > 0 && (
        <Panel
          title="Unpriced Models"
          subtitle="These tokens are counted but excluded from every cost total"
          className="mt-2.5"
        >
          <p className="mb-2 text-[11px] leading-relaxed text-ink3">
            No pricing record matches these model identifiers on the dates they were used. Add them in Settings › Pricing
            to bring them into cost and ROI figures.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {unpriced.map((m, i) => (
              <li key={i}>
                <Badge tone="warn">
                  <span className="mono">{m.model ?? 'unknown'}</span> · {compactNumber(m.tokens)} tokens
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
