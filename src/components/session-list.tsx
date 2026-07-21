'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge, Button, Empty, Input, cn } from './ui';
import { SessionDetail } from './session-detail';
import type { SessionRow } from '@/lib/queries';
import { compactNumber, dateTime, money, shortDate } from '@/lib/format';

/**
 * Conversation-level view: one row per session rather than per request, which
 * is how people actually think about their usage.
 */
export function SessionList({
  rows,
  nextCursor,
}: {
  rows: SessionRow[];
  nextCursor: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = React.useState<SessionRow | null>(null);
  const [search, setSearch] = React.useState(sp.get('q') ?? '');

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(sp.toString());
      if (!value) next.delete(key);
      else next.set(key, value);
      if (key !== 'cursor') next.delete('cursor');
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, sp],
  );

  React.useEffect(() => {
    const current = sp.get('q') ?? '';
    if (search === current) return;
    const t = setTimeout(() => setParam('q', search || null), 350);
    return () => clearTimeout(t);
  }, [search, setParam, sp]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-hair p-2.5">
        <div className="min-w-[200px] flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts, models, projects…"
          />
        </div>
        <span className="text-[10.5px] text-ink3">{rows.length} conversations</span>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[11px]">
            <thead>
              <tr className="border-b border-hair text-left">
                <th className="label-xs px-3.5 py-1.5 font-medium">Date</th>
                <th className="label-xs px-2 py-1.5 font-medium">What you asked</th>
                <th className="label-xs px-2 py-1.5 font-medium">Model</th>
                <th className="label-xs px-2 py-1.5 text-right font-medium">Turns</th>
                <th className="label-xs px-2 py-1.5 text-right font-medium">Requests</th>
                <th className="label-xs px-2 py-1.5 text-right font-medium">Tools</th>
                <th className="label-xs px-2 py-1.5 text-right font-medium">Tokens</th>
                <th className="label-xs px-3.5 py-1.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hair">
              {rows.map((r) => (
                <tr
                  key={r.sessionId}
                  onClick={() => setOpen(r)}
                  className="cursor-pointer align-top transition-colors hover:bg-white/[0.03]"
                >
                  <td className="whitespace-nowrap px-3.5 py-2">
                    <div className="mono text-ink2">{shortDate(r.startedAt)}</div>
                    <div className="truncate text-[10px] text-ink3">
                      {r.projectName ?? <span className="text-ink3">unassigned</span>}
                    </div>
                  </td>
                  <td className="max-w-[380px] px-2 py-2">
                    {r.firstPrompt ? (
                      <span className="line-clamp-2 text-ink">{r.firstPrompt}</span>
                    ) : (
                      <span className="text-ink3">
                        no prompt recorded{' '}
                        <span className="text-[10px]">({r.source} does not expose one)</span>
                      </span>
                    )}
                  </td>
                  <td className="mono max-w-[130px] truncate px-2 py-2 text-ink2">{r.model ?? '—'}</td>
                  <td className="num px-2 py-2 text-right text-ink2">
                    {r.turns > 0 ? r.turns : <span className="text-ink3">—</span>}
                  </td>
                  <td className="num px-2 py-2 text-right text-ink3">{compactNumber(r.requests, 0)}</td>
                  <td className="num px-2 py-2 text-right text-ink3">
                    {r.toolUses > 0 ? compactNumber(r.toolUses, 0) : '—'}
                  </td>
                  <td className="num px-2 py-2 text-right text-ink">{compactNumber(r.tokens)}</td>
                  <td className="num px-3.5 py-2 text-right text-ink2">
                    {r.cost == null ? <span className="text-warn">unpriced</span> : money(r.cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No conversations match these filters." hint="Try widening the date range or clearing the search." />
      )}

      <div className="flex items-center justify-between gap-2 border-t border-hair p-2.5">
        <span className="text-[10.5px] text-ink3">Ranked by token volume. Click a row for the turn-by-turn breakdown.</span>
        <div className="flex gap-1.5">
          {sp.get('cursor') && <Button onClick={() => setParam('cursor', null)}>First page</Button>}
          <Button disabled={!nextCursor} onClick={() => nextCursor && setParam('cursor', nextCursor)}>
            Next page →
          </Button>
        </div>
      </div>

      {open && <SessionDetail session={open} onClose={() => setOpen(null)} />}
    </>
  );
}
