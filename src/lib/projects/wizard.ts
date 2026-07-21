/**
 * Project setup wizard: propose projects from the working directories that
 * already appear in indexed token events, then create the ones the user keeps.
 *
 * The hard part is that a working directory is usually NOT the project root —
 * it is a worktree, a package folder or a build directory underneath it. The
 * roll-up below folds those back onto the shallowest sensible root so the user
 * reviews one row per project rather than one row per folder.
 */

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { raw } from '@/db/client';
import { isWithin, normPath } from './match';

export type Dataset = 'real' | 'sample';

export interface ProjectProposal {
  name: string;
  path: string;
  pathNorm: string;
  events: number;
  tokens: number;
  cost: number;
  firstSeen: string;
  lastSeen: string;
  sources: string[];
  isMisc: boolean;
  skip: boolean;
  reason?: string;
}

/** Folders that only ever appear *inside* a project — never as its root. */
const NESTED_SEGMENTS = new Set([
  '.claude',
  '.git',
  'node_modules',
  '.next',
  'worktrees',
  '.venv',
  'dist',
  'build',
]);

/** Shared scratch/temp locations that must never become their own project. */
const MISC_SEGMENTS = new Set(['scratchpad', 'temp', 'tmp', 'downloads']);

export const MISC_NAME = 'Miscellaneous';
export const MISC_REASON =
  'Shared scratch space (temp, downloads, scratchpad) rather than a real project — grouped so it does not clutter the project list.';

/** Minimum usage before a proposal is worth ticking by default. */
const MIN_TOKENS = 1000;

interface Agg {
  path: string;
  pathNorm: string;
  events: number;
  tokens: number;
  cost: number;
  firstSeen: string;
  lastSeen: string;
  sources: Set<string>;
}

function splitSegments(p: string): string[] {
  return p.trim().replace(/[\\/]+$/, '').split(/[\\/]+/);
}

function joinLike(original: string, segments: string[]): string {
  const sep = original.includes('\\') ? '\\' : '/';
  const joined = segments.join(sep);
  // A POSIX absolute path loses its leading slash when split, put it back.
  if (sep === '/' && original.startsWith('/') && !joined.startsWith('/')) return `/${joined}`;
  return joined;
}

/** Drop the first well-known nested segment and everything after it. */
function stripNested(dir: string): string {
  const segs = splitSegments(dir);
  const cut = segs.findIndex((s) => NESTED_SEGMENTS.has(s.toLowerCase()));
  if (cut <= 0) return dir;
  return joinLike(dir, segs.slice(0, cut));
}

const TMP_ROOTS = (() => {
  const roots = new Set<string>();
  for (const t of [os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR]) {
    if (t) roots.add(normPath(t));
  }
  return [...roots];
})();

/** Scratch/temp/shared locations, detected by path segment, case-insensitively. */
export function isMiscPath(dir: string): boolean {
  const norm = normPath(dir);
  if (TMP_ROOTS.some((t) => isWithin(t, norm))) return true;
  const segs = splitSegments(norm);
  if (segs.some((s) => MISC_SEGMENTS.has(s))) return true;
  // `AppData/Local/Temp` is covered by the `temp` segment above; this catches
  // the roaming variants written with different casing or nesting.
  return /(^|\/)appdata\/local\/temp(\/|$)/.test(norm);
}

/** `agentic-trading-my` -> "Agentic Trading My"; `lazythreads` -> "Lazythreads". */
export function prettifyName(dir: string): string {
  const base = splitSegments(dir).pop() ?? dir;
  const words = base
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return base;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function isDriveRoot(pathNorm: string): boolean {
  return /^[a-z]:$/.test(pathNorm) || pathNorm === '' || pathNorm === '/';
}

/**
 * True for directories that contain projects rather than being one: the home
 * folder itself, or a bare drive/filesystem root.
 */
export function isContainerDir(pathNorm: string, homeNorm: string): boolean {
  if (pathNorm === homeNorm) return true;
  return /^[a-z]:\/?$/.test(pathNorm) || pathNorm === '' || pathNorm === '/';
}

function merge(into: Agg, from: Agg): void {
  into.events += from.events;
  into.tokens += from.tokens;
  into.cost += from.cost;
  if (from.firstSeen && (!into.firstSeen || from.firstSeen < into.firstSeen)) into.firstSeen = from.firstSeen;
  if (from.lastSeen && from.lastSeen > into.lastSeen) into.lastSeen = from.lastSeen;
  for (const s of from.sources) into.sources.add(s);
}

/** Longest common ancestor of a set of directories, or null when there is none. */
function commonAncestor(dirs: string[]): string | null {
  if (!dirs.length) return null;
  let common = splitSegments(dirs[0]);
  for (const d of dirs.slice(1)) {
    const segs = splitSegments(d);
    let i = 0;
    while (i < common.length && i < segs.length && common[i].toLowerCase() === segs[i].toLowerCase()) i++;
    common = common.slice(0, i);
  }
  // A bare drive letter (or nothing at all) is not a useful ancestor.
  if (common.length < 2) return null;
  return joinLike(dirs[0], common);
}

interface DirRow {
  dir: string;
  events: number;
  tokens: number;
  cost: number;
  firstSeen: string;
  lastSeen: string;
  sources: string | null;
}

function readDirectories(dataset: Dataset): Agg[] {
  const rows = raw()
    .prepare(
      `SELECT working_directory dir,
              COUNT(*) events,
              COALESCE(SUM(total_tokens),0) tokens,
              COALESCE(SUM(COALESCE(calculated_cost_usd, reported_cost_usd, 0)),0) cost,
              MIN(timestamp) firstSeen,
              MAX(timestamp) lastSeen,
              GROUP_CONCAT(DISTINCT source) sources
         FROM events
        WHERE dataset = ? AND working_directory IS NOT NULL AND TRIM(working_directory) <> ''
        GROUP BY working_directory`,
    )
    .all(dataset) as DirRow[];

  return rows.map((r) => ({
    path: r.dir.trim().replace(/[\\/]+$/, ''),
    pathNorm: normPath(r.dir),
    events: r.events,
    tokens: r.tokens,
    cost: r.cost,
    firstSeen: r.firstSeen ?? '',
    lastSeen: r.lastSeen ?? '',
    sources: new Set((r.sources ?? '').split(',').map((s) => s.trim()).filter(Boolean)),
  }));
}

function registeredRoots(dataset: Dataset): string[] {
  const rows = raw()
    .prepare(`SELECT path_norm FROM projects WHERE dataset = ?`)
    .all(dataset) as Array<{ path_norm: string }>;
  return rows.map((r) => r.path_norm).filter(Boolean);
}

function toProposal(a: Agg, isMisc: boolean, homeNorm: string): ProjectProposal {
  const p: ProjectProposal = {
    name: isMisc ? MISC_NAME : prettifyName(a.path),
    path: a.path,
    pathNorm: a.pathNorm,
    events: a.events,
    tokens: a.tokens,
    cost: a.cost,
    firstSeen: a.firstSeen,
    lastSeen: a.lastSeen,
    sources: [...a.sources].sort(),
    isMisc,
    skip: false,
  };
  if (isMisc) p.reason = MISC_REASON;

  if (isDriveRoot(p.pathNorm)) {
    p.skip = true;
    p.reason = 'This is a drive root, not a project folder.';
  } else if (p.pathNorm === homeNorm) {
    p.skip = true;
    p.reason = 'This is your home directory, not a project folder.';
  } else if (p.tokens < MIN_TOKENS) {
    p.skip = true;
    p.reason = `Only ${p.tokens.toLocaleString('en-US')} tokens recorded — probably not a real project.`;
  }
  return p;
}

/**
 * Propose one project per distinct project root found in the indexed events.
 * Directories already covered by a registered project are left out entirely.
 */
export function proposeProjects(dataset: Dataset): ProjectProposal[] {
  const homeNorm = normPath(os.homedir());
  const existing = registeredRoots(dataset);

  const dirs = readDirectories(dataset).filter(
    (d) => !existing.some((root) => isWithin(root, d.pathNorm)),
  );

  const miscDirs: Agg[] = [];
  const rollup = new Map<string, Agg>();

  for (const d of dirs) {
    if (isMiscPath(d.path)) {
      miscDirs.push(d);
      continue;
    }
    const rootPath = stripNested(d.path) || d.path;
    const rootNorm = normPath(rootPath);
    const seen = rollup.get(rootNorm);
    if (seen) {
      merge(seen, d);
    } else {
      rollup.set(rootNorm, { ...d, path: rootPath, pathNorm: rootNorm, sources: new Set(d.sources) });
    }
  }

  // Shallowest root wins. Sorting by the normalised path makes a prefix sort
  // before anything nested under it, so the outcome does not depend on the
  // order rows came back from SQLite.
  //
  // Container directories are the exception: the home folder and drive roots
  // are ancestors of EVERY project, so letting them act as a merge root would
  // swallow the whole machine into one proposal. Sessions run directly in them
  // still get their own (skipped) proposal — they just never absorb children.
  const kept: Agg[] = [];
  for (const agg of [...rollup.values()].sort((a, b) => a.pathNorm.localeCompare(b.pathNorm))) {
    const parent = kept.find((k) => !isContainerDir(k.pathNorm, homeNorm) && isWithin(k.pathNorm, agg.pathNorm));
    if (parent) merge(parent, agg);
    else kept.push(agg);
  }

  const proposals = kept.map((a) => toProposal(a, false, homeNorm));

  if (miscDirs.length) {
    const base: Agg = {
      path: miscDirs[0].path,
      pathNorm: miscDirs[0].pathNorm,
      events: 0,
      tokens: 0,
      cost: 0,
      firstSeen: '',
      lastSeen: '',
      sources: new Set<string>(),
    };
    for (const d of miscDirs) merge(base, d);
    const ancestor = commonAncestor(miscDirs.map((d) => d.path)) ?? miscDirs[0].path;
    base.path = ancestor;
    base.pathNorm = normPath(ancestor);
    proposals.push(toProposal(base, true, homeNorm));
  }

  proposals.sort((a, b) => {
    if (a.isMisc !== b.isMisc) return a.isMisc ? 1 : -1;
    return b.tokens - a.tokens;
  });
  return proposals;
}

export interface CreateResult {
  created: number;
  skipped: number;
  names: string[];
}

/**
 * Create every proposal the user kept, in one transaction. Idempotent: a path
 * that is already registered for this dataset is counted as skipped rather
 * than colliding with the (path_norm, dataset) unique index.
 */
export function createProposedProjects(dataset: Dataset, proposals: ProjectProposal[]): CreateResult {
  const d = raw();
  const result: CreateResult = { created: 0, skipped: 0, names: [] };

  const insert = d.prepare(
    `INSERT INTO projects (id, name, path, path_norm, git_root, remote_url, description, status,
       category, currency, started_at, value_method, tags, archived, dataset, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
  );
  const exists = d.prepare(`SELECT 1 FROM projects WHERE path_norm = ? AND dataset = ?`);

  const tx = d.transaction(() => {
    const seen = new Set<string>();
    for (const p of proposals) {
      if (p.skip) {
        result.skipped++;
        continue;
      }
      const pathNorm = normPath(p.path);
      if (seen.has(pathNorm) || exists.get(pathNorm, dataset)) {
        result.skipped++;
        continue;
      }
      seen.add(pathNorm);
      insert.run(
        randomUUID(),
        p.name,
        p.path,
        pathNorm,
        null,
        null,
        p.isMisc ? MISC_REASON : null,
        'active',
        null,
        'USD',
        null,
        'manual',
        '[]',
        dataset,
        new Date().toISOString(),
      );
      result.created++;
      result.names.push(p.name);
    }
  });
  tx();
  return result;
}
