import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { raw } from '@/db/client';

/**
 * Read-only Git metadata indexing.
 *
 * SECURITY: git is invoked with execFileSync and an explicit argv array — never
 * a shell string — and the repository path is passed via `cwd`, never
 * interpolated into a command. Source file CONTENTS are never read or stored;
 * only aggregate metadata.
 */

export interface GitMetrics {
  commitCount: number;
  activeDays: number;
  branches: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  contributors: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  commitsByDay: Record<string, number>;
  dirty: boolean;
}

function git(cwd: string, args: string[], timeoutMs = 20_000): string {
  return execFileSync('git', args, {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export function collectGitMetrics(repoRoot: string): GitMetrics {
  if (!fs.existsSync(repoRoot)) throw new Error(`Folder not found: ${repoRoot}`);

  const empty: GitMetrics = {
    commitCount: 0,
    activeDays: 0,
    branches: 0,
    linesAdded: 0,
    linesRemoved: 0,
    filesChanged: 0,
    contributors: 0,
    firstCommitAt: null,
    lastCommitAt: null,
    commitsByDay: {},
    dirty: false,
  };

  let log = '';
  try {
    // "<iso>\t<author>" per commit.
    log = git(repoRoot, ['log', '--no-merges', '--date=iso-strict', '--pretty=format:%ad\t%an']);
  } catch {
    return empty; // no commits, not a repo, or git unavailable
  }

  const commitsByDay: Record<string, number> = {};
  const authors = new Set<string>();
  let first: string | null = null;
  let last: string | null = null;
  let commitCount = 0;

  for (const line of log.split('\n')) {
    if (!line.trim()) continue;
    const [date, author] = line.split('\t');
    if (!date) continue;
    commitCount++;
    if (author) authors.add(author);
    const day = date.slice(0, 10);
    commitsByDay[day] = (commitsByDay[day] ?? 0) + 1;
    if (!last) last = date; // git log is newest-first
    first = date;
  }

  let linesAdded = 0;
  let linesRemoved = 0;
  const files = new Set<string>();
  try {
    const numstat = git(repoRoot, ['log', '--no-merges', '--numstat', '--pretty=format:']);
    for (const line of numstat.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const a = Number(parts[0]);
      const r = Number(parts[1]);
      if (Number.isFinite(a)) linesAdded += a;
      if (Number.isFinite(r)) linesRemoved += r;
      if (parts[2]) files.add(parts[2]);
    }
  } catch {
    /* numstat is optional */
  }

  let branches = 0;
  try {
    branches = git(repoRoot, ['branch', '--list', '--format=%(refname:short)']).split('\n').filter((s) => s.trim()).length;
  } catch {
    /* optional */
  }

  let dirty = false;
  try {
    dirty = git(repoRoot, ['status', '--porcelain']).trim().length > 0;
  } catch {
    /* optional */
  }

  return {
    commitCount,
    activeDays: Object.keys(commitsByDay).length,
    branches,
    linesAdded,
    linesRemoved,
    filesChanged: files.size,
    contributors: authors.size,
    firstCommitAt: first,
    lastCommitAt: last,
    commitsByDay,
    dirty,
  };
}

export function scanGitMetrics(projectId: string, repoRoot: string): GitMetrics {
  const m = collectGitMetrics(repoRoot);
  raw()
    .prepare(
      `INSERT INTO git_metrics (project_id, commit_count, active_days, branches, lines_added,
         lines_removed, files_changed, contributors, first_commit_at, last_commit_at,
         commits_by_day, scanned_at, dirty)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET
         commit_count=excluded.commit_count, active_days=excluded.active_days,
         branches=excluded.branches, lines_added=excluded.lines_added,
         lines_removed=excluded.lines_removed, files_changed=excluded.files_changed,
         contributors=excluded.contributors, first_commit_at=excluded.first_commit_at,
         last_commit_at=excluded.last_commit_at, commits_by_day=excluded.commits_by_day,
         scanned_at=excluded.scanned_at, dirty=excluded.dirty`,
    )
    .run(
      projectId,
      m.commitCount,
      m.activeDays,
      m.branches,
      m.linesAdded,
      m.linesRemoved,
      m.filesChanged,
      m.contributors,
      m.firstCommitAt,
      m.lastCommitAt,
      JSON.stringify(m.commitsByDay),
      new Date().toISOString(),
      m.dirty ? 1 : 0,
    );
  return m;
}

export function getGitMetrics(projectId: string): (GitMetrics & { scannedAt: string | null }) | null {
  const r = raw().prepare(`SELECT * FROM git_metrics WHERE project_id = ?`).get(projectId) as any;
  if (!r) return null;
  let commitsByDay: Record<string, number> = {};
  try {
    commitsByDay = JSON.parse(r.commits_by_day);
  } catch {
    /* ignore */
  }
  return {
    commitCount: r.commit_count,
    activeDays: r.active_days,
    branches: r.branches,
    linesAdded: r.lines_added,
    linesRemoved: r.lines_removed,
    filesChanged: r.files_changed,
    contributors: r.contributors,
    firstCommitAt: r.first_commit_at,
    lastCommitAt: r.last_commit_at,
    commitsByDay,
    dirty: !!r.dirty,
    scannedAt: r.scanned_at,
  };
}

/** Walk upward looking for .git; parse the remote from .git/config by reading
 *  the file directly — never by invoking the git binary on user input. */
export function findGitRoot(start: string): { root: string | null; remote: string | null } {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    const gitPath = path.join(dir, '.git');
    if (fs.existsSync(gitPath)) {
      let remote: string | null = null;
      try {
        const cfgPath = fs.statSync(gitPath).isDirectory()
          ? path.join(gitPath, 'config')
          : path.join(dir, '.git', 'config');
        const cfg = fs.readFileSync(cfgPath, 'utf8');
        remote = /\[remote "origin"\][^[]*?url\s*=\s*(.+)/m.exec(cfg)?.[1]?.trim() ?? null;
      } catch {
        /* config unreadable; the root is still valid */
      }
      return { root: dir, remote };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { root: null, remote: null };
}
