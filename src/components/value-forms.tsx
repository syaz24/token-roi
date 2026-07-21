'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Badge, Button, Empty, Field, Input, Panel, Select } from './ui';
import { addValueEvent, deleteValueEvent } from '@/app/actions';
import type { ValueRow } from '@/lib/queries';
import { money, shortDate } from '@/lib/format';

const VALUE_TYPES = [
  ['realised_revenue', 'Realised revenue'],
  ['recurring_revenue', 'Recurring monthly revenue'],
  ['one_time_sale', 'One-time sale'],
  ['cost_savings', 'Cost savings'],
  ['contractor_avoided', 'Contractor cost avoided'],
  ['hours_saved', 'Development hours saved (value)'],
  ['hourly_value', 'Hourly value of saved time'],
  ['business_valuation', 'Business valuation attributable'],
  ['strategic_value', 'Estimated strategic value'],
  ['investment_raised', 'Investment raised attributable'],
  ['manual_adjustment', 'Manual adjustment'],
] as const;

export function ValueForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [recurring, setRecurring] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const form = e.currentTarget;
    try {
      const fd = new FormData(form);
      fd.set('projectId', projectId);
      const r = await addValueEvent(fd);
      setMsg(r);
      if (r.ok) {
        form.reset();
        setRecurring(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Record Value" subtitle="Value is never one unexplained number">
      <form onSubmit={onSubmit} className="space-y-2.5">
        <Field label="Value type">
          <Select name="valueType" defaultValue="realised_revenue" className="w-full">
            {VALUE_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount (USD)">
            <Input name="amount" type="number" step="0.01" required placeholder="2500" />
          </Field>
          <Field label="Date">
            <Input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </Field>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-ink2">
          <input type="checkbox" name="realised" defaultChecked className="h-3 w-3 accent-[#34D399]" />
          Realised (uncheck for estimated value)
        </label>

        <label className="flex items-center gap-1.5 text-[11px] text-ink2">
          <input
            type="checkbox"
            name="recurring"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            className="h-3 w-3 accent-[#A78BFA]"
          />
          Recurring
        </label>

        {recurring && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Period">
              <Select name="recurrencePeriod" defaultValue="monthly" className="w-full">
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </Select>
            </Field>
            <Field label="Ends (optional)">
              <Input name="recurrenceEnd" type="date" />
            </Field>
          </div>
        )}

        <Field label="Confidence">
          <Select name="confidence" defaultValue="high" className="w-full">
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </Field>

        <Field label="Description">
          <Input name="description" placeholder="Enterprise onboarding fee" maxLength={300} />
        </Field>

        <Field label="Supporting note">
          <Input name="note" placeholder="Optional evidence or reasoning" maxLength={1000} />
        </Field>

        <Field label="Evidence reference" hint="URL or local file reference">
          <Input name="evidenceRef" placeholder="Optional" maxLength={500} />
        </Field>

        <Button type="submit" variant="primary" disabled={busy} className="w-full">
          {busy ? 'Saving…' : 'Record value'}
        </Button>
        {msg && <p className={`text-[10.5px] ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.message}</p>}
      </form>
    </Panel>
  );
}

export function ValueList({ rows }: { rows: ValueRow[] }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  if (!rows.length) {
    return <Empty title="No value recorded for this project." hint="Add realised or estimated value on the right to enable ROI calculation." />;
  }

  async function remove(id: string) {
    setPending(id);
    try {
      await deleteValueEvent(id);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-[11px]">
        <thead>
          <tr className="border-b border-hair text-left">
            <th className="label-xs px-3.5 py-1.5 font-medium">Date</th>
            <th className="label-xs px-2 py-1.5 font-medium">Type</th>
            <th className="label-xs px-2 py-1.5 text-right font-medium">Amount</th>
            <th className="label-xs px-2 py-1.5 font-medium">Basis</th>
            <th className="label-xs px-2 py-1.5 font-medium">Confidence</th>
            <th className="label-xs px-2 py-1.5 font-medium">Description</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {rows.map((v) => (
            <tr key={v.id} className="hover:bg-white/[0.03]">
              <td className="mono px-3.5 py-1.5 text-ink3">{shortDate(v.date)}</td>
              <td className="px-2 py-1.5 text-ink2">
                {v.valueType.replace(/_/g, ' ')}
                {v.recurring ? <span className="ml-1 text-[10px] text-roi">· {v.recurrencePeriod}</span> : null}
              </td>
              <td className="num px-2 py-1.5 text-right text-ink">{money(v.amount)}</td>
              <td className="px-2 py-1.5">
                <Badge tone={v.realised ? 'pos' : 'warn'}>{v.realised ? 'Realised' : 'Estimated'}</Badge>
              </td>
              <td className="px-2 py-1.5 text-ink3">{v.confidence}</td>
              <td className="max-w-[200px] truncate px-2 py-1.5 text-ink3">{v.description ?? '—'}</td>
              <td className="px-2 py-1.5 text-right">
                <Button size="xs" variant="ghost" disabled={pending === v.id} onClick={() => remove(v.id)} title="Remove">
                  <Trash2 size={10} />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
