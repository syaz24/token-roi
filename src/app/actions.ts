'use server';

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { raw } from '@/db/client';
import { normPath } from '@/lib/projects/match';
import { remapProjects, repriceAll, runScan } from '@/lib/scan/engine';
import { setSetting } from '@/lib/settings';
import { autoScan, markFirstRunNoticeSeen } from '@/lib/scan/auto';
import { findGitRoot, scanGitMetrics } from '@/lib/projects/git';
import { installSampleData, removeSampleData } from '@/lib/sample';

export interface ActionResult {
  ok: boolean;
  message: string;
}

/* --------------------------- projects --------------------------- */

const ProjectInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  path: z.string().trim().min(2, 'Folder path is required').max(500),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  status: z.enum(['active', 'paused', 'shipped', 'archived']).default('active'),
  currency: z.string().trim().length(3).default('USD'),
  startedAt: z.string().trim().max(30).optional().nullable(),
  valueMethod: z.string().trim().max(40).default('manual'),
  tags: z.string().trim().max(300).optional().nullable(),
});

/**
 * Validate a folder path WITHOUT ever handing it to a shell. We only use
 * fs primitives on the literal string, so a path containing shell
 * metacharacters is inert.
 */
export async function validatePath(input: string): Promise<{
  ok: boolean;
  exists: boolean;
  isDir: boolean;
  gitRoot: string | null;
  remoteUrl: string | null;
  message: string;
}> {
  const p = String(input ?? '').trim();
  const base = { ok: false, exists: false, isDir: false, gitRoot: null, remoteUrl: null };
  if (!p) return { ...base, message: 'Enter an absolute folder path.' };
  if (!path.isAbsolute(p)) return { ...base, message: 'Path must be absolute (e.g. C:\\Users\\You\\my-project).' };

  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return {
      ...base,
      message: code === 'EACCES' || code === 'EPERM' ? 'Permission denied for that folder.' : 'Folder does not exist.',
    };
  }
  if (!stat.isDirectory()) return { ...base, exists: true, message: 'That path is a file, not a folder.' };

  const git = findGitRoot(p);
  return {
    ok: true,
    exists: true,
    isDir: true,
    gitRoot: git.root,
    remoteUrl: git.remote,
    message: git.root ? `Git repository detected at ${git.root}` : 'Folder is readable. No Git repository detected.',
  };
}


/**
 * The browser's folder picker can only give us a folder NAME — never a real
 * absolute path. Rather than guessing a username, resolve the name against the
 * actual home directory and the usual places projects live, and return the
 * first one that exists on this machine.
 *
 * Read-only: only fs.existsSync on joined paths. Nothing reaches a shell, and
 * the name is stripped of separators so it cannot escape the candidate roots.
 */
export async function resolveFolderName(name: string): Promise<{ path: string; exists: boolean }> {
  const home = os.homedir();
  const clean = String(name ?? '')
    .trim()
    .replace(/[/\\]/g, '')
    .replace(/^\.+/, '');

  if (!clean) return { path: home, exists: true };

  const roots = [
    home,
    path.join(home, 'projects'),
    path.join(home, 'Projects'),
    path.join(home, 'source'),
    path.join(home, 'source', 'repos'),
    path.join(home, 'repos'),
    path.join(home, 'dev'),
    path.join(home, 'code'),
    path.join(home, 'Documents'),
    path.join(home, 'Documents', 'GitHub'),
    path.join(home, 'Desktop'),
  ];

  for (const root of roots) {
    const candidate = path.join(root, clean);
    try {
      if (fs.statSync(candidate).isDirectory()) return { path: candidate, exists: true };
    } catch {
      /* not here, try the next root */
    }
  }
  // Nothing matched: hand back a sensible starting point under the real home
  // directory for the user to correct, rather than a fictional username.
  return { path: path.join(home, clean), exists: false };
}

/** The real home directory, used to build accurate placeholders and examples. */
export async function getHomeDir(): Promise<string> {
  return os.homedir();
}

export async function createProject(form: FormData): Promise<ActionResult> {
  const parsed = ProjectInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid project details.' };
  }
  const v = parsed.data;
  const check = await validatePath(v.path);
  if (!check.ok) return { ok: false, message: check.message };

  const pathNorm = normPath(v.path);
  const dupe = raw()
    .prepare(`SELECT name FROM projects WHERE path_norm = ? AND dataset = 'real'`)
    .get(pathNorm) as { name: string } | undefined;
  if (dupe) return { ok: false, message: `That folder is already registered as "${dupe.name}".` };

  const id = randomUUID();
  raw()
    .prepare(
      `INSERT INTO projects (id, name, path, path_norm, git_root, remote_url, description, status,
         category, currency, started_at, value_method, tags, archived, dataset, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,'real',?)`,
    )
    .run(
      id,
      v.name,
      v.path,
      pathNorm,
      check.gitRoot,
      check.remoteUrl,
      v.description || null,
      v.status,
      v.category || null,
      v.currency,
      v.startedAt || null,
      v.valueMethod,
      JSON.stringify(
        (v.tags ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
      new Date().toISOString(),
    );

  const mapped = remapProjects();
  if (check.gitRoot) {
    try {
      scanGitMetrics(id, check.gitRoot);
    } catch {
      /* git metrics are optional */
    }
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: `Added "${v.name}". ${mapped} events are now attributed to a project.` };
}

export async function updateProject(id: string, form: FormData): Promise<ActionResult> {
  const v = Object.fromEntries(form) as Record<string, string>;
  raw()
    .prepare(
      `UPDATE projects SET name = COALESCE(?, name), description = ?, category = ?, status = ?,
         currency = COALESCE(?, currency), started_at = ?, value_method = COALESCE(?, value_method),
         tags = ?, archived = ? WHERE id = ?`,
    )
    .run(
      v.name || null,
      v.description || null,
      v.category || null,
      v.status || 'active',
      v.currency || null,
      v.startedAt || null,
      v.valueMethod || null,
      JSON.stringify((v.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean)),
      v.archived === 'on' || v.archived === 'true' ? 1 : 0,
      id,
    );
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Project updated.' };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const d = raw();
  const tx = d.transaction(() => {
    d.prepare(`UPDATE events SET project_id = NULL, mapping_method = NULL WHERE project_id = ?`).run(id);
    d.prepare(`DELETE FROM value_events WHERE project_id = ?`).run(id);
    d.prepare(`DELETE FROM mapping_rules WHERE project_id = ?`).run(id);
    d.prepare(`DELETE FROM git_metrics WHERE project_id = ?`).run(id);
    d.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  });
  tx();
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Project removed. Its token events were kept and are now unassigned.' };
}

export async function assignSessionToProject(sessionId: string, projectId: string, remember: boolean): Promise<ActionResult> {
  const d = raw();
  const ev = d.prepare(`SELECT working_directory wd FROM events WHERE session_id = ? LIMIT 1`).get(sessionId) as
    | { wd: string | null }
    | undefined;
  d.prepare(`UPDATE events SET project_id = ?, mapping_method = 'manual' WHERE session_id = ?`).run(projectId, sessionId);
  if (remember && ev?.wd) {
    d.prepare(`INSERT INTO mapping_rules (id, pattern, kind, project_id, created_at) VALUES (?,?,?,?,?)`).run(
      randomUUID(),
      ev.wd,
      'prefix',
      projectId,
      new Date().toISOString(),
    );
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: remember ? 'Assigned and remembered this folder mapping.' : 'Session assigned.' };
}

export async function rescanGit(projectId: string): Promise<ActionResult> {
  const p = raw().prepare(`SELECT git_root, path FROM projects WHERE id = ?`).get(projectId) as any;
  if (!p) return { ok: false, message: 'Project not found.' };
  const root = p.git_root ?? findGitRoot(p.path).root;
  if (!root) return { ok: false, message: 'No Git repository detected for this project.' };
  try {
    const m = scanGitMetrics(projectId, root);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Indexed ${m.commitCount} commits across ${m.activeDays} active days.` };
  } catch (e) {
    return { ok: false, message: `Git scan failed: ${(e as Error).message}` };
  }
}

/* ---------------------------- value ----------------------------- */

const ValueInput = z.object({
  projectId: z.string().min(1),
  valueType: z.string().min(1).max(60),
  amount: z.coerce.number().finite(),
  currency: z.string().length(3).default('USD'),
  date: z.string().min(4),
  recurring: z.union([z.literal('on'), z.literal('true'), z.literal('')]).optional(),
  recurrencePeriod: z.string().max(20).optional().nullable(),
  recurrenceEnd: z.string().max(30).optional().nullable(),
  realised: z.union([z.literal('on'), z.literal('true'), z.literal('')]).optional(),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
  description: z.string().max(300).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  evidenceRef: z.string().max(500).optional().nullable(),
});

export async function addValueEvent(form: FormData): Promise<ActionResult> {
  const parsed = ValueInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid value entry.' };
  const v = parsed.data;
  if (!Number.isFinite(v.amount)) return { ok: false, message: 'Amount must be a number.' };

  const recurring = v.recurring === 'on' || v.recurring === 'true';
  raw()
    .prepare(
      `INSERT INTO value_events (id, project_id, value_type, amount, currency, date, recurring,
         recurrence_period, recurrence_end, realised, confidence, description, note, evidence_ref, dataset)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'real')`,
    )
    .run(
      randomUUID(),
      v.projectId,
      v.valueType,
      v.amount,
      v.currency,
      new Date(v.date).toISOString(),
      recurring ? 1 : 0,
      recurring ? (v.recurrencePeriod || 'monthly') : null,
      v.recurrenceEnd ? new Date(v.recurrenceEnd).toISOString() : null,
      v.realised === 'on' || v.realised === 'true' ? 1 : 0,
      v.confidence,
      v.description || null,
      v.note || null,
      v.evidenceRef || null,
    );
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Value entry recorded.' };
}

export async function deleteValueEvent(id: string): Promise<ActionResult> {
  raw().prepare(`DELETE FROM value_events WHERE id = ?`).run(id);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Value entry removed.' };
}

/* ------------------------ subscriptions ------------------------- */

const SubInput = z.object({
  provider: z.string().min(1).max(60),
  planName: z.string().min(1).max(80),
  monthlyPrice: z.coerce.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
  billingStart: z.string().min(4),
  billingEnd: z.string().optional().nullable(),
  billingCycle: z.enum(['monthly', 'quarterly', 'annual', 'one_time']).default('monthly'),
  seats: z.coerce.number().int().min(1).default(1),
  taxPct: z.coerce.number().min(0).max(100).default(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  allocationMethod: z
    .enum(['token_share', 'session_share', 'active_day_share', 'equal', 'manual_pct', 'direct'])
    .default('token_share'),
  allocationConfig: z.string().default('{}'),
  notes: z.string().max(500).optional().nullable(),
  active: z.union([z.literal('on'), z.literal('true'), z.literal('')]).optional(),
});

export async function saveSubscription(id: string | null, form: FormData): Promise<ActionResult> {
  const parsed = SubInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid subscription.' };
  const v = parsed.data;
  try {
    JSON.parse(v.allocationConfig || '{}');
  } catch {
    return { ok: false, message: 'Allocation config must be valid JSON.' };
  }
  const active = v.active === 'on' || v.active === 'true' ? 1 : 0;
  const d = raw();
  if (id) {
    d.prepare(
      `UPDATE subscriptions SET provider=?, plan_name=?, monthly_price=?, currency=?, billing_start=?,
         billing_end=?, billing_cycle=?, seats=?, tax_pct=?, discount_pct=?, active=?,
         allocation_method=?, allocation_config=?, notes=? WHERE id=?`,
    ).run(
      v.provider, v.planName, v.monthlyPrice, v.currency, v.billingStart, v.billingEnd || null,
      v.billingCycle, v.seats, v.taxPct, v.discountPct, active, v.allocationMethod,
      v.allocationConfig || '{}', v.notes || null, id,
    );
  } else {
    d.prepare(
      `INSERT INTO subscriptions (id, provider, plan_name, monthly_price, currency, billing_start,
         billing_end, billing_cycle, seats, tax_pct, discount_pct, active, allocation_method,
         allocation_config, notes, dataset) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'real')`,
    ).run(
      randomUUID(), v.provider, v.planName, v.monthlyPrice, v.currency, v.billingStart,
      v.billingEnd || null, v.billingCycle, v.seats, v.taxPct, v.discountPct, active,
      v.allocationMethod, v.allocationConfig || '{}', v.notes || null,
    );
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: id ? 'Subscription updated.' : 'Subscription added.' };
}

export async function deleteSubscription(id: string): Promise<ActionResult> {
  raw().prepare(`DELETE FROM subscriptions WHERE id = ?`).run(id);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Subscription removed.' };
}

/* --------------------------- pricing ---------------------------- */

const PriceInput = z.object({
  provider: z.string().min(1).max(40),
  modelId: z.string().min(1).max(120),
  aliases: z.string().max(500).optional().nullable(),
  effectiveFrom: z.string().min(4),
  effectiveTo: z.string().optional().nullable(),
  inputPerMTok: z.coerce.number().min(0),
  outputPerMTok: z.coerce.number().min(0),
  cacheReadPerMTok: z.coerce.number().min(0).default(0),
  cacheWritePerMTok: z.coerce.number().min(0).default(0),
  reasoningPerMTok: z.string().optional().nullable(),
  sourceNote: z.string().max(300).optional().nullable(),
});

export async function savePricing(id: string | null, form: FormData): Promise<ActionResult> {
  const parsed = PriceInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid pricing row.' };
  const v = parsed.data;
  const aliases = JSON.stringify((v.aliases ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const reasoning = v.reasoningPerMTok && v.reasoningPerMTok !== '' ? Number(v.reasoningPerMTok) : null;
  const d = raw();
  if (id) {
    d.prepare(
      `UPDATE pricing SET provider=?, model_id=?, aliases=?, effective_from=?, effective_to=?,
         input_per_mtok=?, output_per_mtok=?, cache_read_per_mtok=?, cache_write_per_mtok=?,
         reasoning_per_mtok=?, source_note=?, user_override=1, updated_at=? WHERE id=?`,
    ).run(
      v.provider, v.modelId, aliases, v.effectiveFrom, v.effectiveTo || null,
      v.inputPerMTok, v.outputPerMTok, v.cacheReadPerMTok, v.cacheWritePerMTok,
      reasoning, v.sourceNote || null, new Date().toISOString(), id,
    );
  } else {
    d.prepare(
      `INSERT INTO pricing (id, provider, model_id, aliases, effective_from, effective_to,
         input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok,
         reasoning_per_mtok, currency, source_note, user_override, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'USD',?,1,?)`,
    ).run(
      randomUUID(), v.provider, v.modelId, aliases, v.effectiveFrom, v.effectiveTo || null,
      v.inputPerMTok, v.outputPerMTok, v.cacheReadPerMTok, v.cacheWritePerMTok,
      reasoning, v.sourceNote || null, new Date().toISOString(),
    );
  }
  const r = repriceAll();
  revalidatePath('/', 'layout');
  return { ok: true, message: `Pricing saved. Re-priced ${r.priced} events (${r.unpriced} still unpriced).` };
}

export async function deletePricing(id: string): Promise<ActionResult> {
  raw().prepare(`DELETE FROM pricing WHERE id = ?`).run(id);
  const r = repriceAll();
  revalidatePath('/', 'layout');
  return { ok: true, message: `Pricing row removed. ${r.unpriced} events are now unpriced.` };
}

/* --------------------------- settings --------------------------- */

export async function saveSettings(form: FormData): Promise<ActionResult> {
  const entries = Object.entries(Object.fromEntries(form)) as Array<[string, string]>;
  const d = raw();
  const tx = d.transaction(() => {
    for (const [k, v] of entries) {
      if (k.startsWith('_')) continue;
      setSetting(k, String(v));
    }
  });
  tx();
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Settings saved.' };
}

export async function setDataset(dataset: 'real' | 'sample'): Promise<ActionResult> {
  setSetting('dataset', dataset);
  revalidatePath('/', 'layout');
  return { ok: true, message: dataset === 'sample' ? 'Sample data mode enabled.' : 'Switched back to real data.' };
}

export async function loadSampleData(): Promise<ActionResult> {
  const n = installSampleData();
  setSetting('dataset', 'sample');
  revalidatePath('/', 'layout');
  return { ok: true, message: `Sample dataset installed (${n} events). Real data is untouched.` };
}

export async function clearSampleData(): Promise<ActionResult> {
  removeSampleData();
  setSetting('dataset', 'real');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Sample data removed.' };
}

/* --------------------------- scanning --------------------------- */

export async function dismissFirstRunNotice(): Promise<ActionResult> {
  markFirstRunNoticeSeen();
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Dismissed.' };
}

export async function scanAllNow(): Promise<ActionResult> {
  const r = await autoScan({ force: true });
  revalidatePath('/', 'layout');
  if (!r.sources.length) {
    return { ok: false, message: 'No verified local sources were found to index.' };
  }
  return {
    ok: r.errors === 0,
    message: `Indexed ${r.sources.join(', ')} — ${r.recordsAdded} new records from ${r.filesScanned} files in ${r.durationMs}ms.`,
  };
}

export async function scanSource(sourceId: string): Promise<ActionResult> {
  const r = await runScan(sourceId);
  revalidatePath('/', 'layout');
  const bits = [
    `${r.filesScanned} files`,
    `${r.recordsAdded} added`,
    `${r.recordsSkipped} skipped`,
    `${r.errors.length} errors`,
    `${r.durationMs}ms`,
  ];
  return { ok: r.errors.length === 0, message: bits.join(' · ') };
}

export async function clearSourceData(sourceId: string): Promise<ActionResult> {
  const d = raw();
  const tx = d.transaction(() => {
    const info = d.prepare(`DELETE FROM events WHERE source = ? AND dataset = 'real'`).run(sourceId);
    d.prepare(`DELETE FROM scan_checkpoints WHERE source = ?`).run(sourceId);
    return info.changes;
  });
  const n = tx();
  revalidatePath('/', 'layout');
  return { ok: true, message: `Removed ${n} indexed records for ${sourceId}. Other sources are unaffected.` };
}

export async function toggleSource(sourceId: string, enabled: boolean): Promise<ActionResult> {
  raw()
    .prepare(
      `INSERT INTO sources (id, name, enabled, status) VALUES (?, ?, ?, 'detected')
       ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled`,
    )
    .run(sourceId, sourceId, enabled ? 1 : 0);
  revalidatePath('/', 'layout');
  return { ok: true, message: enabled ? 'Source enabled.' : 'Source disabled.' };
}

export async function clearAllIndexedData(): Promise<ActionResult> {
  const d = raw();
  const tx = d.transaction(() => {
    d.prepare(`DELETE FROM events WHERE dataset = 'real'`).run();
    d.prepare(`DELETE FROM scan_checkpoints`).run();
    d.prepare(`DELETE FROM scan_runs`).run();
  });
  tx();
  revalidatePath('/', 'layout');
  return { ok: true, message: 'All indexed token events cleared. Projects, pricing and value entries were kept.' };
}

export async function reprice(): Promise<ActionResult> {
  const r = repriceAll();
  revalidatePath('/', 'layout');
  return { ok: true, message: `Re-priced ${r.priced} events. ${r.unpriced} remain unpriced.` };
}

export async function remap(): Promise<ActionResult> {
  const n = remapProjects();
  revalidatePath('/', 'layout');
  return { ok: true, message: `${n} events are attributed to a project.` };
}
