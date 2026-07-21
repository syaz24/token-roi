'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, cn, Empty, Field, Input, Panel, Select } from './ui';
import { deleteSubscription, saveSubscription } from '@/app/actions';
import { monthlyCashCost } from '@/lib/roi/allocation';
import { CUSTOM_PRESET_ID, findPreset, SUBSCRIPTION_PRESETS } from '@/lib/subscriptions/presets';
import type { SubRow } from '@/lib/queries';
import { money, shortDate } from '@/lib/format';

const METHODS: Array<[string, string, string]> = [
  ['token_share', 'Token share', 'Split by each project’s share of tokens in the billing month.'],
  ['session_share', 'Session share', 'Split by each project’s share of distinct sessions.'],
  ['active_day_share', 'Active-day share', 'Split by the number of days each project was worked on.'],
  ['equal', 'Equal split', 'Divide equally across every project with usage.'],
  ['manual_pct', 'Manual percentages', 'You set the percentages. Anything under 100% stays unallocated.'],
  ['direct', 'Direct assignment', 'The whole plan cost belongs to one project.'],
];

export function SubscriptionsPanel({
  subs,
  projects,
}: {
  subs: SubRow[];
  projects: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<SubRow | 'new' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [method, setMethod] = React.useState('token_share');

  const current = editing === 'new' ? null : editing;

  // Preset selection is a convenience only: it seeds the fields below, which
  // stay fully editable. Switching to Custom never clears what you typed.
  const [preset, setPreset] = React.useState(CUSTOM_PRESET_ID);
  const [provider, setProvider] = React.useState('');
  const [planName, setPlanName] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [seats, setSeats] = React.useState('1');
  const [cycle, setCycle] = React.useState('monthly');

  React.useEffect(() => {
    if (editing && editing !== 'new') {
      setMethod(editing.allocationMethod);
      setProvider(editing.provider);
      setPlanName(editing.planName);
      setPrice(String(editing.monthlyPrice));
      setSeats(String(editing.seats));
      setCycle(editing.billingCycle);
      setPreset(CUSTOM_PRESET_ID);
    }
    if (editing === 'new') {
      setMethod('token_share');
      setProvider('');
      setPlanName('');
      setPrice('');
      setSeats('1');
      setCycle('monthly');
      setPreset(CUSTOM_PRESET_ID);
    }
  }, [editing]);

  function applyPreset(id: string) {
    setPreset(id);
    const p = findPreset(id);
    if (!p) return;
    setProvider(p.provider);
    setPlanName(p.planName);
    setPrice(String(p.price));
    setCycle(p.cycle);
    if (!p.perSeat) setSeats('1');
  }

  const presetInfo = findPreset(preset);
  const oneTime = cycle === 'one_time';

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await saveSubscription(current?.id ?? null, new FormData(e.currentTarget));
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
      setMsg(await deleteSubscription(id));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // One-time purchases are not part of a monthly run rate; count them separately.
  const recurring = subs.filter((s) => s.active && s.billingCycle !== 'one_time');
  const totalMonthly = recurring.reduce((sum, s) => sum + monthlyCashCost(s), 0);
  const oneTimeCount = subs.filter((s) => s.active && s.billingCycle === 'one_time').length;

  return (
    <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3">
      <Panel
        title="Subscriptions"
        subtitle={`${money(totalMonthly)} per month across ${recurring.length} recurring plan${
          recurring.length === 1 ? '' : 's'
        }${oneTimeCount ? ` · ${oneTimeCount} one-time purchase${oneTimeCount === 1 ? '' : 's'}` : ''}`}
        className="xl:col-span-2"
        right={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={10} />
            Add plan
          </Button>
        }
        bodyClassName="p-0"
      >
        {subs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-[11px]">
              <thead>
                <tr className="border-b border-hair text-left">
                  <th className="label-xs px-3.5 py-1.5 font-medium">Plan</th>
                  <th className="label-xs px-2 py-1.5 text-right font-medium">Price</th>
                  <th className="label-xs px-2 py-1.5 text-right font-medium">Effective/mo</th>
                  <th className="label-xs px-2 py-1.5 font-medium">Cycle</th>
                  <th className="label-xs px-2 py-1.5 font-medium">Allocation</th>
                  <th className="label-xs px-2 py-1.5 font-medium">Billing from</th>
                  <th className="label-xs px-2 py-1.5 font-medium">Status</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {subs.map((s) => (
                  <tr key={s.id} className="hover:bg-white/[0.03]">
                    <td className="px-3.5 py-1.5">
                      <span className="text-ink">{s.provider}</span>
                      <span className="text-ink3"> · {s.planName}</span>
                      {s.seats > 1 && <span className="text-ink3"> ×{s.seats}</span>}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-ink2">{money(s.monthlyPrice)}</td>
                    <td className="num px-2 py-1.5 text-right text-ink">
                      {s.billingCycle === 'one_time' ? (
                        <span className="text-ink3" title="Charged once, in the month of purchase">
                          once
                        </span>
                      ) : (
                        money(monthlyCashCost(s))
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-ink3">
                      {s.billingCycle === 'one_time' ? 'one-time' : s.billingCycle}
                    </td>
                    <td className="px-2 py-1.5 text-ink3">{s.allocationMethod.replace(/_/g, ' ')}</td>
                    <td className="mono px-2 py-1.5 text-ink3">{shortDate(s.billingStart)}</td>
                    <td className="px-2 py-1.5">
                      <Badge tone={s.active ? 'pos' : 'neutral'}>{s.active ? 'active' : 'inactive'}</Badge>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex justify-end gap-0.5">
                        <Button size="xs" variant="ghost" onClick={() => setEditing(s)}>
                          Edit
                        </Button>
                        <Button size="xs" variant="ghost" disabled={busy} onClick={() => remove(s.id)}>
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
          <Empty
            title="No subscriptions configured."
            hint="Without a plan, the Allocated Cash and Blended cost bases are zero and only API-equivalent cost is meaningful."
          />
        )}
      </Panel>

      <Panel title={editing === 'new' ? 'Add Plan' : editing ? 'Edit Plan' : 'Allocation Methods'}>
        {editing ? (
          <form onSubmit={submit} className="space-y-2.5" key={current?.id ?? 'new'}>
            <Field
              label="Common plans"
              hint="Indicative prices only — confirm against your invoice, then edit anything below."
            >
              <Select
                id="subscription-preset"
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
                className="w-full"
              >
                <option value={CUSTOM_PRESET_ID}>Custom plan…</option>
                {SUBSCRIPTION_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.provider} · ${p.planName} — $${p.price}${
                      p.cycle === 'one_time' ? ' one-time' : p.cycle === 'annual' ? '/yr' : '/mo'
                    }${p.perSeat ? ' per seat' : ''}`}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Provider">
                <Input
                  name="provider"
                  required
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="Anthropic"
                />
              </Field>
              <Field label="Plan name">
                <Input
                  name="planName"
                  required
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="Claude Max"
                />
              </Field>
            </div>

            {/* Recurring vs one-time. A one-time purchase is charged only in
                the month of its billing start, never spread across months. */}
            <Field label="Billing type">
              <div className="flex gap-0.5 rounded-md border border-hair p-0.5">
                {[
                  ['recurring', 'Recurring'],
                  ['one_time', 'One-time'],
                ].map(([v, l]) => {
                  const active = v === 'one_time' ? oneTime : !oneTime;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setCycle(v === 'one_time' ? 'one_time' : 'monthly')}
                      className={cn(
                        'flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                        active ? 'bg-white/[0.09] text-ink' : 'text-ink3 hover:text-ink2',
                      )}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label={oneTime ? 'Amount (USD)' : 'Price (USD)'}>
                <Input
                  name="monthlyPrice"
                  type="number"
                  step="0.01"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </Field>
              {oneTime ? (
                <Field label="Charged" hint="Once, in the month below">
                  <Input value="One-time purchase" disabled readOnly className="opacity-60" />
                </Field>
              ) : (
                <Field label="Billing cycle">
                  <Select name="billingCycle" value={cycle} onChange={(e) => setCycle(e.target.value)} className="w-full">
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </Select>
                </Field>
              )}
            </div>
            {oneTime && <input type="hidden" name="billingCycle" value="one_time" />}

            <div className="grid grid-cols-3 gap-2">
              <Field label="Seats">
                <Input
                  name="seats"
                  type="number"
                  min="1"
                  value={seats}
                  onChange={(e) => setSeats(e.target.value)}
                />
              </Field>
              <Field label="Tax %">
                <Input name="taxPct" type="number" step="0.1" defaultValue={current?.taxPct ?? 0} />
              </Field>
              <Field label="Discount %">
                <Input name="discountPct" type="number" step="0.1" defaultValue={current?.discountPct ?? 0} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label={oneTime ? 'Purchase date' : 'Billing start'}>
                <Input name="billingStart" type="date" required defaultValue={(current?.billingStart ?? '').slice(0, 10)} />
              </Field>
              {!oneTime && (
                <Field label="Billing end" hint="Blank = ongoing">
                  <Input name="billingEnd" type="date" defaultValue={(current?.billingEnd ?? '').slice(0, 10)} />
                </Field>
              )}
            </div>

            {presetInfo?.note && <p className="text-[10px] leading-relaxed text-ink3">{presetInfo.note}</p>}

            <Field label="Allocation method">
              <Select
                name="allocationMethod"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full"
              >
                {METHODS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-[10px] leading-relaxed text-ink3">
              {METHODS.find(([v]) => v === method)?.[2]}
            </p>

            {(method === 'manual_pct' || method === 'direct') && (
              <Field
                label="Allocation config (JSON)"
                hint={
                  method === 'direct'
                    ? 'e.g. {"projectId":"<id>"}'
                    : 'e.g. {"percentages":{"<projectId>":60,"<otherId>":40}}'
                }
              >
                <Input name="allocationConfig" defaultValue={current?.allocationConfig ?? '{}'} className="mono" />
              </Field>
            )}
            {method !== 'manual_pct' && method !== 'direct' && (
              <input type="hidden" name="allocationConfig" value={current?.allocationConfig ?? '{}'} />
            )}

            {(method === 'manual_pct' || method === 'direct') && projects.length > 0 && (
              <div className="rounded border border-hair bg-black/25 p-2">
                <span className="label-xs">Project IDs</span>
                <ul className="mt-1 space-y-0.5">
                  {projects.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 text-[10px]">
                      <span className="truncate text-ink2">{p.name}</span>
                      <span className="mono shrink-0 text-ink3">{p.id.slice(0, 8)}…</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Field label="Notes">
              <Input name="notes" defaultValue={current?.notes ?? ''} />
            </Field>

            <label className="flex items-center gap-1.5 text-[11px] text-ink2">
              <input type="checkbox" name="active" defaultChecked={current ? !!current.active : true} className="h-3 w-3 accent-[#34D399]" />
              Active
            </label>

            <div className="flex gap-1.5">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save plan'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
            {msg && <p className={`text-[10.5px] ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.message}</p>}
          </form>
        ) : (
          <>
            <ul className="space-y-2">
              {METHODS.map(([v, l, d]) => (
                <li key={v} className="border-b border-hair pb-2 text-[11px] last:border-0">
                  <span className="text-ink">{l}</span>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink3">{d}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink3">
              Cost that maps to unassigned sessions, or that manual percentages leave uncovered, is reported as
              unallocated rather than being quietly redistributed onto your projects.
            </p>
            {msg && <p className={`mt-2 text-[10.5px] ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.message}</p>}
          </>
        )}
      </Panel>
    </div>
  );
}
