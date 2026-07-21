import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, CheckCircle2, GitCommitHorizontal, Info, TrendingDown } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { Badge, Empty, MetricCard, Panel, Tip } from '@/components/ui';
import { CumulativeChart, HorizontalBars, SimpleLine, TokenVolumeChart } from '@/components/charts';
import { RecentSessions } from '@/components/recent-sessions';
import { ProjectTabs } from '@/components/project-tabs';
import { ValueForm, ValueList } from '@/components/value-forms';
import { ProjectSettingsForm } from '@/components/project-settings';
import { resolveFilters, str, type SearchParams } from '@/lib/params';
import { raw } from '@/db/client';
import {
  activeDays,
  allocatedCash,
  byModel,
  bySource,
  cumulativeSeries,
  listEvents,
  previousWindow,
  projectRoiTable,
  tokenSeries,
  totals,
  valueEventsFor,
} from '@/lib/queries';
import { getGitMetrics } from '@/lib/projects/git';
import { projectHealth } from '@/lib/roi/health';
import { compactNumber, deltaPct, fullNumber, money, multiple, pct, shortDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TABS = ['Summary', 'Token Usage', 'Sessions', 'Models', 'Cost', 'Value', 'ROI', 'Git Activity', 'Settings'] as const;

export default async function ProjectDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const base = resolveFilters(sp);
  const f = { ...base, projectId: id };
  const tab = str(sp.tab) ?? 'Summary';

  const project = raw().prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as any;
  if (!project) notFound();

  const t = totals(f);
  const prevF = previousWindow(f);
  const prev = totals(prevF);
  const roiRow = projectRoiTable(base).find((r) => r.id === id);
  const models = byModel(f);
  const sources = bySource(f);
  const series = tokenSeries(f, 'day');
  const cum = cumulativeSeries(f);
  const git = getGitMetrics(id);
  const values = valueEventsFor(f.dataset, id);
  const days = activeDays(f, id);
  const recent = listEvents({ ...f, limit: 25 });
  const cash = allocatedCash(base);

  const cost = roiRow?.cost ?? t.apiCost;
  const prevCash = allocatedCash(prevF).byProject[id] ?? 0;
  const prevCost = base.basis === 'api_equivalent' ? prev.apiCost : prevCash || prev.apiCost;

  const commits = git?.commitCount ?? 0;
  const costPerCommit = commits > 0 ? cost / commits : null;

  const health = projectHealth({
    tokens: t.tokens,
    prevTokens: prev.tokens,
    cost,
    prevCost,
    apiCost: t.apiCost,
    cashCost: roiRow?.cashCost ?? 0,
    value: roiRow?.value ?? 0,
    prevValue: 0,
    realisedValue: roiRow?.realisedValue ?? 0,
    estimatedValue: roiRow?.estimatedValue ?? 0,
    pricingCoverage: t.pricingCoverage,
    topModelShare: models[0]?.share ?? 0,
    topModelName: models[0]?.model ?? null,
    breakEvenPassed: roiRow?.breakEvenPassed ?? false,
    breakEvenRemaining: roiRow?.breakEvenRemaining ?? 0,
    commits,
    prevCostPerCommit: null,
    costPerCommit,
    valueEntries: values.length,
  });

  const cheapestModel = [...models]
    .filter((m) => m.priced && m.tokens > 0)
    .sort((a, b) => a.cost / a.tokens - b.cost / b.tokens)[0];

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.description ?? project.path}
        right={
          <>
            {project.archived ? <Badge>Archived</Badge> : <Badge tone="info">{project.status}</Badge>}
            {roiRow && (
              <Badge tone={roiRow.recommendation.recommendation === 'Double Down' ? 'pos' : 'info'}>
                {roiRow.recommendation.recommendation}
              </Badge>
            )}
            <Link href="/projects" className="text-[10px] text-ink3 hover:text-ink">
              ← All projects
            </Link>
          </>
        }
      />

      <ProjectTabs tabs={[...TABS]} current={tab} />

      {tab === 'Summary' && (
        <div className="mt-2.5 space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Project Value" value={money(roiRow?.value ?? 0)} tone="pos" spark={series.map((s) => s.tokens)} footnote={`${money(roiRow?.realisedValue ?? 0)} realised`} />
            <MetricCard label="Total Tokens" value={compactNumber(t.tokens)} delta={deltaPct(t.tokens, prev.tokens)} footnote={`${compactNumber(t.events)} requests`} />
            <MetricCard label="API-Equivalent Cost" value={money(t.apiCost)} delta={deltaPct(t.apiCost, prev.apiCost)} invertDelta warning={t.pricingCoverage < 0.999 ? `${(t.pricingCoverage * 100).toFixed(0)}% priced` : undefined} />
            <MetricCard label="Allocated Cash Cost" value={money(roiRow?.cashCost ?? 0)} footnote={cash.totalCash === 0 ? 'No subscriptions' : undefined} />
            <MetricCard label="Net Value" value={money(roiRow?.netValue)} tone={(roiRow?.netValue ?? 0) >= 0 ? 'pos' : 'neg'} footnote={roiRow?.breakEvenPassed ? 'Past break-even' : `${money(roiRow?.breakEvenRemaining ?? 0)} to break even`} />
            <MetricCard label="ROI" value={roiRow?.roiPct == null ? '—' : pct(roiRow.roiPct, 0)} tone={(roiRow?.roiPct ?? 0) >= 0 ? 'pos' : 'neg'} footnote={`${multiple(roiRow?.roiMultiple)} multiple`} />
          </div>

          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3">
            <Panel title="Project Health" subtitle="Deterministic rules over your own numbers — no external model" className="xl:col-span-2">
              <ul className="space-y-2">
                {health.map((h, i) => (
                  <li key={i} className="flex gap-2 rounded-md border border-hair bg-black/20 p-2.5">
                    <span className="mt-0.5 shrink-0">
                      {h.tone === 'positive' ? (
                        <CheckCircle2 size={12} className="text-pos" />
                      ) : h.tone === 'negative' ? (
                        <TrendingDown size={12} className="text-neg" />
                      ) : h.tone === 'warning' ? (
                        <AlertTriangle size={12} className="text-warn" />
                      ) : (
                        <Info size={12} className="text-info" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11.5px] font-medium text-ink">{h.title}</p>
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink3">{h.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Key Figures">
              <dl className="space-y-1.5 text-[11px]">
                <KV label="Most-used model" value={models[0]?.model ?? '—'} mono />
                <KV label="Most cost-efficient model" value={cheapestModel?.model ?? '—'} mono />
                <KV label="Active development days" value={String(days)} />
                <KV label="Commits" value={git ? fullNumber(git.commitCount) : 'not indexed'} />
                <KV label="Tokens per commit" value={commits ? compactNumber(t.tokens / commits) : '—'} />
                <KV label="Cost per commit" value={costPerCommit != null ? money(costPerCommit) : '—'} />
                <KV label="Cost per active day" value={days ? money(cost / days) : '—'} />
                <KV label="Value per 1M tokens" value={money(roiRow?.valuePerMTok)} />
                <KV label="Subscription savings" value={money(roiRow?.savingsVsApi ?? 0)} />
                <KV label="Effective cost per 1M tokens" value={money(roiRow?.effectiveCostPerMTok)} />
                <KV label="Last activity" value={shortDate(git?.lastCommitAt ?? null)} />
                <KV label="Folder" value={project.path} mono />
              </dl>
            </Panel>
          </div>

          <Panel title="Cumulative Value Versus Cost" subtitle={cum.breakEvenDate ? `Break-even ${cum.breakEvenDate}` : 'Break-even not yet reached'} bodyClassName="p-2">
            {cum.points.length ? <CumulativeChart data={cum.points} breakEvenDate={cum.breakEvenDate} /> : <Empty title="Not enough data." />}
          </Panel>
        </div>
      )}

      {tab === 'Token Usage' && (
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-2">
          <Panel title="Token Usage Over Time" className="xl:col-span-2" bodyClassName="p-2">
            <TokenVolumeChart data={series} height={260} />
          </Panel>
          <Panel title="Tokens by Source" bodyClassName="p-2">
            <HorizontalBars data={sources.map((s) => ({ name: s.source, value: s.tokens }))} kind="number" />
          </Panel>
          <Panel title="Token Composition">
            <dl className="space-y-1.5 text-[11px]">
              <KV label="Input" value={fullNumber(t.input)} mono />
              <KV label="Output" value={fullNumber(t.output)} mono />
              <KV label="Cache read" value={fullNumber(t.cacheRead)} mono />
              <KV label="Cache write" value={fullNumber(t.cacheWrite)} mono />
              <KV label="Reasoning" value={fullNumber(t.reasoning)} mono />
              <KV label="Total" value={fullNumber(t.tokens)} mono />
            </dl>
          </Panel>
        </div>
      )}

      {tab === 'Sessions' && (
        <div className="mt-2.5">
          <RecentSessions rows={recent.rows} title={`Sessions — ${project.name}`} />
        </div>
      )}

      {tab === 'Models' && (
        <Panel title="Cost by Model" className="mt-2.5" bodyClassName="p-0">
          <ModelTable models={models} />
        </Panel>
      )}

      {tab === 'Cost' && (
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-2">
          <Panel title="Cost Over Time" bodyClassName="p-2">
            <SimpleLine data={series} dataKey="cost" kind="money" height={230} />
          </Panel>
          <Panel title="Cost by Model" bodyClassName="p-2">
            <HorizontalBars data={models.filter((m) => m.priced).map((m) => ({ name: m.model ?? 'unknown', value: m.cost }))} />
          </Panel>
          <Panel title="Cost Breakdown" className="xl:col-span-2">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] md:grid-cols-4">
              <KV label="API-equivalent" value={money(t.apiCost)} />
              <KV label="Allocated cash" value={money(roiRow?.cashCost ?? 0)} />
              <KV label="Savings vs API" value={money(roiRow?.savingsVsApi ?? 0)} />
              <KV label="Cost basis in use" value={base.basis} />
              <KV label="Cost per session" value={t.sessions ? money(cost / t.sessions) : '—'} />
              <KV label="Cost per request" value={t.events ? money(cost / t.events) : '—'} />
              <KV label="Cost per active day" value={days ? money(cost / days) : '—'} />
              <KV label="Pricing coverage" value={`${(t.pricingCoverage * 100).toFixed(1)}%`} />
            </dl>
          </Panel>
        </div>
      )}

      {tab === 'Value' && (
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-3">
          <Panel title="Recorded Value" subtitle="Realised and estimated entries are tracked separately" className="xl:col-span-2" bodyClassName="p-0">
            <ValueList rows={values} />
          </Panel>
          <ValueForm projectId={id} />
        </div>
      )}

      {tab === 'ROI' && (
        <div className="mt-2.5 space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <MetricCard label="ROI %" value={roiRow?.roiPct == null ? '—' : pct(roiRow.roiPct, 1)} tone={(roiRow?.roiPct ?? 0) >= 0 ? 'pos' : 'neg'} />
            <MetricCard label="ROI Multiple" value={multiple(roiRow?.roiMultiple)} tone="roi" />
            <MetricCard label="Net Value" value={money(roiRow?.netValue)} tone={(roiRow?.netValue ?? 0) >= 0 ? 'pos' : 'neg'} />
            <MetricCard label="Value / 1M tokens" value={money(roiRow?.valuePerMTok)} />
          </div>
          <Panel title="Cumulative ROI" subtitle={cum.payback != null ? `Payback period ${cum.payback} days` : 'Payback not reached in range'} bodyClassName="p-2">
            {cum.points.length ? <CumulativeChart data={cum.points} breakEvenDate={cum.breakEvenDate} height={280} /> : <Empty title="Not enough data." />}
          </Panel>
          {roiRow && (
            <Panel title="Recommendation Factors" subtitle={`${roiRow.recommendation.recommendation} · score ${roiRow.recommendation.score} · confidence ${roiRow.recommendation.confidence}`}>
              <ul className="space-y-1.5">
                {roiRow.recommendation.factors.map((fa, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 border-b border-hair pb-1.5 text-[11px] last:border-0">
                    <div>
                      <span className="text-ink">{fa.label}</span>
                      <p className="text-[10.5px] text-ink3">{fa.detail}</p>
                    </div>
                    <span className={`num shrink-0 ${fa.points > 0 ? 'text-pos' : fa.points < 0 ? 'text-neg' : 'text-ink3'}`}>
                      {fa.points > 0 ? '+' : ''}
                      {fa.points}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] leading-relaxed text-ink3">
                This score is a transparent bookkeeping heuristic over your own recorded numbers. It is not financial
                advice, and correlation between AI usage and business results does not establish causation.
              </p>
            </Panel>
          )}
        </div>
      )}

      {tab === 'Git Activity' && (
        <Panel title="Git Activity" subtitle={git?.scannedAt ? `Indexed ${shortDate(git.scannedAt)}${git.dirty ? ' · working tree was dirty during scan' : ''}` : 'Not indexed yet'} className="mt-2.5">
          {git ? (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] md:grid-cols-4">
                <KV label="Commits" value={fullNumber(git.commitCount)} />
                <KV label="Active days" value={fullNumber(git.activeDays)} />
                <KV label="Branches" value={fullNumber(git.branches)} />
                <KV label="Contributors" value={fullNumber(git.contributors)} />
                <KV label="Lines added" value={fullNumber(git.linesAdded)} />
                <KV label="Lines removed" value={fullNumber(git.linesRemoved)} />
                <KV label="Files changed" value={fullNumber(git.filesChanged)} />
                <KV label="First commit" value={shortDate(git.firstCommitAt)} />
                <KV label="Latest commit" value={shortDate(git.lastCommitAt)} />
                <KV label="Tokens per commit" value={commits ? compactNumber(t.tokens / commits) : '—'} />
                <KV label="Cost per commit" value={costPerCommit != null ? money(costPerCommit) : '—'} />
                <KV label="Value per commit" value={commits && roiRow ? money(roiRow.value / commits) : '—'} />
              </dl>
              <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-ink3">
                <GitCommitHorizontal size={11} className="mt-px shrink-0" />
                Only aggregate metadata is indexed — never source code contents. These ratios are correlations, not proof
                that AI usage produced any particular commit or business result.
              </p>
            </>
          ) : (
            <Empty title="No Git metadata indexed." hint="Use Rescan Git on the Settings tab if this folder is a repository." />
          )}
        </Panel>
      )}

      {tab === 'Settings' && <ProjectSettingsForm project={project} className="mt-2.5" />}
    </>
  );
}

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hair pb-1 last:border-0">
      <dt className="shrink-0 text-ink3">{label}</dt>
      <dd className={`truncate text-right text-ink2 ${mono ? 'mono' : 'num'}`}>{value}</dd>
    </div>
  );
}

function ModelTable({ models }: { models: ReturnType<typeof byModel> }) {
  if (!models.length) return <Empty title="No model usage in this range." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-[11px]">
        <thead>
          <tr className="border-b border-hair text-left">
            <th className="label-xs px-3.5 py-1.5 font-medium">Model</th>
            <th className="label-xs px-2 py-1.5 font-medium">Provider</th>
            <th className="label-xs px-2 py-1.5 text-right font-medium">Requests</th>
            <th className="label-xs px-2 py-1.5 text-right font-medium">Tokens</th>
            <th className="label-xs px-2 py-1.5 text-right font-medium">Share</th>
            <th className="label-xs px-2 py-1.5 text-right font-medium">Avg/req</th>
            <th className="label-xs px-3.5 py-1.5 text-right font-medium">API Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {models.map((m, i) => (
            <tr key={i} className="hover:bg-white/[0.03]">
              <td className="mono px-3.5 py-1.5 text-ink">{m.model ?? 'unknown'}</td>
              <td className="px-2 py-1.5 text-ink3">{m.provider ?? '—'}</td>
              <td className="num px-2 py-1.5 text-right text-ink2">{fullNumber(m.events)}</td>
              <td className="num px-2 py-1.5 text-right text-ink2">{compactNumber(m.tokens)}</td>
              <td className="num px-2 py-1.5 text-right text-ink3">{(m.share * 100).toFixed(1)}%</td>
              <td className="num px-2 py-1.5 text-right text-ink3">{compactNumber(m.avgTokensPerRequest, 0)}</td>
              <td className="num px-3.5 py-1.5 text-right text-ink">
                {m.priced ? money(m.cost) : <span className="text-warn">unpriced</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
