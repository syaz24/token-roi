import { raw } from '@/db/client';
import { ADAPTERS } from '../adapters/registry';
import { runScan } from './engine';
import { getSetting, setSetting } from '../settings';

/**
 * Automatic indexing.
 *
 * The app is useless until something is indexed, and making every user hunt for
 * a Scan button is poor. So verified local sources are indexed automatically.
 *
 * The privacy contract is unchanged and still holds:
 *   - only the known history directories of tools you already have installed
 *     are read, and only if their format verifies;
 *   - files are opened read-only and never modified;
 *   - nothing leaves the machine;
 *   - generic file importers are never auto-run — they only ever touch a file
 *     you pick yourself.
 *
 * It is disclosed on first run and can be turned off in Settings › Scanning.
 */

const AUTO_KEY = 'scan.auto';
const LAST_KEY = 'scan.lastAutoAt';
const FIRST_RUN_KEY = 'scan.firstRunNoticeSeen';

/** Guards against two concurrent auto-scans in the same process. */
let inFlight: Promise<AutoScanSummary> | null = null;

export interface AutoScanSummary {
  ran: boolean;
  reason: 'ok' | 'disabled' | 'throttled' | 'in_flight' | 'no_sources';
  sources: string[];
  recordsAdded: number;
  filesScanned: number;
  errors: number;
  durationMs: number;
}

export function autoScanEnabled(): boolean {
  return (getSetting(AUTO_KEY) ?? 'true') !== 'false';
}

export function isFirstRun(): boolean {
  return (getSetting(FIRST_RUN_KEY) ?? 'false') !== 'true';
}

export function markFirstRunNoticeSeen(): void {
  setSetting(FIRST_RUN_KEY, 'true');
}

/** Minimum gap between automatic scans, in minutes. 0 = every request. */
function intervalMinutes(): number {
  const n = Number(getSetting('scan.autoRefreshMinutes') ?? '0');
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function hasAnyEvents(): boolean {
  try {
    return !!raw().prepare(`SELECT 1 FROM events WHERE dataset='real' LIMIT 1`).get();
  } catch {
    return false;
  }
}

/**
 * Index every verified source.
 *
 * On a cold database this always runs, so the very first page load already has
 * data. Afterwards it is throttled to the configured refresh interval; with the
 * default of 0 (manual), it will not re-run on its own.
 */
export async function autoScan(opts: { force?: boolean } = {}): Promise<AutoScanSummary> {
  const empty: AutoScanSummary = {
    ran: false,
    reason: 'ok',
    sources: [],
    recordsAdded: 0,
    filesScanned: 0,
    errors: 0,
    durationMs: 0,
  };

  if (!opts.force && !autoScanEnabled()) return { ...empty, reason: 'disabled' };
  if (inFlight) return { ...empty, reason: 'in_flight' };

  const last = getSetting(LAST_KEY);
  const sinceLast = last ? Date.now() - Date.parse(last) : Infinity;

  if (!opts.force) {
    // Hard floor. Without this, a machine with no AI history never records any
    // events, so `coldStart` stays true and detection would re-walk the
    // history directories on every single request.
    if (sinceLast < 60_000) return { ...empty, reason: 'throttled' };

    const coldStart = !hasAnyEvents();
    if (!coldStart) {
      const every = intervalMinutes();
      if (every === 0) return { ...empty, reason: 'throttled' };
      if (sinceLast < every * 60_000) return { ...empty, reason: 'throttled' };
    }
  }

  inFlight = (async () => {
    const t0 = Date.now();
    const summary: AutoScanSummary = { ...empty, ran: true };
    try {
      for (const adapter of ADAPTERS) {
        // Generic importers act on a hand-picked file; never auto-run them.
        if (adapter.id.startsWith('generic-')) continue;

        let detected;
        try {
          detected = await adapter.detect();
        } catch {
          continue; // a broken detector must not stop the others
        }
        if (detected.status !== 'verified') continue;

        try {
          const r = await runScan(adapter.id);
          summary.sources.push(adapter.id);
          summary.recordsAdded += r.recordsAdded;
          summary.filesScanned += r.filesScanned;
          summary.errors += r.errors.length;
        } catch {
          summary.errors += 1;
        }
      }
      if (!summary.sources.length) summary.reason = 'no_sources';
      summary.durationMs = Date.now() - t0;
      setSetting(LAST_KEY, new Date().toISOString());
      return summary;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Called from the root layout on every request.
 *
 * A cold database is awaited so the very first page already shows real data
 * (this is the one-off indexing pass). Once anything is indexed, later refreshes
 * are fired without blocking the render.
 */
export async function autoScanOnBoot(): Promise<AutoScanSummary | null> {
  if (!autoScanEnabled()) return null;

  if (!hasAnyEvents()) return autoScan();

  void autoScan().catch(() => {
    /* background refresh; failures surface in the scan history */
  });
  return null;
}
