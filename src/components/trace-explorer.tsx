'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { Badge, Button, Empty, Input, Select, cn } from './ui';
import { SessionDrawer } from './session-drawer';
import type { EventRow } from '@/lib/queries';
import { compactNumber, dateTime, duration, money, truncateMid } from '@/lib/format';

export function TraceExplorer({
  rows,
  nextCursor,
  options,
  projects,
}: {
  rows: EventRow[];
  nextCursor: string | null;
  options: { sources: string[]; providers: string[]; models: string[]; statuses: string[] };
  projects: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [selected, setSelected] = React.useState<EventRow | null>(null);
  const [search, setSearch] = React.useState(sp.get('q') ?? '');

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(sp.toString());
      if (!value) next.delete(key);
      else next.set(key, value);
      next.delete('cursor'); // any filter change resets pagination
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, sp],
  );

  // Debounce the free-text search so each keystroke doesn't hit the database.
  React.useEffect(() => {
    const current = sp.get('q') ?? '';
    if (search === current) return;
    const t = setTimeout(() => setParam('q', search || null), 350);
    return () => clearTimeout(t);
  }, [search, setParam, sp]);

  const columns = React.useMemo<ColumnDef<EventRow>[]>(
    () => [
      {
        header: 'Timestamp',
        accessorKey: 'timestamp',
        cell: (c) => <span className="mono whitespace-nowrap text-ink3">{dateTime(c.getValue() as string)}</span>,
      },
      {
        header: 'Project',
        accessorKey: 'projectName',
        cell: (c) =>
          (c.getValue() as string) ?? <span className="text-ink3">unassigned</span>,
      },
      { header: 'Source', accessorKey: 'source', cell: (c) => <span className="text-ink3">{c.getValue() as string}</span> },
      {
        header: 'Model',
        accessorKey: 'model',
        cell: (c) => <span className="mono text-ink2">{(c.getValue() as string) ?? '—'}</span>,
      },
      {
        header: 'Tokens',
        accessorKey: 'totalTokens',
        meta: { right: true },
        cell: (c) => <span className="num text-ink">{compactNumber(c.getValue() as number)}</span>,
      },
      {
        header: 'API Cost',
        accessorKey: 'calculatedCostUsd',
        meta: { right: true },
        cell: (c) =>
          c.row.original.priced ? (
            <span className="num text-ink2">{money(c.getValue() as number)}</span>
          ) : (
            <span className="text-warn">unpriced</span>
          ),
      },
      {
        header: 'Duration',
        accessorKey: 'durationMs',
        meta: { right: true },
        cell: (c) => <span className="num text-ink3">{duration(c.getValue() as number | null)}</span>,
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: (c) => (
          <Badge tone={(c.getValue() as string) === 'ok' ? 'neutral' : 'neg'}>{c.getValue() as string}</Badge>
        ),
      },
      {
        header: 'Session ID',
        accessorKey: 'sessionId',
        cell: (c) => <span className="mono text-ink3">{truncateMid(c.getValue() as string, 18)}</span>,
      },
    ],
    [],
  );

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <>
      {/* ---- filter bar ---- */}
      <div className="flex flex-wrap items-end gap-1.5 border-b border-hair p-2.5">
        <div className="min-w-[180px] flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search session ID, model, project, prompt preview, source file, status…"
          />
        </div>

        <Select value={sp.get('project') ?? ''} onChange={(e) => setParam('project', e.target.value || null)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>

        <Select value={sp.get('source') ?? ''} onChange={(e) => setParam('source', e.target.value || null)}>
          <option value="">All sources</option>
          {options.sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <Select value={sp.get('provider') ?? ''} onChange={(e) => setParam('provider', e.target.value || null)}>
          <option value="">All providers</option>
          {options.providers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <Select value={sp.get('model') ?? ''} onChange={(e) => setParam('model', e.target.value || null)}>
          <option value="">All models</option>
          {options.models.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <Select value={sp.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value || null)}>
          <option value="">Any status</option>
          {options.statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <Select value={sp.get('assigned') ?? 'all'} onChange={(e) => setParam('assigned', e.target.value)}>
          <option value="all">Assigned or not</option>
          <option value="assigned">Assigned only</option>
          <option value="unassigned">Unassigned only</option>
        </Select>

        <Select value={sp.get('priced') ?? 'all'} onChange={(e) => setParam('priced', e.target.value)}>
          <option value="all">Priced or not</option>
          <option value="priced">Priced only</option>
          <option value="unpriced">Unpriced only</option>
        </Select>

        <Input
          type="number"
          placeholder="Min tokens"
          defaultValue={sp.get('minTokens') ?? ''}
          onBlur={(e) => setParam('minTokens', e.target.value || null)}
          className="w-24"
        />
        <Input
          type="number"
          step="0.01"
          placeholder="Min cost"
          defaultValue={sp.get('minCost') ?? ''}
          onBlur={(e) => setParam('minCost', e.target.value || null)}
          className="w-24"
        />

        <Button
          variant="ghost"
          onClick={() => router.push(pathname)}
          title="Clear all filters"
        >
          Reset
        </Button>
      </div>

      {/* ---- table ---- */}
      {rows.length ? (
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
          <table className="w-full min-w-[1000px] text-[11px]">
            <thead className="sticky top-0 z-10 bg-[rgba(17,17,23,0.98)]">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-hair text-left">
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className={cn(
                        'label-xs whitespace-nowrap px-2 py-1.5 font-medium',
                        (h.column.columnDef.meta as any)?.right && 'text-right',
                      )}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-hair">
              {table.getRowModel().rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r.original)}
                  className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                >
                  {r.getVisibleCells().map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        'max-w-[220px] truncate px-2 py-1.5 text-ink2',
                        (c.column.columnDef.meta as any)?.right && 'text-right',
                      )}
                    >
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right text-ink3">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No traces match these filters." hint="Try resetting the filters or widening the date range." />
      )}

      {/* ---- pagination ---- */}
      <div className="flex items-center justify-between gap-2 border-t border-hair p-2.5">
        <span className="text-[10.5px] text-ink3">
          Cursor pagination keeps memory flat regardless of how many events are indexed.
        </span>
        <div className="flex gap-1.5">
          {sp.get('cursor') && (
            <Button onClick={() => setParam('cursor', null)}>First page</Button>
          )}
          <Button disabled={!nextCursor} onClick={() => nextCursor && setParam('cursor', nextCursor)}>
            Next page →
          </Button>
        </div>
      </div>

      {selected && <SessionDrawer row={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
