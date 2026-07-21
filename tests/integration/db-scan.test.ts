import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixturePath, tmpDir } from '../helpers';

/**
 * Integration tests against a REAL temporary SQLite database.
 *
 * src/db/client.ts memoises its connection at module scope, so every test gets
 * a fresh module registry (vi.resetModules) and sets TOKEN_ROI_DB *before* the
 * dynamic import of anything that touches the database.
 */

interface Ctx {
  raw: () => import('better-sqlite3').Database;
  runScan: (source: string, opts?: { runId?: string }) => Promise<any>;
  repriceAll: () => { priced: number; unpriced: number };
  remapProjects: () => number;
  seedPricingIfEmpty: () => number;
}

let workDir: string;
let dbFile: string;
const ENV_KEYS = [
  'TOKEN_ROI_DB',
  'TOKEN_ROI_CLAUDE_ROOT',
  'TOKEN_ROI_CODEX_ROOT',
  'TOKEN_ROI_GEMINI_ROOT',
  'TOKEN_ROI_IMPORT_FILE',
] as const;
let savedEnv: Record<string, string | undefined> = {};

async function bootstrap(): Promise<Ctx> {
  vi.resetModules();
  process.env.TOKEN_ROI_DB = dbFile;
  const { runMigrations } = await import('@/db/migrate');
  runMigrations(dbFile);
  const client = await import('@/db/client');
  const settings = await import('@/lib/settings');
  const engine = await import('@/lib/scan/engine');
  settings.seedPricingIfEmpty();
  return {
    raw: client.raw,
    runScan: engine.runScan,
    repriceAll: engine.repriceAll,
    remapProjects: engine.remapProjects,
    seedPricingIfEmpty: settings.seedPricingIfEmpty,
  };
}

function insertProject(ctx: Ctx, id: string, absPath: string, pathNorm: string) {
  ctx
    .raw()
    .prepare(`INSERT INTO projects (id, name, path, path_norm, dataset) VALUES (?, ?, ?, ?, 'real')`)
    .run(id, id, absPath, pathNorm);
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  workDir = tmpDir('token-roi-it-');
  dbFile = path.join(workDir, 'test.db').replace(/\\/g, '/');
  process.env.TOKEN_ROI_CLAUDE_ROOT = fixturePath('claude-code');
  process.env.TOKEN_ROI_CODEX_ROOT = fixturePath('codex');
  process.env.TOKEN_ROI_GEMINI_ROOT = fixturePath('gemini');
  delete process.env.TOKEN_ROI_IMPORT_FILE;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* the sqlite handle may still be open on Windows */
  }
});

describe('incremental JSONL import', () => {
  it('imports every source once, and a second scan adds nothing', async () => {
    const ctx = await bootstrap();

    const first = await ctx.runScan('claude-code');
    expect(first.filesScanned).toBe(1);
    expect(first.recordsAdded).toBe(2);
    expect(first.checkpointSaved).toBe(true);
    // the corrupt fixture line is reported but does not abort the run
    expect(first.errors.join(' ')).toMatch(/corrupt JSON/);

    const second = await ctx.runScan('claude-code');
    expect(second.recordsAdded).toBe(0);
    expect(second.filesScanned).toBe(0);
    expect(second.filesScanned).toBeLessThan(first.filesScanned);

    const rows = ctx.raw().prepare(`SELECT COUNT(*) c FROM events`).get() as any;
    expect(rows.c).toBe(2);
  });

  it('collapses re-emitted gemini snapshot messages to unique events', async () => {
    const ctx = await bootstrap();
    const r = await ctx.runScan('gemini-cli');
    expect(r.recordsAdded).toBe(2); // 3 emitted, 1 is a duplicate id
    expect(r.recordsSkipped).toBeGreaterThanOrEqual(1);
    const rows = ctx.raw().prepare(`SELECT COUNT(*) c FROM events WHERE source='gemini-cli'`).get() as any;
    expect(rows.c).toBe(2);
  });

  it('imports codex per-turn deltas with cached input split out', async () => {
    const ctx = await bootstrap();
    await ctx.runScan('codex');
    const rows = ctx
      .raw()
      .prepare(`SELECT input_tokens, cache_read_tokens, total_tokens FROM events WHERE source='codex' ORDER BY timestamp`)
      .all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].input_tokens).toBe(27073 - 13696);
    expect(rows[0].cache_read_tokens).toBe(13696);
    expect(rows[0].total_tokens).toBe(27511);
  });
});

describe('resuming an interrupted scan', () => {
  it('adds only the newly appended records on rescan', async () => {
    const root = path.join(workDir, 'claude').replace(/\\/g, '/');
    fs.mkdirSync(root, { recursive: true });
    const copy = path.join(root, 'session.jsonl');
    fs.copyFileSync(fixturePath('claude-code', 'sample.jsonl'), copy);
    process.env.TOKEN_ROI_CLAUDE_ROOT = root;

    const ctx = await bootstrap();
    const first = await ctx.runScan('claude-code');
    expect(first.recordsAdded).toBe(2);

    const appended = JSON.stringify({
      type: 'assistant',
      uuid: '77777777-7777-4777-8777-777777777777',
      timestamp: '2026-07-13T11:00:00.000Z',
      sessionId: 'sess-claude-1',
      requestId: 'req_c',
      cwd: 'C:\\Users\\Dev\\demo-project',
      version: '2.1.207',
      message: {
        model: 'claude-sonnet-5',
        role: 'assistant',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    });
    fs.appendFileSync(copy, `${appended}\n`, 'utf8');

    const second = await ctx.runScan('claude-code');
    expect(second.filesScanned).toBe(1);
    expect(second.recordsAdded).toBe(1); // only the new record is new

    const rows = ctx.raw().prepare(`SELECT COUNT(*) c FROM events`).get() as any;
    expect(rows.c).toBe(3);

    const third = await ctx.runScan('claude-code');
    expect(third.recordsAdded).toBe(0);
  });
});

describe('mapping sessions to projects', () => {
  it('remapProjects() assigns project ids to already-imported events', async () => {
    const ctx = await bootstrap();
    await ctx.runScan('claude-code');

    const before = ctx
      .raw()
      .prepare(`SELECT COUNT(*) c FROM events WHERE project_id IS NOT NULL`)
      .get() as any;
    expect(before.c).toBe(0);

    insertProject(ctx, 'proj-demo', 'C:\\Users\\Dev\\demo-project', 'c:/users/dev/demo-project');
    const mapped = ctx.remapProjects();
    expect(mapped).toBe(2);

    const rows = ctx
      .raw()
      .prepare(`SELECT project_id, mapping_method FROM events ORDER BY timestamp`)
      .all() as any[];
    expect(rows.every((r) => r.project_id === 'proj-demo')).toBe(true);
    expect(rows.map((r) => r.mapping_method)).toEqual(['exact', 'child']);
  });

  it('maps events at scan time when the project already exists', async () => {
    const ctx = await bootstrap();
    insertProject(ctx, 'proj-demo', 'C:\\Users\\Dev\\demo-project', 'c:/users/dev/demo-project');
    await ctx.runScan('claude-code');
    const rows = ctx
      .raw()
      .prepare(`SELECT COUNT(*) c FROM events WHERE project_id = 'proj-demo'`)
      .get() as any;
    expect(rows.c).toBe(2);
  });

  it('leaves events unassigned when no project matches', async () => {
    const ctx = await bootstrap();
    insertProject(ctx, 'proj-other', 'D:\\nothing', 'd:/nothing');
    await ctx.runScan('claude-code');
    expect(ctx.remapProjects()).toBe(0);
    const rows = ctx
      .raw()
      .prepare(`SELECT COUNT(*) c FROM events WHERE project_id IS NULL`)
      .get() as any;
    expect(rows.c).toBe(2);
  });
});

describe('pricing changes and repriceAll()', () => {
  it('recalculates event costs after a pricing override is added', async () => {
    const ctx = await bootstrap();
    await ctx.runScan('claude-code');

    const totalOf = () =>
      (ctx.raw().prepare(`SELECT SUM(calculated_cost_usd) t FROM events`).get() as any).t as number;

    const before = totalOf();
    expect(before).toBeGreaterThan(0);
    const unpricedBefore = ctx.raw().prepare(`SELECT COUNT(*) c FROM events WHERE priced = 0`).get() as any;
    expect(unpricedBefore.c).toBe(0);

    ctx
      .raw()
      .prepare(
        `INSERT INTO pricing (id, provider, model_id, aliases, effective_from, effective_to,
           input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok,
           reasoning_per_mtok, currency, source_note, user_override, updated_at)
         VALUES ('override-1','anthropic','claude-sonnet-5','[]','2020-01-01',NULL,
           30, 150, 3, 37.5, NULL, 'USD', 'test override', 1, '2026-07-13T00:00:00Z')`,
      )
      .run();

    const res = ctx.repriceAll();
    expect(res.priced).toBe(2);
    expect(res.unpriced).toBe(0);

    const after = totalOf();
    expect(after).toBeCloseTo(before * 10, 6);

    const row = ctx.raw().prepare(`SELECT pricing_id FROM events LIMIT 1`).get() as any;
    expect(row.pricing_id).toBe('override-1');
  });

  it('marks events unpriced (null cost, never zero) when pricing is removed', async () => {
    const ctx = await bootstrap();
    await ctx.runScan('claude-code');
    ctx.raw().prepare(`DELETE FROM pricing`).run();

    const res = ctx.repriceAll();
    expect(res.priced).toBe(0);
    expect(res.unpriced).toBe(2);

    const rows = ctx
      .raw()
      .prepare(`SELECT calculated_cost_usd, priced FROM events`)
      .all() as any[];
    expect(rows.every((r) => r.calculated_cost_usd === null)).toBe(true);
    expect(rows.every((r) => r.priced === 0)).toBe(true);
  });
});

describe('project value and ROI over real rows', () => {
  it('computes ROI from imported cost and a recorded value event', async () => {
    const ctx = await bootstrap();
    insertProject(ctx, 'proj-demo', 'C:\\Users\\Dev\\demo-project', 'c:/users/dev/demo-project');
    await ctx.runScan('claude-code');

    ctx
      .raw()
      .prepare(
        `INSERT INTO value_events (id, project_id, value_type, amount, currency, date, recurring, realised, dataset)
         VALUES ('v1','proj-demo','revenue', 500, 'USD', '2026-07-14', 0, 1, 'real')`,
      )
      .run();

    const cost = (
      ctx
        .raw()
        .prepare(`SELECT SUM(calculated_cost_usd) t FROM events WHERE project_id = 'proj-demo'`)
        .get() as any
    ).t as number;
    const value = (
      ctx
        .raw()
        .prepare(`SELECT SUM(amount) t FROM value_events WHERE project_id = 'proj-demo'`)
        .get() as any
    ).t as number;

    const { roi } = await import('@/lib/roi/compute');
    const r = roi({ value, cost });
    expect(value).toBe(500);
    expect(cost).toBeGreaterThan(0);
    expect(r.note).toBe('ok');
    expect(r.netValue).toBeCloseTo(500 - cost, 10);
    expect(r.roiPct).toBeCloseTo(((500 - cost) / cost) * 100, 10);
    expect(r.roiMultiple).toBeCloseTo(500 / cost, 10);
  });

  it('reports no_cost rather than infinite ROI for a project with no priced usage', async () => {
    const ctx = await bootstrap();
    const { roi } = await import('@/lib/roi/compute');
    expect(roi({ value: 500, cost: 0 }).note).toBe('no_cost');
    expect(roi({ value: 500, cost: 0 }).roiPct).toBeNull();
  });
});

describe('clearing one data source', () => {
  it('deletes only that source and leaves the others intact', async () => {
    const ctx = await bootstrap();
    await ctx.runScan('claude-code');
    await ctx.runScan('codex');
    await ctx.runScan('gemini-cli');

    const countBySource = () =>
      Object.fromEntries(
        (ctx.raw().prepare(`SELECT source, COUNT(*) c FROM events GROUP BY source`).all() as any[]).map(
          (r) => [r.source, r.c],
        ),
      );

    expect(countBySource()).toEqual({ 'claude-code': 2, codex: 2, 'gemini-cli': 2 });

    const info = ctx.raw().prepare(`DELETE FROM events WHERE source = ?`).run('claude-code');
    expect(info.changes).toBe(2);
    expect(countBySource()).toEqual({ codex: 2, 'gemini-cli': 2 });

    // the other sources' checkpoints survive too
    const cps = ctx
      .raw()
      .prepare(`SELECT DISTINCT source FROM scan_checkpoints ORDER BY source`)
      .all() as any[];
    expect(cps.map((c) => c.source)).toEqual(['claude-code', 'codex', 'gemini-cli']);
  });
});
