import { PageHeader } from '@/components/shell';
import { Panel } from '@/components/ui';
import { TraceExplorer } from '@/components/trace-explorer';
import { ExportButton } from '@/components/export-button';
import { resolveFilters, str, type SearchParams } from '@/lib/params';
import { distinctValues, listEvents, projectUsage, type SessionFilters } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function SessionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const base = resolveFilters(sp);

  const f: SessionFilters = {
    ...base,
    source: str(sp.source),
    provider: str(sp.provider),
    model: str(sp.model),
    status: str(sp.status),
    minTokens: sp.minTokens ? Number(sp.minTokens) : null,
    minCost: sp.minCost ? Number(sp.minCost) : null,
    assigned: (str(sp.assigned) as any) ?? 'all',
    pricedOnly: (str(sp.priced) as any) ?? 'all',
    search: str(sp.q),
    limit: 100,
    cursor: str(sp.cursor),
  };

  const page = listEvents(f);
  const options = distinctValues(base.dataset);
  const projects = projectUsage(base).map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader
        title="Session & Trace Explorer"
        description="Every indexed request. Click a row for the full token breakdown, cost calculation and source reference. Prompt text is hidden by default."
        right={<ExportButton type="sessions" label="Export filtered CSV" />}
      />

      <Panel bodyClassName="p-0" title={`Traces`} subtitle={`${page.rows.length} rows on this page`}>
        <TraceExplorer
          rows={page.rows}
          nextCursor={page.nextCursor}
          options={options}
          projects={projects}
        />
      </Panel>
    </>
  );
}
