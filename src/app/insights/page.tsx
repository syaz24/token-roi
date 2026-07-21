import { PageHeader } from '@/components/shell';
import { Empty, Panel } from '@/components/ui';
import { InsightsList } from '@/components/insights-list';
import { ExpensivePrompts } from '@/components/expensive-prompts';
import { ShareStats } from '@/components/share-stats';
import { resolveFilters, type SearchParams } from '@/lib/params';
import { buildInsights } from '@/lib/insights/engine';
import { expensivePrompts, insightInputs } from '@/lib/insights/queries';
import { shareStats, totals } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function InsightsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = resolveFilters(sp);

  const t = totals(f);
  const insights = t.events > 0 ? buildInsights(insightInputs(f)) : [];
  const prompts = t.events > 0 ? expensivePrompts(f, 15) : [];
  const stats = shareStats(f);

  return (
    <>
      <PageHeader
        title="Insights"
        description="Patterns in how you actually use these tools, derived from your own indexed history. Every insight is a transparent rule over your numbers — no model is consulted."
        right={<ShareStats stats={stats} headline={insights[0]?.title ?? null} />}
      />

      {t.events === 0 ? (
        <Panel>
          <Empty
            title="Nothing indexed in this range."
            hint="Widen the date range, or check the Data Sources page to see what was detected on this machine."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <InsightsList insights={insights} />
          </div>
          <div className="xl:col-span-2">
            <ExpensivePrompts rows={prompts} />
          </div>
        </div>
      )}
    </>
  );
}
