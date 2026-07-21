import { PageHeader } from '@/components/shell';
import { Badge, Empty, Panel } from '@/components/ui';
import { SourceCard } from '@/components/source-card';
import { ADAPTERS, UNSUPPORTED_SOURCES } from '@/lib/adapters/registry';
import { raw } from '@/db/client';
import { getSetting } from '@/lib/settings';
import { dateTime, fullNumber, shortDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SourcesPage() {
  const dataset = (getSetting('dataset') ?? 'real') as 'real' | 'sample';

  const detections = await Promise.all(
    ADAPTERS.map(async (a) => ({
      id: a.id,
      name: a.name,
      verifiedNote: a.verifiedNote,
      detect: await a.detect(),
      completeness: a.reportCompleteness(),
    })),
  );

  const stats = new Map(
    (
      raw()
        .prepare(
          `SELECT source, COUNT(*) n, MIN(timestamp) lo, MAX(timestamp) hi
             FROM events WHERE dataset = 'real' GROUP BY source`,
        )
        .all() as any[]
    ).map((r) => [r.source as string, r]),
  );

  const enabled = new Map(
    (raw().prepare(`SELECT id, enabled, last_scan_at FROM sources`).all() as any[]).map((r) => [r.id as string, r]),
  );

  const runs = raw()
    .prepare(`SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 12`)
    .all() as any[];

  return (
    <>
      <PageHeader
        title="Data Sources"
        description="Only sources verified against real local files are offered. Verified sources are indexed automatically on first launch — you can turn that off in Settings › Scanning. History files are only ever read, never modified, and nothing leaves this machine."
      />

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 2xl:grid-cols-3">
        {detections.map((d) => (
          <SourceCard
            key={d.id}
            id={d.id}
            name={d.name}
            verifiedNote={d.verifiedNote}
            status={d.detect.status}
            rootPath={d.detect.rootPath}
            reason={d.detect.reason}
            fileCount={d.detect.fileCount ?? null}
            recordsIndexed={stats.get(d.id)?.n ?? 0}
            earliest={stats.get(d.id)?.lo ?? null}
            latest={stats.get(d.id)?.hi ?? null}
            lastScan={enabled.get(d.id)?.last_scan_at ?? null}
            enabled={enabled.get(d.id)?.enabled !== 0}
            fields={d.completeness.fields}
            missing={d.completeness.missing}
            percentage={d.completeness.percentage}
            caveats={d.completeness.caveats}
          />
        ))}
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        <Panel title="Scan History" subtitle="Every scan reports what it did, including what it could not read" bodyClassName="p-0">
          {runs.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[11px]">
                <thead>
                  <tr className="border-b border-hair text-left">
                    <th className="label-xs px-3.5 py-1.5 font-medium">Started</th>
                    <th className="label-xs px-2 py-1.5 font-medium">Source</th>
                    <th className="label-xs px-2 py-1.5 font-medium">Status</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Files</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Added</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Skipped</th>
                    <th className="label-xs px-2 py-1.5 text-right font-medium">Errors</th>
                    <th className="label-xs px-3.5 py-1.5 text-right font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hair">
                  {runs.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.03]">
                      <td className="mono px-3.5 py-1.5 text-ink3">{dateTime(r.started_at)}</td>
                      <td className="px-2 py-1.5 text-ink2">{r.source}</td>
                      <td className="px-2 py-1.5">
                        <Badge
                          tone={
                            r.status === 'completed'
                              ? 'pos'
                              : r.status === 'cancelled'
                                ? 'warn'
                                : r.status === 'running'
                                  ? 'info'
                                  : 'neg'
                          }
                        >
                          {r.status.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="num px-2 py-1.5 text-right text-ink2">{fullNumber(r.files_scanned)}</td>
                      <td className="num px-2 py-1.5 text-right text-pos">{fullNumber(r.records_added)}</td>
                      <td className="num px-2 py-1.5 text-right text-ink3">{fullNumber(r.records_skipped)}</td>
                      <td className={`num px-2 py-1.5 text-right ${r.error_count ? 'text-neg' : 'text-ink3'}`}>
                        {fullNumber(r.error_count)}
                      </td>
                      <td className="num px-3.5 py-1.5 text-right text-ink3">{r.duration_ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No scans yet." hint="Run a scan from a source card above, or use the Refresh button in the top bar." />
          )}
        </Panel>

        <Panel
          title="Investigated but Not Supported"
          subtitle="An absent adapter is an explained decision, not a silent gap"
        >
          <ul className="space-y-2">
            {UNSUPPORTED_SOURCES.map((s) => (
              <li key={s.id} className="border-b border-hair pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] font-medium text-ink">{s.name}</span>
                  <Badge>not implemented</Badge>
                </div>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink3">{s.reason}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] leading-relaxed text-ink3">
            No adapter is registered until its format has been confirmed against a real local file. The presence of a
            vendor folder alone is never treated as support.
          </p>
        </Panel>
      </div>
    </>
  );
}
