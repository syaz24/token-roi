/**
 * Map a token event's working directory to a registered project.
 *
 * Precedence (first hit wins), matching the documented rules:
 *   1. exact repository/project root match
 *   2. child folder of a registered project (deepest root wins)
 *   3. git remote match
 *   4. manual mapping rule
 *   5. unassigned
 */

export type MappingMethod = 'exact' | 'child' | 'remote' | 'manual' | null;

export interface ProjectRef {
  id: string;
  pathNorm: string;
  gitRoot?: string | null;
  remoteUrl?: string | null;
}

export interface MappingRule {
  pattern: string;
  kind: 'prefix' | 'exact';
  projectId: string;
}

/** Windows paths are case-insensitive and mix separators; normalise hard. */
export function normPath(p: string): string {
  return p
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/^([a-zA-Z]):/, (_m, d: string) => `${d.toLowerCase()}:`)
    .toLowerCase();
}

/** True when `child` is the same as, or nested inside, `parent`. */
export function isWithin(parent: string, child: string): boolean {
  if (child === parent) return true;
  return child.startsWith(`${parent}/`);
}

export function normaliseRemote(url: string): string {
  return url
    .trim()
    .toLowerCase()
    // Strip any trailing slash FIRST, otherwise "…/repo.git/" keeps its .git
    // suffix and fails to match the same remote written as "…/repo".
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\/+$/, '');
}

export interface MatchInput {
  workingDirectory?: string | null;
  remoteUrl?: string | null;
}

export function matchProject(
  input: MatchInput,
  projects: ProjectRef[],
  rules: MappingRule[] = [],
): { projectId: string | null; method: MappingMethod } {
  const cwd = input.workingDirectory ? normPath(input.workingDirectory) : null;

  if (cwd) {
    for (const p of projects) {
      if (p.pathNorm === cwd || (p.gitRoot && normPath(p.gitRoot) === cwd)) {
        return { projectId: p.id, method: 'exact' };
      }
    }
    // Deepest containing root wins, so a nested project beats its parent.
    let best: { p: ProjectRef; len: number } | null = null;
    for (const p of projects) {
      const roots = [p.pathNorm, p.gitRoot ? normPath(p.gitRoot) : null].filter(Boolean) as string[];
      for (const root of roots) {
        if (isWithin(root, cwd) && (!best || root.length > best.len)) best = { p, len: root.length };
      }
    }
    if (best) return { projectId: best.p.id, method: 'child' };
  }

  if (input.remoteUrl) {
    const r = normaliseRemote(input.remoteUrl);
    const hit = projects.find((p) => p.remoteUrl && normaliseRemote(p.remoteUrl) === r);
    if (hit) return { projectId: hit.id, method: 'remote' };
  }

  if (cwd) {
    for (const rule of rules) {
      const pat = normPath(rule.pattern);
      if (rule.kind === 'exact' ? cwd === pat : isWithin(pat, cwd)) {
        return { projectId: rule.projectId, method: 'manual' };
      }
    }
  }

  return { projectId: null, method: null };
}
