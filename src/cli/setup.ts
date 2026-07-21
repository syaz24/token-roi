/**
 * Entry point bundled to `dist/setup.js` for the plain-JS launcher in `bin/`.
 * Keeps the CLI free of any TypeScript toolchain at runtime.
 */
export { runMigrations } from '../db/migrate';

import { ADAPTERS } from '../lib/adapters/registry';
import { runScan } from '../lib/scan/engine';
import { runMigrations } from '../db/migrate';
import { seedPricingIfEmpty } from '../lib/settings';

/** Index every verified source and print a human-readable report. */
export async function scanAll(): Promise<void> {
  const { dbFile } = runMigrations();
  const seeded = seedPricingIfEmpty();
  console.log(`Database : ${dbFile}`);
  if (seeded) console.log(`Pricing  : seeded ${seeded} bundled rows`);

  let any = false;
  for (const adapter of ADAPTERS) {
    if (adapter.id.startsWith('generic-')) continue;

    const detected = await adapter.detect();
    const label = detected.status === 'verified' ? 'VERIFIED' : detected.status.toUpperCase();
    console.log(
      `Source   : ${adapter.id.padEnd(13)} ${label.padEnd(20)} ${detected.rootPath ?? ''}` +
        (detected.fileCount != null ? ` (${detected.fileCount} files)` : ''),
    );
    if (detected.status !== 'verified') {
      if (detected.reason) console.log(`           └ ${detected.reason}`);
      continue;
    }

    any = true;
    const r = await runScan(adapter.id);
    console.log(
      `           └ ${r.filesScanned} files · ${r.recordsAdded} added · ` +
        `${r.recordsSkipped} skipped · ${r.errors.length} errors · ${r.durationMs}ms`,
    );
    for (const e of r.errors.slice(0, 3)) console.log(`             ! ${e}`);
  }

  if (!any) console.log('\nNo verified local AI history was found on this machine.');
}
