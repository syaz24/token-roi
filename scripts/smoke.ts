/**
 * End-to-end smoke check against the REAL indexed database.
 *
 * Exercises the acceptance-criteria path without a browser: register a
 * project, remap events, add a subscription, allocate it, record value, and
 * read back ROI on all three cost bases.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { raw } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { seedPricingIfEmpty } from '../src/lib/settings';
import { remapProjects } from '../src/lib/scan/engine';
import { normPath } from '../src/lib/projects/match';
import { projectRoiTable, totals, allocatedCash, unassignedUsage } from '../src/lib/queries';
import type { CostBasis } from '../src/lib/roi/compute';

// This script writes illustrative projects, a subscription and value entries.
// Refuse to touch the default database so it can never contaminate real data.
if (!process.env.TOKEN_ROI_DB) {
  console.error(
    'Refusing to run: set TOKEN_ROI_DB to a throwaway database first.\n' +
      '  TOKEN_ROI_DB="$(pwd)/.smoke.db" npx tsx scripts/smoke.ts',
  );
  process.exit(1);
}

runMigrations();
seedPricingIfEmpty();
const d = raw();

const range = { from: '2020-01-01T00:00:00.000Z', to: new Date().toISOString() };

// 1. Register project folders.
//
// Pass your own as arguments so no local folder names are hard-coded here:
//   TOKEN_ROI_DB=./.smoke.db npx tsx scripts/smoke.ts "C:\path\to\project" ...
//
// With no arguments this falls back to the distinct working directories already
// present in the indexed events, which is usually what you want.
const argFolders = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const folders: Array<[string, string]> = argFolders.length
  ? argFolders.map((p) => [path.basename(p) || p, p])
  : (
      d
        .prepare(
          `SELECT working_directory w, COUNT(*) n FROM events
            WHERE dataset='real' AND working_directory IS NOT NULL
            GROUP BY w ORDER BY n DESC LIMIT 5`,
        )
        .all() as Array<{ w: string }>
    ).map((r) => [path.basename(r.w) || r.w, r.w]);

if (!folders.length) {
  console.error('No indexed working directories found. Run `npm run scan` first, or pass folders as arguments.');
  process.exit(1);
}

for (const [name, p] of folders) {
  const exists = d.prepare(`SELECT id FROM projects WHERE path_norm=?`).get(normPath(p));
  if (exists) continue;
  d.prepare(
    `INSERT INTO projects (id,name,path,path_norm,status,category,currency,value_method,tags,archived,dataset,created_at)
     VALUES (?,?,?,?,'active','SaaS','USD','manual','[]',0,'real',?)`,
  ).run(randomUUID(), name, p, normPath(p), new Date().toISOString());
}
console.log(`1. Registered ${folders.length} project folders.`);

// 2. Map events to projects.
const mapped = remapProjects();
console.log(`2. Mapped ${mapped.toLocaleString()} events to a project.`);

// 3. Add a subscription.
const subExists = d.prepare(`SELECT id FROM subscriptions WHERE dataset='real'`).get() as any;
if (!subExists) {
  d.prepare(
    `INSERT INTO subscriptions (id,provider,plan_name,monthly_price,currency,billing_start,billing_cycle,
       seats,tax_pct,discount_pct,active,allocation_method,allocation_config,dataset)
     VALUES (?,'Anthropic','Max',200,'USD','2026-01-01','monthly',1,0,0,1,'token_share','{}','real')`,
  ).run(randomUUID());
}
console.log('3. Added an Anthropic Max subscription (token-share allocation).');

// 4. Record realised + estimated value on one project.
const target = d.prepare(`SELECT id,name FROM projects WHERE dataset='real' ORDER BY name LIMIT 1`).get() as any;
const hasValue = d.prepare(`SELECT id FROM value_events WHERE project_id=?`).get(target.id);
if (!hasValue) {
  d.prepare(
    `INSERT INTO value_events (id,project_id,value_type,amount,currency,date,recurring,recurrence_period,
       realised,confidence,description,dataset)
     VALUES (?,?,'one_time_sale',9000,'USD','2026-05-01',0,NULL,1,'high','Smoke-test realised value','real')`,
  ).run(randomUUID(), target.id);
  d.prepare(
    `INSERT INTO value_events (id,project_id,value_type,amount,currency,date,recurring,recurrence_period,
       realised,confidence,description,dataset)
     VALUES (?,?,'recurring_revenue',1500,'USD','2026-03-01',1,'monthly',1,'medium','Smoke-test recurring','real')`,
  ).run(randomUUID(), target.id);
}
console.log(`4. Recorded value on "${target.name}".`);

// 5. Read back the analysis on every cost basis.
for (const basis of ['api_equivalent', 'allocated_cash', 'blended'] as CostBasis[]) {
  const f = { dataset: 'real' as const, ...range, basis, projectId: null };
  const t = totals(f);
  const cash = allocatedCash(f);
  const rows = projectRoiTable(f);
  console.log(`\n── basis: ${basis} ──`);
  console.log(
    `   tokens ${(t.tokens / 1e9).toFixed(2)}B · api $${t.apiCost.toFixed(2)} · cash $${cash.totalCash.toFixed(
      2,
    )} · unallocated $${cash.unallocated.toFixed(2)} · coverage ${(t.pricingCoverage * 100).toFixed(1)}%`,
  );
  for (const r of rows) {
    console.log(
      `   ${r.name.padEnd(18)} tok ${(r.tokens / 1e9).toFixed(2)}B  cost $${r.cost.toFixed(2).padStart(9)}  ` +
        `value $${r.value.toFixed(2).padStart(9)}  roi ${r.roiPct == null ? '   n/a' : `${r.roiPct.toFixed(0)}%`.padStart(6)}  ` +
        `${r.recommendation.recommendation}`,
    );
  }
}

const un = unassignedUsage({ dataset: 'real', ...range, basis: 'api_equivalent', projectId: null });
console.log(`\n5. Unassigned: ${un.events.toLocaleString()} events, ${(un.tokens / 1e9).toFixed(2)}B tokens.`);
console.log('\nSmoke check complete.');
