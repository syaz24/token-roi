/**
 * npm run scan [-- <sourceId> ...]
 *
 * Runs migrations, seeds pricing if empty, then scans the requested sources
 * (default: every source that detects as 'verified').
 */
import { runMigrations } from '../db/migrate';
import { ADAPTERS } from '../lib/adapters/registry';
import { runScan } from '../lib/scan/engine';
import { seedPricingIfEmpty } from '../lib/settings';

async function main() {
  const { dbFile } = runMigrations();
  const seeded = seedPricingIfEmpty();
  console.log(`Database : ${dbFile}`);
  if (seeded) console.log(`Pricing  : seeded ${seeded} bundled rows`);

  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets: string[] = [];

  for (const a of ADAPTERS) {
    if (requested.length && !requested.includes(a.id)) continue;
    const d = await a.detect();
    const mark = d.status === 'verified' ? 'VERIFIED' : d.status.toUpperCase();
    console.log(`Source   : ${a.id.padEnd(14)} ${mark.padEnd(20)} ${d.rootPath ?? ''} ${d.fileCount != null ? `(${d.fileCount} files)` : ''}`);
    if (d.status === 'verified') targets.push(a.id);
    else if (d.reason) console.log(`           └ ${d.reason}`);
  }

  if (!targets.length) {
    console.log('\nNo verified sources to scan.');
    return;
  }

  for (const id of targets) {
    console.log(`\n── Scanning ${id} ──`);
    const r = await runScan(id);
    console.log(`   files scanned  : ${r.filesScanned}`);
    console.log(`   records added  : ${r.recordsAdded}`);
    console.log(`   records skipped: ${r.recordsSkipped}`);
    console.log(`   errors         : ${r.errors.length}`);
    console.log(`   warnings       : ${r.warnings.length}`);
    console.log(`   duration       : ${r.durationMs} ms`);
    console.log(`   checkpoint     : ${r.checkpointSaved ? 'saved' : 'not saved'}`);
    for (const e of r.errors.slice(0, 5)) console.log(`   ! ${e}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
