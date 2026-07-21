'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Empty, Panel } from './ui';
import { SessionDrawer } from './session-drawer';
import type { EventRow } from '@/lib/queries';
import { compactNumber, dateTime, duration, money, truncateMid } from '@/lib/format';

export function RecentSessions({ rows, title = 'Recent Sessions and Traces' }: { rows: EventRow[]; title?: string }) {
  const [selected, setSelected] = React.useState<EventRow | null>(null);

  return (
    <>
      <Panel
        title={title}
        subtitle={`${rows.length} most recent requests`}
        right={
          <Link href="/sessions" className="text-[10px] text-ink3 hover:text-ink">
            Open explorer →
          </Link>
        }
        bodyClassName="p-0"
      >
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[11px]">
              <thead>
                <tr className="border-b border-hair text-left">
                  {['Timestamp', 'Project', 'Source', 'Model', 'Tokens', 'API Cost', 'Duration', 'Status', 'Session'].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`label-xs whitespace-nowrap py-1.5 font-medium ${
                          i === 0 ? 'pl-3.5' : ''
                        } ${['Tokens', 'API Cost', 'Duration'].includes(h) ? 'text-right' : ''} px-2`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {rows.map((r) => (
                  <tr
                    key={r.eventId}
                    onClick={() => setSelected(r)}
                    className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                  >
                    <td className="mono whitespace-nowrap py-1.5 pl-3.5 pr-2 text-ink3">{dateTime(r.timestamp)}</td>
                    <td className="max-w-[150px] truncate px-2 py-1.5 text-ink2">
                      {r.projectName ?? <span className="text-ink3">unassigned</span>}
                    </td>
                    <td className="px-2 py-1.5 text-ink3">{r.source}</td>
                    <td className="mono max-w-[150px] truncate px-2 py-1.5 text-ink2">{r.model ?? '—'}</td>
                    <td className="num px-2 py-1.5 text-right text-ink">{compactNumber(r.totalTokens)}</td>
                    <td className="num px-2 py-1.5 text-right text-ink2">
                      {r.priced ? money(r.calculatedCostUsd) : <span className="text-warn">unpriced</span>}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-ink3">{duration(r.durationMs)}</td>
                    <td className="px-2 py-1.5">
                      <Badge tone={r.status === 'ok' ? 'neutral' : 'neg'}>{r.status}</Badge>
                    </td>
                    <td className="mono px-2 py-1.5 text-ink3">{truncateMid(r.sessionId, 16)}</td>
                    <td className="px-2 py-1.5 text-right text-ink3">›</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No sessions in this range." />
        )}
      </Panel>

      {selected && <SessionDrawer row={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
