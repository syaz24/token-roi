'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, FlaskConical } from 'lucide-react';
import { Badge, Button, Field, Input, Panel, Select } from './ui';
import {
  clearAllIndexedData,
  clearSampleData,
  loadSampleData,
  remap,
  reprice,
  saveSettings,
  setDataset,
} from '@/app/actions';
import { fullNumber } from '@/lib/format';

function useSaver() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; message: string } | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      setMsg(await saveSettings(new FormData(e.currentTarget)));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, submit, setMsg, setBusy, router };
}

function SaveRow({ busy, msg }: { busy: boolean; msg: { ok: boolean; message: string } | null }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
      {msg && <span className={`text-[10.5px] ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.message}</span>}
    </div>
  );
}

export function GeneralSettings({ settings }: { settings: Record<string, string> }) {
  const { busy, msg, submit } = useSaver();
  return (
    <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
      <Panel title="General">
        <form onSubmit={submit} className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Base currency" hint="All stored money is USD">
              <Select name="general.baseCurrency" defaultValue={settings['general.baseCurrency']} className="w-full">
                <option value="USD">USD</option>
              </Select>
            </Field>
            <Field label="Display currency">
              <Select name="general.displayCurrency" defaultValue={settings['general.displayCurrency']} className="w-full">
                <option value="USD">USD</option>
                <option value="MYR">MYR</option>
              </Select>
            </Field>
          </div>
          <Field
            label="USD → MYR rate"
            hint="Entered manually. Rates are never fetched from the internet."
          >
            <Input name="general.usdToMyr" type="number" step="0.0001" defaultValue={settings['general.usdToMyr']} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date format">
              <Select name="general.dateFormat" defaultValue={settings['general.dateFormat']} className="w-full">
                <option value="yyyy-MM-dd">2026-07-21</option>
                <option value="dd/MM/yyyy">21/07/2026</option>
                <option value="MM/dd/yyyy">07/21/2026</option>
              </Select>
            </Field>
            <Field label="Week starts on">
              <Select name="general.weekStart" defaultValue={settings['general.weekStart']} className="w-full">
                <option value="monday">Monday</option>
                <option value="sunday">Sunday</option>
              </Select>
            </Field>
          </div>
          <Field label="Default time range">
            <Select name="general.defaultRange" defaultValue={settings['general.defaultRange']} className="w-full">
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
              <option value="365d">1 year</option>
              <option value="all">All time</option>
            </Select>
          </Field>
          <Field label="Default cost basis">
            <Select name="costBasis" defaultValue={settings.costBasis} className="w-full">
              <option value="api_equivalent">API Equivalent</option>
              <option value="allocated_cash">Allocated Cash</option>
              <option value="blended">Blended</option>
            </Select>
          </Field>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </Panel>

      <Panel title="Currency Notes">
        <p className="text-[11px] leading-relaxed text-ink2">
          Every monetary value is stored in USD, because that is the currency your providers bill token usage in.
          Selecting a display currency converts figures at render time using the manual rate above — the underlying data
          is never rewritten, so changing the rate can never corrupt your history.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink3">
          Exchange rates are deliberately not fetched automatically. That would require a network call, which this
          application does not make.
        </p>
      </Panel>
    </div>
  );
}

export function AppearanceSettings({ settings }: { settings: Record<string, string> }) {
  const { busy, msg, submit } = useSaver();
  return (
    <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
      <Panel title="Appearance">
        <form onSubmit={submit} className="space-y-2.5">
          <Field
            label="Wallpaper"
            hint="Use 'default' for the bundled scene, 'none' for plain black, or a local file URL."
          >
            <Input name="appearance.wallpaper" defaultValue={settings['appearance.wallpaper']} placeholder="default" />
          </Field>
          <Field label={`Wallpaper opacity (${settings['appearance.wallpaperOpacity']})`}>
            <Input
              name="appearance.wallpaperOpacity"
              type="number"
              step="0.05"
              min="0"
              max="1"
              defaultValue={settings['appearance.wallpaperOpacity']}
            />
          </Field>
          <Field label={`Panel opacity (${settings['appearance.panelOpacity']})`}>
            <Input
              name="appearance.panelOpacity"
              type="number"
              step="0.02"
              min="0.5"
              max="1"
              defaultValue={settings['appearance.panelOpacity']}
            />
          </Field>
          <Field label="Compact mode">
            <Select name="appearance.compact" defaultValue={settings['appearance.compact']} className="w-full">
              <option value="false">Comfortable</option>
              <option value="true">Compact</option>
            </Select>
          </Field>
          <Field label="Reduce motion">
            <Select name="appearance.reduceMotion" defaultValue={settings['appearance.reduceMotion']} className="w-full">
              <option value="false">Allow transitions</option>
              <option value="true">Reduce motion</option>
            </Select>
          </Field>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </Panel>

      <Panel title="Theme">
        <p className="text-[11px] leading-relaxed text-ink2">
          The interface uses a single dark telemetry theme built for long analytical sessions: a near-black shell
          suspended over a scenic backdrop, thin hairline borders, and strong tabular numerals so figures stay
          comparable down a column.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink3">
          Typography uses your operating system&apos;s own font stack. No fonts, stylesheets, scripts or images are
          fetched from the internet, so the interface renders identically offline.
        </p>
      </Panel>
    </div>
  );
}

export function PrivacySettings({ settings, rules }: { settings: Record<string, string>; rules: string[] }) {
  const { busy, msg, submit } = useSaver();
  return (
    <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
      <Panel title="Privacy">
        <form onSubmit={submit} className="space-y-2.5">
          <Field
            label="Prompt storage policy"
            hint="Applies to future scans. Re-index a source after changing this to apply it to existing records."
          >
            <Select name="privacy.promptPolicy" defaultValue={settings['privacy.promptPolicy']} className="w-full">
              <option value="none">Never store prompt text</option>
              <option value="preview">Store a short redacted preview (default)</option>
              <option value="full">Store full local prompt text</option>
            </Select>
          </Field>
          <Field label="Show source file paths in the UI">
            <Select name="privacy.showSourceFiles" defaultValue={settings['privacy.showSourceFiles']} className="w-full">
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </Select>
          </Field>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </Panel>

      <Panel title="Redaction Rules" subtitle="Applied before any prompt text is written to disk">
        <div className="flex flex-wrap gap-1">
          {rules.map((r) => (
            <Badge key={r}>{r}</Badge>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-ink2">
          Prompt previews are truncated and passed through these patterns before storage, and are blurred in the trace
          drawer until you explicitly reveal them.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink3">
          Redaction reduces risk but is not a guarantee. If your prompts routinely contain secrets, choose &ldquo;Never
          store prompt text&rdquo; and re-index.
        </p>
      </Panel>
    </div>
  );
}

export function SettingsForm({ settings }: { settings: Record<string, string> }) {
  const { busy, msg, submit, setMsg, setBusy, router } = useSaver();

  async function act(fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    try {
      setMsg(await fn());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Scanning">
      <form onSubmit={submit} className="space-y-2.5">
        <Field
          label="Automatic indexing"
          hint="When on, verified local sources are indexed on first launch so the app is useful immediately."
        >
          <Select name="scan.auto" defaultValue={settings['scan.auto'] ?? 'true'} className="w-full">
            <option value="true">On — index my local AI history automatically</option>
            <option value="false">Off — only scan when I click Rescan</option>
          </Select>
        </Field>
        <Field
          label="Re-index interval"
          hint="How often an already-indexed database refreshes in the background. Manual keeps it to the Refresh button."
        >
          <Select name="scan.autoRefreshMinutes" defaultValue={settings['scan.autoRefreshMinutes']} className="w-full">
            <option value="0">Manual only</option>
            <option value="15">Every 15 minutes</option>
            <option value="60">Hourly</option>
            <option value="360">Every 6 hours</option>
          </Select>
        </Field>
        <Field label="Maximum file size (MB)" hint="Files larger than this are skipped and reported.">
          <Input name="scan.maxFileSizeMb" type="number" min="1" defaultValue={settings['scan.maxFileSizeMb']} />
        </Field>
        <SaveRow busy={busy} msg={msg} />
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-hair pt-3">
        <Button disabled={busy} onClick={() => act(reprice)}>
          Re-price all events
        </Button>
        <Button disabled={busy} onClick={() => act(remap)}>
          Re-map projects
        </Button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-ink3">
        Re-pricing recalculates every stored event against the current pricing registry. Re-mapping re-applies project
        matching rules to every event — useful after adding or renaming a project folder.
      </p>
    </Panel>
  );
}

export function DataMaintenance({
  counts,
  dbFile,
  dataset,
}: {
  counts: { realEvents: number; sampleEvents: number; projects: number; values_: number; checkpoints: number };
  dbFile: string;
  dataset: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);

  async function act(fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    try {
      setMsg(await fn());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
      <Panel title="Local Database">
        <dl className="space-y-1.5 text-[11px]">
          <Row label="Database file" value={dbFile} mono />
          <Row label="Real token events" value={fullNumber(counts.realEvents)} />
          <Row label="Sample token events" value={fullNumber(counts.sampleEvents)} />
          <Row label="Projects" value={fullNumber(counts.projects)} />
          <Row label="Value entries" value={fullNumber(counts.values_)} />
          <Row label="Scan checkpoints" value={fullNumber(counts.checkpoints)} />
        </dl>
        <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink3">
          To back up, copy the database file above while the app is stopped. It is a standard SQLite database in WAL
          mode — copy the <span className="mono">-wal</span> and <span className="mono">-shm</span> files alongside it,
          or stop the app first so they are checkpointed.
        </p>
      </Panel>

      <div className="space-y-2.5">
        <Panel title="Exports" subtitle="CSV exports respect the filters active on each page">
          <div className="flex flex-wrap gap-1.5">
            {[
              ['projects', 'Project summary'],
              ['sessions', 'Sessions'],
              ['models', 'Model usage'],
              ['costs', 'Cost analysis'],
              ['roi', 'ROI analysis'],
            ].map(([type, label]) => (
              <Button key={type} onClick={() => (window.location.href = `/api/export?type=${type}`)}>
                <Download size={10} />
                {label}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-ink3">Files are named with a timestamp so repeated exports never collide.</p>
        </Panel>

        <Panel
          title="Sample Data"
          subtitle="For screenshots and exploring the interface"
          right={dataset === 'sample' ? <Badge tone="warn">active</Badge> : undefined}
        >
          <p className="mb-2 text-[11px] leading-relaxed text-ink2">
            Sample data lives in a separate partition and is never mixed with your real indexed data. A SAMPLE DATA badge
            appears in the top bar whenever it is active.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button disabled={busy} onClick={() => act(loadSampleData)}>
              <FlaskConical size={10} />
              Install &amp; activate sample data
            </Button>
            {dataset === 'sample' && (
              <Button disabled={busy} onClick={() => act(() => setDataset('real'))}>
                Switch to real data
              </Button>
            )}
            {counts.sampleEvents > 0 && (
              <Button variant="danger" disabled={busy} onClick={() => act(clearSampleData)}>
                Remove sample data
              </Button>
            )}
          </div>
        </Panel>

        <Panel title="Danger Zone">
          <p className="mb-2 text-[11px] leading-relaxed text-ink3">
            Clearing indexed data removes every real token event and every scan checkpoint. Projects, pricing,
            subscriptions and value entries are kept, and a fresh scan will re-index from your history files.
          </p>
          {confirmClear ? (
            <div className="flex gap-1.5">
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await clearAllIndexedData();
                    setConfirmClear(false);
                    return r;
                  })
                }
              >
                <AlertTriangle size={10} />
                Confirm — clear all indexed events
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmClear(true)}>
              Clear indexed data
            </Button>
          )}
          {msg && <p className={`mt-2 text-[10.5px] ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.message}</p>}
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hair pb-1 last:border-0">
      <dt className="shrink-0 text-ink3">{label}</dt>
      <dd className={`truncate text-right text-ink2 ${mono ? 'mono' : 'num'}`}>{value}</dd>
    </div>
  );
}
