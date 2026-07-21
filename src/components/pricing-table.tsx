'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Empty, Field, Input, Panel } from './ui';
import { deletePricing, savePricing } from '@/app/actions';
import { shortDate } from '@/lib/format';

export interface PriceRowUi {
  id: string;
  provider: string;
  modelId: string;
  aliases: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  reasoningPerMTok: number | null;
  sourceNote: string | null;
  userOverride: number;
}

export function PricingTable({ rows }: { rows: PriceRowUi[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<PriceRowUi | 'new' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; message: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const id = editing === 'new' || editing == null ? null : editing.id;
      const r = await savePricing(id, new FormData(e.currentTarget));
      setMsg(r);
      if (r.ok) {
        setEditing(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      setMsg(await deletePricing(id));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const current = editing === 'new' ? null : editing;

  return (
    <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3">
      <Panel
        title="Model Pricing Registry"
        subtitle="USD per 1 million tokens · resolved by the date of each event"
        className="xl:col-span-2"
        right={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={10} />
            Add row
          </Button>
        }
        bodyClassName="p-0"
      >
        {rows.length ? (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[820px] text-[11px]">
              <thead className="sticky top-0 bg-[rgba(17,17,23,0.98)]">
                <tr className="border-b border-hair text-left">
                  <th className="label-xs px-3.5 py-1.5 font-medium">Model</th>
                  <th className="label-xs px-2 py-1.5 font-medium">Provider</th>
                  <th className="label-xs px-2 py-1.5 font-medium">Effective</th>
                  <th className="label-xs px-2 py-1.5 text-right font-medium">In</th>
                  <th className="label-xs px-2 py-1.5 text-right font-medium">Out</th>
                  <th className="label-xs px-2 py-1.5 text-right font-medium">C-read</th>
                  <th className="label-xs px-2 py-1.5 text-right font-medium">C-write</th>
                  <th className="label-xs px-2 py-1.5 font-medium">Source</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-white/[0.03]">
                    <td className="mono px-3.5 py-1.5 text-ink">
                      {r.modelId}
                      {safeAliases(r.aliases).length > 0 && (
                        <div className="text-[9.5px] text-ink3">{safeAliases(r.aliases).join(', ')}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-ink3">{r.provider}</td>
                    <td className="mono px-2 py-1.5 text-ink3">
                      {shortDate(r.effectiveFrom)}
                      {r.effectiveTo ? ` → ${shortDate(r.effectiveTo)}` : ' →'}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-ink2">{r.inputPerMTok}</td>
                    <td className="num px-2 py-1.5 text-right text-ink2">{r.outputPerMTok}</td>
                    <td className="num px-2 py-1.5 text-right text-ink3">{r.cacheReadPerMTok}</td>
                    <td className="num px-2 py-1.5 text-right text-ink3">{r.cacheWritePerMTok}</td>
                    <td className="px-2 py-1.5">
                      {r.userOverride ? <Badge tone="roi">yours</Badge> : <Badge>bundled</Badge>}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex justify-end gap-0.5">
                        <Button size="xs" variant="ghost" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        <Button size="xs" variant="ghost" disabled={busy} onClick={() => remove(r.id)}>
                          <Trash2 size={10} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No pricing rows." hint="Without pricing, every model is reported as unpriced." />
        )}
      </Panel>

      <Panel title={editing === 'new' ? 'Add Pricing Row' : editing ? 'Edit Pricing Row' : 'Pricing Notes'}>
        {editing ? (
          <form onSubmit={submit} className="space-y-2.5" key={editing === 'new' ? 'new' : editing.id}>
            <Field label="Provider">
              <Input name="provider" required defaultValue={current?.provider ?? ''} placeholder="anthropic" />
            </Field>
            <Field label="Canonical model ID">
              <Input name="modelId" required defaultValue={current?.modelId ?? ''} placeholder="claude-sonnet-5" />
            </Field>
            <Field label="Aliases" hint="Comma separated. Dated suffixes are matched automatically.">
              <Input name="aliases" defaultValue={safeAliases(current?.aliases ?? '[]').join(', ')} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Effective from">
                <Input name="effectiveFrom" type="date" required defaultValue={(current?.effectiveFrom ?? '2020-01-01').slice(0, 10)} />
              </Field>
              <Field label="Effective to" hint="Blank = still current">
                <Input name="effectiveTo" type="date" defaultValue={(current?.effectiveTo ?? '').slice(0, 10)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Input / 1M">
                <Input name="inputPerMTok" type="number" step="0.001" required defaultValue={current?.inputPerMTok ?? 0} />
              </Field>
              <Field label="Output / 1M">
                <Input name="outputPerMTok" type="number" step="0.001" required defaultValue={current?.outputPerMTok ?? 0} />
              </Field>
              <Field label="Cache read / 1M">
                <Input name="cacheReadPerMTok" type="number" step="0.001" defaultValue={current?.cacheReadPerMTok ?? 0} />
              </Field>
              <Field label="Cache write / 1M">
                <Input name="cacheWritePerMTok" type="number" step="0.001" defaultValue={current?.cacheWritePerMTok ?? 0} />
              </Field>
            </div>
            <Field
              label="Reasoning / 1M"
              hint="Leave blank unless your provider bills reasoning tokens separately from output."
            >
              <Input name="reasoningPerMTok" type="number" step="0.001" defaultValue={current?.reasoningPerMTok ?? ''} />
            </Field>
            <Field label="Source note">
              <Input name="sourceNote" defaultValue={current?.sourceNote ?? ''} placeholder="Provider pricing page, checked 2026-07" />
            </Field>
            <div className="flex gap-1.5">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save and re-price'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
            {msg && <p className={`text-[10.5px] ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.message}</p>}
          </form>
        ) : (
          <>
            <p className="text-[11px] leading-relaxed text-ink2">
              Every cost figure in this application comes from this table. Prices are resolved per event using the row
              whose effective window contains that event&apos;s timestamp, so historic costs stay correct after a price
              change — add a new row rather than editing the old one.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink3">
              Bundled rows are starting values only. Verify them against your provider&apos;s pricing page and edit
              freely; your edits are marked as overrides and always win.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink3">
              A model with no matching row is reported as <span className="text-warn">unpriced</span>. Its tokens are
              still counted, but it is excluded from cost totals rather than silently priced at zero.
            </p>
            {msg && <p className={`mt-2 text-[10.5px] ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.message}</p>}
          </>
        )}
      </Panel>
    </div>
  );
}

function safeAliases(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
