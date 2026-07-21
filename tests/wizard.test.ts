import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpDir } from './helpers';

/**
 * Wizard tests run against a REAL temporary SQLite database: src/db/client.ts
 * memoises its connection at module scope, so TOKEN_ROI_DB is set before any
 * dynamic import and the module registry is reset for every test.
 */

interface Ctx {
  raw: () => import('better-sqlite3').Database;
  proposeProjects: typeof import('@/lib/projects/wizard').proposeProjects;
  createProposedProjects: typeof import('@/lib/projects/wizard').createProposedProjects;
  prettifyName: typeof import('@/lib/projects/wizard').prettifyName;
}

let workDir: string;
let dbFile: string;
let savedDb: string | undefined;
let seq = 0;

async function bootstrap(): Promise<Ctx> {
  vi.resetModules();
  process.env.TOKEN_ROI_DB = dbFile;
  const { runMigrations } = await import('@/db/migrate');
  runMigrations(dbFile);
  const client = await import('@/db/client');
  const wizard = await import('@/lib/projects/wizard');
  return {
    raw: client.raw,
    proposeProjects: wizard.proposeProjects,
    createProposedProjects: wizard.createProposedProjects,
    prettifyName: wizard.prettifyName,
  };
}

interface EventOpts {
  tokens?: number;
  cost?: number;
  timestamp?: string;
  source?: string;
  dataset?: 'real' | 'sample';
}

function addEvent(ctx: Ctx, dir: string, opts: EventOpts = {}) {
  const id = `ev-${++seq}`;
  ctx
    .raw()
    .prepare(
      `INSERT INTO events (event_id, source, session_id, timestamp, working_directory,
         total_tokens, calculated_cost_usd, priced, dataset)
       VALUES (?,?,?,?,?,?,?,1,?)`,
    )
    .run(
      id,
      opts.source ?? 'claude-code',
      `sess-${id}`,
      opts.timestamp ?? '2026-07-01T00:00:00.000Z',
      dir,
      opts.tokens ?? 10_000,
      opts.cost ?? 1,
      opts.dataset ?? 'real',
    );
}

function insertProject(ctx: Ctx, id: string, absPath: string) {
  ctx
    .raw()
    .prepare(`INSERT INTO projects (id, name, path, path_norm, dataset) VALUES (?,?,?,?, 'real')`)
    .run(id, id, absPath, absPath.replace(/\\/g, '/').toLowerCase());
}

const byName = (ps: Array<{ name: string }>, name: string) => ps.find((p) => p.name === name);

beforeEach(() => {
  savedDb = process.env.TOKEN_ROI_DB;
  workDir = tmpDir('token-roi-wizard-');
  dbFile = path.join(workDir, 'test.db').replace(/\\/g, '/');
});

afterEach(() => {
  if (savedDb === undefined) delete process.env.TOKEN_ROI_DB;
  else process.env.TOKEN_ROI_DB = savedDb;
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* the sqlite handle may still be open on Windows */
  }
});

describe('rolling subfolders up to a project root', () => {
  it('folds worktrees and package folders into a single proposal', async () => {
    const ctx = await bootstrap();
    addEvent(ctx, 'C:\\Users\\Dev\\myapp', { tokens: 5000, timestamp: '2026-06-01T00:00:00.000Z' });
    addEvent(ctx, 'C:\\Users\\Dev\\myapp\\.claude\\worktrees\\feature-x', {
      tokens: 3000,
      source: 'codex',
      timestamp: '2026-07-05T00:00:00.000Z',
    });
    addEvent(ctx, 'C:\\Users\\Dev\\myapp\\packages\\api', { tokens: 2000 });

    const proposals = ctx.proposeProjects('real');
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.path).toBe('C:\\Users\\Dev\\myapp');
    expect(p.pathNorm).toBe('c:/users/dev/myapp');
    expect(p.name).toBe('Myapp');
    expect(p.tokens).toBe(10_000);
    expect(p.events).toBe(3);
    expect(p.cost).toBeCloseTo(3, 10);
    expect(p.firstSeen).toBe('2026-06-01T00:00:00.000Z');
    expect(p.lastSeen).toBe('2026-07-05T00:00:00.000Z');
    expect(p.sources).toEqual(['claude-code', 'codex']);
    expect(p.isMisc).toBe(false);
    expect(p.skip).toBe(false);
  });

  it('never lets the home directory absorb the projects inside it', async () => {
    // Regression: a session run directly in the home folder made it a candidate
    // root, and because it is an ancestor of everything, every real project was
    // merged into one "home" proposal.
    const ctx = await bootstrap();
    const home = os.homedir();
    addEvent(ctx, home, { tokens: 9000 });
    addEvent(ctx, path.join(home, 'alpha'), { tokens: 8000 });
    addEvent(ctx, path.join(home, 'beta'), { tokens: 7000 });
    addEvent(ctx, path.join(home, 'beta', 'packages', 'api'), { tokens: 1000 });

    const proposals = ctx.proposeProjects('real');
    const names = proposals.map((p) => p.name).sort();
    expect(names).toContain('Alpha');
    expect(names).toContain('Beta');

    // Each project keeps its own tokens...
    expect(proposals.find((p) => p.name === 'Alpha')!.tokens).toBe(8000);
    // ...including its own subfolders, which still roll up normally.
    expect(proposals.find((p) => p.name === 'Beta')!.tokens).toBe(8000);

    // ...and the home folder is offered separately, unticked, with only its own
    // direct usage attributed to it.
    const homeNorm = home.replace(/\\/g, '/').toLowerCase();
    const homeProposal = proposals.find((p) => p.pathNorm === homeNorm);
    expect(homeProposal).toBeDefined();
    expect(homeProposal!.skip).toBe(true);
    expect(homeProposal!.tokens).toBe(9000);
  });

  it('strips node_modules, dist, build and .venv segments too', async () => {
    const ctx = await bootstrap();
    addEvent(ctx, 'C:\\Users\\Dev\\lazythreads\\node_modules\\left-pad', { tokens: 4000 });
    addEvent(ctx, 'C:\\Users\\Dev\\lazythreads\\dist', { tokens: 4000 });
    addEvent(ctx, 'C:\\Users\\Dev\\lazythreads\\build\\out', { tokens: 4000 });
    addEvent(ctx, 'C:\\Users\\Dev\\lazythreads\\.venv\\Scripts', { tokens: 4000 });
    addEvent(ctx, 'C:\\Users\\Dev\\lazythreads\\.git', { tokens: 4000 });

    const proposals = ctx.proposeProjects('real');
    expect(proposals).toHaveLength(1);
    expect(proposals[0].name).toBe('Lazythreads');
    expect(proposals[0].tokens).toBe(20_000);
  });

  it('merges deep into shallow regardless of insertion order', async () => {
    const deepFirst = await bootstrap();
    addEvent(deepFirst, 'C:\\Users\\Dev\\alpha\\packages\\web\\src', { tokens: 1000 });
    addEvent(deepFirst, 'C:\\Users\\Dev\\alpha\\packages', { tokens: 2000 });
    addEvent(deepFirst, 'C:\\Users\\Dev\\alpha', { tokens: 3000 });
    const a = deepFirst.proposeProjects('real');

    // A second, independent database with the rows inserted the other way round.
    dbFile = path.join(workDir, 'test2.db').replace(/\\/g, '/');
    const shallowFirst = await bootstrap();
    addEvent(shallowFirst, 'C:\\Users\\Dev\\alpha', { tokens: 3000 });
    addEvent(shallowFirst, 'C:\\Users\\Dev\\alpha\\packages', { tokens: 2000 });
    addEvent(shallowFirst, 'C:\\Users\\Dev\\alpha\\packages\\web\\src', { tokens: 1000 });
    const b = shallowFirst.proposeProjects('real');

    expect(a).toHaveLength(1);
    expect(a[0].pathNorm).toBe('c:/users/dev/alpha');
    expect(a[0].tokens).toBe(6000);
    expect(b.map((p) => [p.pathNorm, p.tokens])).toEqual(a.map((p) => [p.pathNorm, p.tokens]));
  });

  it('keeps genuinely separate roots apart', async () => {
    const ctx = await bootstrap();
    addEvent(ctx, 'C:\\Users\\Dev\\alpha', { tokens: 5000 });
    addEvent(ctx, 'C:\\Users\\Dev\\alpha-two', { tokens: 9000 });

    const proposals = ctx.proposeProjects('real');
    expect(proposals.map((p) => p.name)).toEqual(['Alpha Two', 'Alpha']);
  });
});

describe('the Miscellaneous bucket', () => {
  it('collapses scratch, temp, AppData Temp and Downloads into one proposal, sorted last', async () => {
    const ctx = await bootstrap();
    addEvent(ctx, 'C:\\Users\\Dev\\scratchpad\\notes', { tokens: 4000 });
    addEvent(ctx, 'C:\\Users\\Dev\\tmp\\a', { tokens: 4000 });
    addEvent(ctx, 'C:\\Users\\Dev\\AppData\\Local\\Temp\\claude', { tokens: 4000 });
    addEvent(ctx, 'C:\\Users\\Dev\\Downloads', { tokens: 4000 });
    addEvent(ctx, 'C:\\Users\\Dev\\realproject', { tokens: 1000 });

    const proposals = ctx.proposeProjects('real');
    const misc = proposals.filter((p) => p.isMisc);
    expect(misc).toHaveLength(1);
    expect(misc[0].name).toBe('Miscellaneous');
    expect(misc[0].tokens).toBe(16_000);
    expect(misc[0].events).toBe(4);
    expect(misc[0].reason).toMatch(/scratch/i);
    // Highest token count of all, yet still last.
    expect(proposals[proposals.length - 1]).toBe(misc[0]);
    expect(proposals).toHaveLength(2);
    // Its path is the longest common ancestor of the merged directories.
    expect(misc[0].pathNorm).toBe('c:/users/dev');
  });

  it('falls back to the first directory when there is no sensible ancestor', async () => {
    const ctx = await bootstrap();
    addEvent(ctx, 'C:\\temp\\one', { tokens: 4000 });
    addEvent(ctx, 'D:\\scratchpad', { tokens: 4000 });

    const [misc] = ctx.proposeProjects('real');
    expect(misc.isMisc).toBe(true);
    expect(['c:/temp/one', 'd:/scratchpad']).toContain(misc.pathNorm);
  });
});

describe('exclusions and default skips', () => {
  it('excludes directories already covered by a registered project', async () => {
    const ctx = await bootstrap();
    insertProject(ctx, 'proj-known', 'C:\\Users\\Dev\\known');
    addEvent(ctx, 'C:\\Users\\Dev\\known', { tokens: 9000 });
    addEvent(ctx, 'C:\\Users\\Dev\\known\\packages\\api', { tokens: 9000 });
    addEvent(ctx, 'C:\\Users\\Dev\\fresh', { tokens: 9000 });

    const proposals = ctx.proposeProjects('real');
    expect(proposals.map((p) => p.name)).toEqual(['Fresh']);
  });

  it('marks low-token, home-directory and drive-root proposals as skip with a reason', async () => {
    const ctx = await bootstrap();
    const home = os.homedir();
    addEvent(ctx, 'C:\\Users\\Dev\\tiny', { tokens: 120 });
    addEvent(ctx, home, { tokens: 50_000 });
    addEvent(ctx, 'D:\\', { tokens: 50_000 });
    addEvent(ctx, 'C:\\Users\\Dev\\real-one', { tokens: 50_000 });

    const proposals = ctx.proposeProjects('real');
    const tiny = proposals.find((p) => p.pathNorm === 'c:/users/dev/tiny')!;
    expect(tiny.skip).toBe(true);
    expect(tiny.reason).toMatch(/tokens/i);

    const homeProposal = proposals.find((p) => p.pathNorm === home.replace(/\\/g, '/').toLowerCase())!;
    expect(homeProposal.skip).toBe(true);
    expect(homeProposal.reason).toMatch(/home directory/i);

    const drive = proposals.find((p) => p.pathNorm === 'd:')!;
    expect(drive.skip).toBe(true);
    expect(drive.reason).toMatch(/drive root/i);

    // Nothing is dropped silently.
    expect(proposals).toHaveLength(4);
    expect(proposals.find((p) => p.name === 'Real One')!.skip).toBe(false);
  });

  it('only looks at the requested dataset', async () => {
    const ctx = await bootstrap();
    addEvent(ctx, 'C:\\Users\\Dev\\realdata', { tokens: 9000, dataset: 'real' });
    addEvent(ctx, 'C:\\Users\\Dev\\sampledata', { tokens: 9000, dataset: 'sample' });

    expect(ctx.proposeProjects('real').map((p) => p.name)).toEqual(['Realdata']);
    expect(ctx.proposeProjects('sample').map((p) => p.name)).toEqual(['Sampledata']);
  });
});

describe('name prettification', () => {
  it('title-cases the final folder name', async () => {
    const ctx = await bootstrap();
    expect(ctx.prettifyName('C:\\Users\\Dev\\agentic-trading-my')).toBe('Agentic Trading My');
    expect(ctx.prettifyName('C:\\Users\\Dev\\lazythreads')).toBe('Lazythreads');
    expect(ctx.prettifyName('C:\\Users\\Dev\\project_token_roi')).toBe('Project Token Roi');
    expect(ctx.prettifyName('C:\\Users\\Dev\\my-app_v2\\')).toBe('My App V2');
    expect(ctx.prettifyName('/home/dev/side-project')).toBe('Side Project');
  });
});

describe('creating the reviewed proposals', () => {
  it('inserts the expected rows, honours skip and is idempotent', async () => {
    const ctx = await bootstrap();
    addEvent(ctx, 'C:\\Users\\Dev\\alpha-app', { tokens: 50_000 });
    addEvent(ctx, 'C:\\Users\\Dev\\beta-app\\.claude', { tokens: 20_000 });
    addEvent(ctx, 'C:\\Users\\Dev\\tiny-app', { tokens: 100 });

    const proposals = ctx.proposeProjects('real');
    expect(proposals).toHaveLength(3);

    const first = ctx.createProposedProjects('real', proposals);
    expect(first.created).toBe(2);
    expect(first.skipped).toBe(1); // the low-token one is skip: true
    expect(first.names.sort()).toEqual(['Alpha App', 'Beta App']);

    const rows = ctx
      .raw()
      .prepare(`SELECT * FROM projects WHERE dataset='real' ORDER BY name`)
      .all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('Alpha App');
    expect(rows[0].path).toBe('C:\\Users\\Dev\\alpha-app');
    expect(rows[0].path_norm).toBe('c:/users/dev/alpha-app');
    expect(rows[0].status).toBe('active');
    expect(rows[0].currency).toBe('USD');
    expect(rows[0].value_method).toBe('manual');
    expect(rows[0].tags).toBe('[]');
    expect(rows[0].archived).toBe(0);
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof rows[0].created_at).toBe('string');
    expect(rows[1].path_norm).toBe('c:/users/dev/beta-app');

    // Second run over the same proposals creates nothing new.
    const second = ctx.createProposedProjects('real', proposals);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.names).toEqual([]);
    const after = ctx.raw().prepare(`SELECT COUNT(*) c FROM projects`).get() as any;
    expect(after.c).toBe(2);
  });

  it('skips duplicates inside a single call and writes the misc proposal once', async () => {
    const ctx = await bootstrap();
    addEvent(ctx, 'C:\\Users\\Dev\\gamma', { tokens: 30_000 });
    addEvent(ctx, 'C:\\Users\\Dev\\scratchpad', { tokens: 30_000 });

    const proposals = ctx.proposeProjects('real');
    const r = ctx.createProposedProjects('real', [...proposals, ...proposals]);
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(2);
    expect(r.names).toContain('Miscellaneous');

    const names = (ctx.raw().prepare(`SELECT name FROM projects ORDER BY name`).all() as any[]).map(
      (x) => x.name,
    );
    expect(names).toEqual(['Gamma', 'Miscellaneous']);
  });

  it('writes into the sample dataset when asked', async () => {
    const ctx = await bootstrap();
    addEvent(ctx, 'C:\\Users\\Dev\\sample-proj', { tokens: 30_000, dataset: 'sample' });
    const r = ctx.createProposedProjects('sample', ctx.proposeProjects('sample'));
    expect(r.created).toBe(1);
    const row = ctx.raw().prepare(`SELECT dataset FROM projects`).get() as any;
    expect(row.dataset).toBe('sample');
  });
});
