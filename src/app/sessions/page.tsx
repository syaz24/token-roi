import { PageHeader } from '@/components/shell';
import { Panel } from '@/components/ui';
import { TraceExplorer } from '@/components/trace-explorer';
import { SessionList } from '@/components/session-list';
import { ViewTabs } from '@/components/view-tabs';
import { ExportButton } from '@/components/export-button';
import { resolveFilters, str, type SearchParams } from '@/lib/params';
import {
  distinctValues,
  listEvents,
  listSessions,
  projectUsage,
  type SessionFilters,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function SessionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const base = resolveFilters(sp);
  const view = str(sp.view) === 'traces' ? 'traces' : 'conversations';

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
    limit: view === 'traces' ? 100 : 60,
    cursor: str(sp.cursor),
  };

  const options = distinctValues(base.dataset);
  const projects = projectUsage(base).map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader
        title="Sessions"
        description={
          view === 'conversations'
            ? 'Your conversations, ranked by token volume. Open one to see cost turn by turn and where context growth made it expensive.'
            : 'Every individual request. Click a row for the full token breakdown, cost calculation and source reference.'
        }
        right={
          <>
            <ViewTabs
              param="view"
              current={view}
              options={[
                { value: 'conversations', label: 'Conversations' },
                { value: 'traces', label: 'Traces' },
              ]}
            />
            <ExportButton type="sessions" label="Export CSV" />
          </>
        }
      />

      {view === 'conversations' ? (
        <Panel title="Conversations" bodyClassName="p-0">
          {(() => {
            const page = listSessions(f);
            return <SessionList rows={page.rows} nextCursor={page.nextCursor} />;
          })()}
        </Panel>
      ) : (
        <Panel title="Traces" subtitle="One row per request" bodyClassName="p-0">
          {(() => {
            const page = listEvents(f);
            return (
              <TraceExplorer
                rows={page.rows}
                nextCursor={page.nextCursor}
                options={options}
                projects={projects}
              />
            );
          })()}
        </Panel>
      )}
    </>
  );
}
