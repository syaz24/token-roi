import { PageHeader } from '@/components/shell';
import { ProjectTabs } from '@/components/project-tabs';
import { Panel } from '@/components/ui';
import {
  GeneralSettings,
  AppearanceSettings,
  PrivacySettings,
  DataMaintenance,
  SettingsForm,
} from '@/components/settings-forms';
import { PricingTable } from '@/components/pricing-table';
import { SubscriptionsPanel } from '@/components/subscriptions-panel';
import { str, type SearchParams } from '@/lib/params';
import { getAllSettings } from '@/lib/settings';
import { raw, dbPath } from '@/db/client';
import { REDACTION_RULE_NAMES } from '@/lib/privacy';
import { subscriptions } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const TABS = ['General', 'Appearance', 'Privacy', 'Pricing', 'Subscriptions', 'Scanning', 'Data'] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const tab = str(sp.tab) ?? 'General';
  const settings = getAllSettings();

  const pricing = raw()
    .prepare(
      `SELECT id, provider, model_id modelId, aliases, effective_from effectiveFrom, effective_to effectiveTo,
              input_per_mtok inputPerMTok, output_per_mtok outputPerMTok,
              cache_read_per_mtok cacheReadPerMTok, cache_write_per_mtok cacheWritePerMTok,
              reasoning_per_mtok reasoningPerMTok, source_note sourceNote, user_override userOverride
         FROM pricing ORDER BY provider, model_id, effective_from DESC`,
    )
    .all() as any[];

  const subs = subscriptions('real');
  const projects = raw()
    .prepare(`SELECT id, name FROM projects WHERE dataset='real' ORDER BY name`)
    .all() as Array<{ id: string; name: string }>;

  const counts = raw()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM events WHERE dataset='real') realEvents,
         (SELECT COUNT(*) FROM events WHERE dataset='sample') sampleEvents,
         (SELECT COUNT(*) FROM projects WHERE dataset='real') projects,
         (SELECT COUNT(*) FROM value_events WHERE dataset='real') values_,
         (SELECT COUNT(*) FROM scan_checkpoints) checkpoints`,
    )
    .get() as any;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Everything is stored locally. Nothing on this page is ever transmitted off this machine."
      />

      <ProjectTabs tabs={[...TABS]} current={tab} />

      <div className="mt-2.5">
        {tab === 'General' && <GeneralSettings settings={settings} />}
        {tab === 'Appearance' && <AppearanceSettings settings={settings} />}
        {tab === 'Privacy' && <PrivacySettings settings={settings} rules={REDACTION_RULE_NAMES} />}
        {tab === 'Pricing' && <PricingTable rows={pricing} />}
        {tab === 'Subscriptions' && <SubscriptionsPanel subs={subs} projects={projects} />}
        {tab === 'Scanning' && <ScanningSettings settings={settings} />}
        {tab === 'Data' && <DataMaintenance counts={counts} dbFile={dbPath()} dataset={settings.dataset} />}
      </div>
    </>
  );
}

function ScanningSettings({ settings }: { settings: Record<string, string> }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
      <SettingsForm settings={settings} />
      <Panel title="What Gets Scanned" subtitle="Explicit consent, always">
        <ul className="space-y-2 text-[11px] leading-relaxed text-ink2">
          <li>
            <span className="text-ink">Only the history directories of AI tools you already have installed.</span>{' '}
            Verified sources are indexed automatically so the app works on first launch. The app never walks your whole
            drive, and never reads a folder that is not either a registered project or a known AI history location.
          </li>
          <li>
            <span className="text-ink">Automatic indexing is optional.</span> Turn it off above and nothing will be
            read until you press Rescan yourself.
          </li>
          <li>
            <span className="text-ink">History files are opened read-only.</span> No AI history file is ever written to,
            renamed, or deleted.
          </li>
          <li>
            <span className="text-ink">Scanning is incremental.</span> Each file keeps a checkpoint of its size, modified
            time, content hash and byte offset, so a rescan only reads what was appended.
          </li>
          <li>
            <span className="text-ink">A corrupt record never ends a scan.</span> Bad lines are counted and reported in
            the scan history, and the rest of the file continues to be indexed.
          </li>
          <li>
            <span className="text-ink">Generic imports are opt-in per file.</span> The JSON and CSV importers only ever
            touch a file you select yourself.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

