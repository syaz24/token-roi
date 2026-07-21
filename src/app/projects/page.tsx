import os from 'node:os';
import Link from 'next/link';
import { PageHeader } from '@/components/shell';
import { Badge, Empty, Panel } from '@/components/ui';
import { AddProjectForm } from '@/components/project-forms';
import { ProjectWizard } from '@/components/project-wizard';
import { UnassignedList } from '@/components/unassigned-list';
import { resolveFilters, type SearchParams } from '@/lib/params';
import { projectRoiTable, unassignedSessions, unassignedUsage } from '@/lib/queries';
import { compactNumber, money, multiple, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = resolveFilters(sp);
  const rows = projectRoiTable(f);
  const unassigned = unassignedUsage(f);
  const orphans = unassignedSessions(f.dataset, 100);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Register a development folder so token events can be attributed to it. Nothing outside the folders you register is ever scanned."
        right={<ProjectWizard />}
      />

      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3">
        <Panel title="Registered Projects" subtitle={`${rows.length} projects`} className="xl:col-span-2" bodyClassName="p-0">
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[11px]">
                <thead>
                  <tr className="border-b border-hair text-left">
                    <th className="label-xs px-3.5 py-1.5 font-medium">Project</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Tokens</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">API Cost</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Cash</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Value</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">ROI</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Multiple</th>
                    <th className="label-xs px-3.5 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hair">
                  {rows.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-white/[0.03]">
                      <td className="px-3.5 py-2">
                        <Link href={`/projects/${p.id}`} className="font-medium text-ink hover:text-roi">
                          {p.name}
                        </Link>
                        <div className="mono mt-0.5 max-w-[260px] truncate text-[10px] text-ink3">{p.path}</div>
                      </td>
                      <td className="num px-2 py-2 text-right text-ink2">{compactNumber(p.tokens)}</td>
                      <td className="num px-2 py-2 text-right text-ink2">{money(p.apiCost)}</td>
                      <td className="num px-2 py-2 text-right text-ink2">{money(p.cashCost)}</td>
                      <td className="num px-2 py-2 text-right text-ink2">{money(p.value)}</td>
                      <td
                        className={`num px-2 py-2 text-right ${
                          p.roiPct == null ? 'text-ink3' : p.roiPct >= 0 ? 'text-pos' : 'text-neg'
                        }`}
                      >
                        {p.roiPct == null ? '—' : pct(p.roiPct, 0)}
                      </td>
                      <td className="num px-2 py-2 text-right text-ink2">{multiple(p.roiMultiple)}</td>
                      <td className="px-3.5 py-2">
                        <Badge
                          tone={
                            p.recommendation.recommendation === 'Double Down'
                              ? 'pos'
                              : p.recommendation.recommendation === 'Insufficient Data'
                                ? 'neutral'
                                : p.recommendation.recommendation === 'Pause'
                                  ? 'neg'
                                  : 'info'
                          }
                        >
                          {p.recommendation.recommendation}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No projects registered yet."
              hint="Add a folder on the right. Token events whose working directory sits inside it will be attributed automatically."
            />
          )}
        </Panel>

        <AddProjectForm homeDir={os.homedir()} />
      </div>

      <div className="mt-2.5 scroll-mt-24" id="unassigned">
        <Panel
          title="Unassigned Sessions"
          subtitle={`${compactNumber(unassigned.tokens)} tokens · ${money(unassigned.cost)} across ${unassigned.sessions} sessions with no matching project`}
        >
          <UnassignedList sessions={orphans} projects={rows.map((r) => ({ id: r.id, name: r.name }))} />
        </Panel>
      </div>
    </>
  );
}
