import { PageHeader } from '@/components/shell';
import { Badge, Empty, MetricCard, Panel, Tip } from '@/components/ui';
import { CostBarsChart, HorizontalBars, SimpleLine } from '@/components/charts';
import { GrainTabs } from '@/components/grain-tabs';
import { ExportButton } from '@/components/export-button';
import { resolveFilters, str, type SearchParams } from '@/lib/params';
import {
  activeDays,
  allocatedCash,
  byModel,
  byProvider,
  previousWindow,
  projectRoiTable,
  tokenSeries,
  totals,
  type Grain,
} from '@/lib/queries';
import { compactNumber, deltaPct, fullNumber, money } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function CostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = resolveFilters(sp);
  const grain = (str(sp.grain) ?? 'day') as Grain;

  const t = totals(f);
  const prev = totals(previousWindow(f));
  const series = tokenSeries(f, grain);
  const monthly = tokenSeries(f, 'month');
  const cash = allocatedCash(f);
  const models = byModel(f);
  const providers = byProvider(f);
  const projects = projectRoiTable(f);
  const days = activeDays(f);

  const perMonthCash = monthly.length ? cash.totalCash / monthly.length : 0;
  const apiVsCash = monthly.map((m) => ({ bucket: m.bucket, api: m.cost, cash: perMonthCash }));

  const savings = t.apiCost - cash.totalCash;

  return (
    <>
      <PageHeader
        title="Costs"
        description="API-equivalent cost from dated pricing, compared against the subscription money you actually spent."
        right={<ExportButton type="costs" label="Export CSV" />}
      />

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="API-Equivalent Total"
          value={money(t.apiCost)}
          delta={deltaPct(t.apiCost, prev.apiCost)}
          invertDelta
          spark={series.map((s) => s.cost)}
          tooltip="Sum of per-event costs, each priced with the registry row effective on that event's date."
          warning={t.pricingCoverage < 0.999 ? `${(t.pricingCoverage * 100).toFixed(1)}% of tokens priced` : undefined}
        />
        <MetricCard
          label="Allocated Cash Cost"
          value={money(cash.totalCash)}
          tooltip="Real subscription spend for billing months inside the range, after seats, tax and discount."
          warning={cash.unallocated > 0.01 ? `${money(cash.unallocated)} unallocated` : undefined}
        />
        <MetricCard
          label={savings >= 0 ? 'Subscription Saving' : 'Subscription Premium'}
          value={money(Math.abs(savings))}
          tone={savings >= 0 ? 'pos' : 'neg'}
          tooltip="API-equivalent cost minus allocated cash cost. Positive means your subscriptions were cheaper than list API pricing."
        />
        <MetricCard
          label="Effective Cost / 1M Tokens"
          value={t.tokens > 0 ? money((cash.totalCash || t.apiCost) / (t.tokens / 1e6)) : '—'}
          tooltip="Cost on the selected basis divided by millions of tokens consumed."
        />
        <MetricCard
          label="Cost per Active Day"
          value={days ? money(t.apiCost / days) : '—'}
          footnote={`${days} active days`}
        />
        <MetricCard
          label="Cost per Session"
          value={t.sessions ? money(t.apiCost / t.sessions) : '—'}
          footnote={`${fullNumber(t.sessions)} sessions`}
        />
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-3">
        <Panel
          title="Cost Over Time"
          className="xl:col-span-2"
          right={<GrainTabs current={grain} />}
          bodyClassName="p-2"
        >
          <SimpleLine data={series} dataKey="cost" kind="money" height={240} />
        </Panel>

        <Panel title="Token Composition" subtitle="What you are actually paying for">
          <dl className="space-y-1.5 text-[11px]">
            <Row label="Input tokens" value={fullNumber(t.input)} />
            <Row label="Output tokens" value={fullNumber(t.output)} />
            <Row label="Cache read" value={fullNumber(t.cacheRead)} />
            <Row label="Cache write" value={fullNumber(t.cacheWrite)} />
            <Row label="Reasoning" value={fullNumber(t.reasoning)} />
            <Row label="Total" value={fullNumber(t.tokens)} />
            <Row label="Requests" value={fullNumber(t.events)} />
            <Row label="Unpriced events" value={fullNumber(t.unpricedEvents)} />
          </dl>
        </Panel>
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        <Panel
          title="API Versus Subscription Cost"
          subtitle="Per billing month"
          right={
            <Badge tone={savings >= 0 ? 'pos' : 'neg'}>
              {savings >= 0 ? 'Saving ' : 'Premium '}
              {money(Math.abs(savings))}
            </Badge>
          }
          bodyClassName="p-2"
        >
          {cash.totalCash > 0 ? (
            <CostBarsChart data={apiVsCash} />
          ) : (
            <Empty
              title="No subscriptions configured."
              hint="Add your plans in Settings › Subscriptions to compare real cash spend against list API pricing."
            />
          )}
        </Panel>

        <Panel title="Cost by Model" bodyClassName="p-2">
          {models.filter((m) => m.priced).length ? (
            <HorizontalBars data={models.filter((m) => m.priced).slice(0, 10).map((m) => ({ name: m.model ?? 'unknown', value: m.cost }))} />
          ) : (
            <Empty title="No priced models in range." />
          )}
        </Panel>

        <Panel title="Cost by Provider" bodyClassName="p-2">
          {providers.length ? (
            <HorizontalBars data={providers.map((p) => ({ name: p.provider, value: p.cost }))} height={200} />
          ) : (
            <Empty title="No provider data." />
          )}
        </Panel>

        <Panel title="Cost by Project" bodyClassName="p-2">
          {projects.filter((p) => p.apiCost > 0).length ? (
            <HorizontalBars data={projects.filter((p) => p.apiCost > 0).slice(0, 10).map((p) => ({ name: p.name, value: p.apiCost }))} height={200} />
          ) : (
            <Empty title="No project cost data." />
          )}
        </Panel>
      </div>

      {cash.warnings.length > 0 && (
        <Panel title="Allocation Notes" className="mt-2.5">
          <ul className="space-y-1 text-[11px] text-ink2">
            {cash.warnings.map((w, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-warn">•</span>
                {w}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hair pb-1 last:border-0">
      <dt className="text-ink3">{label}</dt>
      <dd className="num text-ink2">{value}</dd>
    </div>
  );
}
