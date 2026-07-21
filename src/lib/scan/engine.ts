
import { randomUUID } from 'node:crypto';
import { raw } from '@/db/client';
import { getAdapter } from '../adapters/registry';
import type { FileCheckpoint, NormalisedEvent, PromptPolicy } from '../adapters/types';
import { PricingRegistry, type PriceRow } from '../pricing/engine';
import { matchProject, normPath, type MappingRule, type ProjectRef } from '../projects/match';
import { getSetting } from '../settings';

export interface ScanReport {
  runId: string;
  source: string;
  filesScanned: number;
  recordsAdded: number;
  recordsUpdated: number;
  recordsSkipped: number;
  errors: string[];
  warnings: string[];
  durationMs: number;
  cancelled: boolean;
  checkpointSaved: boolean;
}

/** In-process cancellation registry, keyed by run id. */
const RUNNING = new Map<string, { cancelled: boolean }>();

export function cancelScan(runId: string): boolean {
  const s = RUNNING.get(runId);
  if (!s) return false;
  s.cancelled = true;
  return true;
}

export function loadPricingRegistry(): PricingRegistry {
  const rows = raw()
    .prepare(
      `SELECT id, provider, model_id, aliases, effective_from, effective_to,
              input_per_mtok, output_per_mtok, cache_read_per_mtok,
              cache_write_per_mtok, reasoning_per_mtok, user_override
         FROM pricing`,
    )
    .all() as any[];
  const parsed: PriceRow[] = rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    modelId: r.model_id,
    aliases: safeArray(r.aliases),
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    inputPerMTok: r.input_per_mtok,
    outputPerMTok: r.output_per_mtok,
    cacheReadPerMTok: r.cache_read_per_mtok,
    cacheWritePerMTok: r.cache_write_per_mtok,
    reasoningPerMTok: r.reasoning_per_mtok,
    userOverride: !!r.user_override,
  }));
  return new PricingRegistry(parsed);
}

function safeArray(s: unknown): string[] {
  try {
    const v = JSON.parse(String(s));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function loadProjects(): ProjectRef[] {
  return (
    raw()
      .prepare(`SELECT id, path_norm, git_root, remote_url FROM projects WHERE dataset = 'real'`)
      .all() as any[]
  ).map((r) => ({ id: r.id, pathNorm: r.path_norm, gitRoot: r.git_root, remoteUrl: r.remote_url }));
}

function loadRules(): MappingRule[] {
  return (raw().prepare(`SELECT pattern, kind, project_id FROM mapping_rules`).all() as any[]).map((r) => ({
    pattern: r.pattern,
    kind: r.kind === 'exact' ? 'exact' : 'prefix',
    projectId: r.project_id,
  }));
}

/**
 * Run one source adapter to completion, writing normalised, priced, mapped
 * events into the database in batched transactions.
 *
 * Dedup is by primary key `event_id` (a stable hash), so re-scanning a file or
 * replaying a snapshot line is a no-op rather than a duplicate.
 */
export async function runScan(sourceId: string, opts: { runId?: string } = {}): Promise<ScanReport> {
  const adapter = getAdapter(sourceId);
  const runId = opts.runId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const report: ScanReport = {
    runId,
    source: sourceId,
    filesScanned: 0,
    recordsAdded: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    errors: [],
    warnings: [],
    durationMs: 0,
    cancelled: false,
    checkpointSaved: false,
  };

  if (!adapter) {
    report.errors.push(`Unknown source: ${sourceId}`);
    report.durationMs = Date.now() - t0;
    return report;
  }

  const d = raw();
  d.prepare(
    `INSERT INTO scan_runs (id, source, started_at, status) VALUES (?, ?, ?, 'running')`,
  ).run(runId, sourceId, startedAt);

  const signal = { cancelled: false };
  RUNNING.set(runId, signal);

  const pricing = loadPricingRegistry();
  const projects = loadProjects();
  const rules = loadRules();
  const promptPolicy = (getSetting('privacy.promptPolicy') ?? 'preview') as PromptPolicy;

  const selectCp = d.prepare(
    `SELECT byte_offset, mtime_ms, size_bytes, content_hash, last_line FROM scan_checkpoints WHERE source = ? AND file_path = ?`,
  );
  const upsertCp = d.prepare(
    `INSERT INTO scan_checkpoints (id, source, file_path, byte_offset, mtime_ms, size_bytes, content_hash, last_line, updated_at)
     VALUES (@id, @source, @filePath, @byteOffset, @mtimeMs, @sizeBytes, @contentHash, @lastLine, @updatedAt)
     ON CONFLICT(source, file_path) DO UPDATE SET
       byte_offset = excluded.byte_offset, mtime_ms = excluded.mtime_ms,
       size_bytes = excluded.size_bytes, content_hash = excluded.content_hash,
       last_line = excluded.last_line, updated_at = excluded.updated_at`,
  );

  const insertEvent = d.prepare(
    `INSERT OR IGNORE INTO events (
       event_id, source, source_version, session_id, turn_id, timestamp,
       working_directory, detected_project_root, project_id, mapping_method,
       provider, model, model_alias, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens,
       reported_cost_usd, calculated_cost_usd, priced, pricing_id, request_type,
       status, duration_ms, prompt_preview, turn_index, tool_uses, is_turn_start,
       metadata, source_file, source_line, dataset, imported_at
     ) VALUES (
       @eventId, @source, @sourceVersion, @sessionId, @turnId, @timestamp,
       @workingDirectory, @detectedProjectRoot, @projectId, @mappingMethod,
       @provider, @model, @modelAlias, @inputTokens, @outputTokens,
       @cacheReadTokens, @cacheWriteTokens, @reasoningTokens, @totalTokens,
       @reportedCostUsd, @calculatedCostUsd, @priced, @pricingId, @requestType,
       @status, @durationMs, @promptPreview, @turnIndex, @toolUses, @isTurnStart,
       @metadata, @sourceFile, @sourceLine, 'real', @importedAt
     )`,
  );

  const writeBatch = d.transaction((events: NormalisedEvent[]) => {
    let added = 0;
    for (const e of events) {
      const cost = pricing.cost(e.model, e.timestamp, e);
      const m = matchProject({ workingDirectory: e.workingDirectory }, projects, rules);
      const info = insertEvent.run({
        eventId: e.eventId,
        source: e.source,
        sourceVersion: e.sourceVersion,
        sessionId: e.sessionId,
        turnId: e.turnId,
        timestamp: e.timestamp,
        workingDirectory: e.workingDirectory,
        detectedProjectRoot: e.workingDirectory ? normPath(e.workingDirectory) : null,
        projectId: m.projectId,
        mappingMethod: m.method,
        provider: e.provider,
        model: e.model,
        modelAlias: e.modelAlias,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        cacheReadTokens: e.cacheReadTokens,
        cacheWriteTokens: e.cacheWriteTokens,
        reasoningTokens: e.reasoningTokens,
        totalTokens: e.totalTokens,
        reportedCostUsd: e.reportedCostUsd,
        calculatedCostUsd: cost ? cost.total : null,
        priced: cost ? 1 : 0,
        pricingId: cost ? cost.pricingId : null,
        requestType: e.requestType,
        status: e.status,
        durationMs: e.durationMs,
        promptPreview: e.promptPreview,
        turnIndex: e.turnIndex ?? null,
        toolUses: e.toolUses ?? null,
        isTurnStart: e.isTurnStart ? 1 : 0,
        metadata: e.metadata ? JSON.stringify(e.metadata) : null,
        sourceFile: e.sourceFile,
        sourceLine: e.sourceLine,
        importedAt: new Date().toISOString(),
      });
      if (info.changes > 0) added++;
    }
    return added;
  });

  try {
    const result = await adapter.scan({
      promptPolicy,
      signal,
      getCheckpoint(filePath) {
        const r = selectCp.get(sourceId, filePath) as any;
        if (!r) return null;
        return {
          source: sourceId,
          filePath,
          byteOffset: r.byte_offset,
          mtimeMs: r.mtime_ms,
          sizeBytes: r.size_bytes,
          contentHash: r.content_hash,
          lastLine: r.last_line,
        } satisfies FileCheckpoint;
      },
      saveCheckpoint(cp) {
        upsertCp.run({
          id: `${cp.source}:${cp.filePath}`,
          source: cp.source,
          filePath: cp.filePath,
          byteOffset: cp.byteOffset,
          mtimeMs: cp.mtimeMs,
          sizeBytes: cp.sizeBytes,
          contentHash: cp.contentHash,
          lastLine: cp.lastLine,
          updatedAt: new Date().toISOString(),
        });
        report.checkpointSaved = true;
      },
      onBatch(events) {
        const added = writeBatch(events);
        report.recordsAdded += added;
        report.recordsSkipped += events.length - added; // already-known events
        return !signal.cancelled;
      },
      onWarning: (m) => {
        if (report.warnings.length < 100) report.warnings.push(m);
      },
      onError: (m) => {
        if (report.errors.length < 100) report.errors.push(m);
      },
    });

    report.filesScanned = result.filesScanned;
    report.recordsSkipped += result.recordsSkipped;
    report.errors.push(...result.errors);
    report.warnings.push(...result.warnings);
    report.cancelled = result.cancelled || signal.cancelled;
  } catch (e) {
    report.errors.push(`Scan aborted: ${(e as Error).message}`);
  } finally {
    RUNNING.delete(runId);
  }

  report.durationMs = Date.now() - t0;
  const status = report.cancelled ? 'cancelled' : report.errors.length ? 'completed_with_errors' : 'completed';
  d.prepare(
    `UPDATE scan_runs SET finished_at = ?, status = ?, files_scanned = ?, records_added = ?,
       records_updated = ?, records_skipped = ?, error_count = ?, warnings = ?, errors = ?, duration_ms = ?
     WHERE id = ?`,
  ).run(
    new Date().toISOString(),
    status,
    report.filesScanned,
    report.recordsAdded,
    report.recordsUpdated,
    report.recordsSkipped,
    report.errors.length,
    JSON.stringify(report.warnings.slice(0, 100)),
    JSON.stringify(report.errors.slice(0, 100)),
    report.durationMs,
    runId,
  );
  d.prepare(
    `INSERT INTO sources (id, name, enabled, root_path, status, last_scan_at)
     VALUES (?, ?, 1, NULL, 'verified', ?)
     ON CONFLICT(id) DO UPDATE SET last_scan_at = excluded.last_scan_at`,
  ).run(sourceId, adapter.name, new Date().toISOString());

  return report;
}

/** Re-apply project mapping to every event (after adding/editing a project). */
export function remapProjects(): number {
  const d = raw();
  const projects = loadProjects();
  const rules = loadRules();
  const rows = d
    .prepare(`SELECT event_id, working_directory FROM events WHERE dataset = 'real'`)
    .all() as any[];
  const upd = d.prepare(`UPDATE events SET project_id = ?, mapping_method = ? WHERE event_id = ?`);
  const tx = d.transaction(() => {
    let n = 0;
    for (const r of rows) {
      const m = matchProject({ workingDirectory: r.working_directory }, projects, rules);
      upd.run(m.projectId, m.method, r.event_id);
      if (m.projectId) n++;
    }
    return n;
  });
  return tx();
}

/** Re-price every event using the current pricing registry. */
export function repriceAll(): { priced: number; unpriced: number } {
  const d = raw();
  const pricing = loadPricingRegistry();
  const rows = d
    .prepare(
      `SELECT event_id, model, timestamp, input_tokens, output_tokens,
              cache_read_tokens, cache_write_tokens, reasoning_tokens
         FROM events WHERE dataset = 'real'`,
    )
    .all() as any[];
  const upd = d.prepare(
    `UPDATE events SET calculated_cost_usd = ?, priced = ?, pricing_id = ? WHERE event_id = ?`,
  );
  let priced = 0;
  let unpriced = 0;
  const tx = d.transaction(() => {
    for (const r of rows) {
      const c = pricing.cost(r.model, r.timestamp, {
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheWriteTokens: r.cache_write_tokens,
        reasoningTokens: r.reasoning_tokens,
      });
      upd.run(c ? c.total : null, c ? 1 : 0, c ? c.pricingId : null, r.event_id);
      if (c) priced++;
      else unpriced++;
    }
  });
  tx();
  return { priced, unpriced };
}
