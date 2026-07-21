import fs from 'node:fs';
import path from 'node:path';
import {
  completeness,
  type FieldName,
  type NormalisedEvent,
  type ScanContext,
  type SourceAdapter,
} from './types';
import { readJsonlFrom, sha1 } from './jsonl';
import { redact, truncatePreview } from '../privacy';

/**
 * Generic importers for files the user points at explicitly.
 *
 * These never auto-discover anything: the path comes from an explicit import
 * action in the UI, held in TOKEN_ROI_IMPORT_FILE for a single scan run.
 */

const GENERIC_FIELDS: FieldName[] = [
  'sessionId',
  'timestamp',
  'model',
  'provider',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'reasoningTokens',
  'workingDirectory',
  'status',
];

/** Tolerant field lookup: accepts snake_case, camelCase and common synonyms. */
function pick(row: Record<string, unknown>, names: string[]): unknown {
  const keys = Object.keys(row);
  for (const n of names) {
    const hit = keys.find((k) => k.toLowerCase().replace(/[\s_-]/g, '') === n.toLowerCase().replace(/[\s_-]/g, ''));
    if (hit !== undefined && row[hit] !== '' && row[hit] != null) return row[hit];
  }
  return undefined;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

function toFloat(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function normaliseGenericRow(
  row: Record<string, unknown>,
  source: string,
  file: string,
  line: number,
  promptPolicy: 'none' | 'preview' | 'full',
): NormalisedEvent | null {
  const input = toNum(pick(row, ['inputTokens', 'input', 'promptTokens', 'prompt_tokens', 'tokens_in']));
  const output = toNum(pick(row, ['outputTokens', 'output', 'completionTokens', 'completion_tokens', 'tokens_out']));
  const cacheRead = toNum(pick(row, ['cacheReadTokens', 'cachedTokens', 'cache_read', 'cached']));
  const cacheWrite = toNum(pick(row, ['cacheWriteTokens', 'cacheCreationTokens', 'cache_write']));
  const reasoning = toNum(pick(row, ['reasoningTokens', 'thoughts', 'reasoning']));
  const explicitTotal = toNum(pick(row, ['totalTokens', 'total', 'tokens']));

  const summed = (input ?? 0) + (output ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
  const total = summed > 0 ? summed : (explicitTotal ?? 0);
  if (total === 0) return null;

  const ts = pick(row, ['timestamp', 'date', 'time', 'created_at', 'createdAt']);
  const timestamp = ts ? new Date(String(ts)).toISOString() : new Date(0).toISOString();
  const sessionId = String(pick(row, ['sessionId', 'session', 'conversationId', 'id']) ?? `${path.basename(file)}#${line}`);
  const model = pick(row, ['model', 'modelId', 'model_name']);
  const cwd = pick(row, ['workingDirectory', 'cwd', 'project', 'projectPath', 'directory']);

  const promptRaw = pick(row, ['prompt', 'promptPreview', 'input_text', 'message']);
  let preview: string | null = null;
  if (promptPolicy !== 'none' && typeof promptRaw === 'string') {
    preview = truncatePreview(redact(promptRaw), promptPolicy === 'full' ? 4000 : 160);
  }

  return {
    eventId: sha1(`${source}|${file}|${line}|${sessionId}|${timestamp}|${total}`),
    source,
    sourceVersion: null,
    sessionId,
    turnId: null,
    timestamp,
    workingDirectory: cwd ? String(cwd) : null,
    detectedProjectRoot: null,
    provider: pick(row, ['provider', 'vendor']) ? String(pick(row, ['provider', 'vendor'])) : null,
    model: model ? String(model) : null,
    modelAlias: model ? String(model) : null,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: reasoning,
    totalTokens: total,
    reportedCostUsd: toFloat(pick(row, ['costUsd', 'cost', 'reportedCost', 'amount', 'spend'])),
    requestType: null,
    status: String(pick(row, ['status']) ?? 'ok'),
    durationMs: toNum(pick(row, ['durationMs', 'duration', 'latencyMs'])),
    promptPreview: preview,
    // Conversation shape is not part of the generic import contract.
    turnIndex: null,
    toolUses: null,
    isTurnStart: false,
    metadata: null,
    sourceFile: file,
    sourceLine: line,
  };
}

/** RFC4180-ish CSV parser: handles quotes, escaped quotes and embedded newlines. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, (r[idx] ?? '').trim()])));
}

function importTarget(): string | null {
  return process.env.TOKEN_ROI_IMPORT_FILE || null;
}

export const genericJsonlAdapter: SourceAdapter = {
  id: 'generic-jsonl',
  name: 'Generic JSON / JSONL import',
  verifiedNote: 'Operates only on a file you select explicitly. Field names are matched tolerantly.',

  async detect() {
    const t = importTarget();
    return {
      available: !!t,
      rootPath: t,
      status: t ? ('verified' as const) : ('absent' as const),
      reason: t ? undefined : 'Select a file to import from the Data Sources page.',
    };
  },

  async preview(limit = 10) {
    const t = importTarget();
    const out: NormalisedEvent[] = [];
    if (t && fs.existsSync(t)) {
      for (const { row, line } of readGenericJson(t)) {
        if (out.length >= limit) break;
        const e = normaliseGenericRow(row, 'generic-jsonl', t, line, 'preview');
        if (e) out.push(e);
      }
    }
    return { sampleEvents: out, filesSeen: t ? 1 : 0, fields: GENERIC_FIELDS };
  },

  async scan(ctx: ScanContext) {
    const res = { filesScanned: 0, recordsAdded: 0, recordsSkipped: 0, errors: [] as string[], warnings: [] as string[], cancelled: false };
    const t = importTarget();
    if (!t) {
      res.warnings.push('No import file selected.');
      return res;
    }
    if (!fs.existsSync(t)) {
      res.errors.push(`Import file not found: ${t}`);
      return res;
    }
    res.filesScanned = 1;
    const batch: NormalisedEvent[] = [];
    for (const { row, line } of readGenericJson(t)) {
      if (ctx.signal?.cancelled) {
        res.cancelled = true;
        break;
      }
      const e = normaliseGenericRow(row, 'generic-jsonl', t, line, ctx.promptPolicy);
      if (e) batch.push(e);
      else res.recordsSkipped++;
      if (batch.length >= 500 && !ctx.onBatch(batch.splice(0))) {
        res.cancelled = true;
        break;
      }
    }
    if (batch.length) ctx.onBatch(batch);
    return res;
  },

  reportCompleteness() {
    return completeness(GENERIC_FIELDS, ['Completeness depends entirely on the columns present in your file.']);
  },
};

/** Yields rows from either a JSON array file or a JSONL file. */
function* readGenericJson(file: string): Generator<{ row: Record<string, unknown>; line: number }> {
  const text = fs.readFileSync(file, 'utf8');
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(text) as unknown[];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] && typeof arr[i] === 'object') yield { row: arr[i] as Record<string, unknown>, line: i + 1 };
      }
    } catch {
      /* fall through to line mode */
    }
    return;
  }
  const rows: Array<{ row: Record<string, unknown>; line: number }> = [];
  readJsonlFrom(
    file,
    0,
    0,
    (rec) => {
      if (rec.json && typeof rec.json === 'object') rows.push({ row: rec.json as Record<string, unknown>, line: rec.line });
    },
    () => {},
  );
  yield* rows;
}

export const genericCsvAdapter: SourceAdapter = {
  id: 'generic-csv',
  name: 'Generic CSV import',
  verifiedNote: 'Operates only on a file you select explicitly. Headers are matched tolerantly.',

  async detect() {
    const t = importTarget();
    const isCsv = !!t && t.toLowerCase().endsWith('.csv');
    return {
      available: isCsv,
      rootPath: t,
      status: isCsv ? ('verified' as const) : ('absent' as const),
      reason: isCsv ? undefined : 'Select a .csv file to import from the Data Sources page.',
    };
  },

  async preview(limit = 10) {
    const t = importTarget();
    const out: NormalisedEvent[] = [];
    if (t && fs.existsSync(t)) {
      const rows = parseCsv(fs.readFileSync(t, 'utf8'));
      rows.slice(0, limit * 3).forEach((r, i) => {
        const e = normaliseGenericRow(r, 'generic-csv', t, i + 2, 'preview');
        if (e && out.length < limit) out.push(e);
      });
    }
    return { sampleEvents: out, filesSeen: t ? 1 : 0, fields: GENERIC_FIELDS };
  },

  async scan(ctx: ScanContext) {
    const res = { filesScanned: 0, recordsAdded: 0, recordsSkipped: 0, errors: [] as string[], warnings: [] as string[], cancelled: false };
    const t = importTarget();
    if (!t || !fs.existsSync(t)) {
      res.errors.push(t ? `Import file not found: ${t}` : 'No import file selected.');
      return res;
    }
    res.filesScanned = 1;
    let rows: Array<Record<string, string>>;
    try {
      rows = parseCsv(fs.readFileSync(t, 'utf8'));
    } catch (e) {
      res.errors.push(`CSV parse failed: ${(e as Error).message}`);
      return res;
    }
    const batch: NormalisedEvent[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (ctx.signal?.cancelled) {
        res.cancelled = true;
        break;
      }
      try {
        const e = normaliseGenericRow(rows[i], 'generic-csv', t, i + 2, ctx.promptPolicy);
        if (e) batch.push(e);
        else res.recordsSkipped++;
      } catch (err) {
        res.recordsSkipped++;
        if (res.errors.length < 50) res.errors.push(`row ${i + 2}: ${(err as Error).message}`);
      }
      if (batch.length >= 500 && !ctx.onBatch(batch.splice(0))) {
        res.cancelled = true;
        break;
      }
    }
    if (batch.length) ctx.onBatch(batch);
    return res;
  },

  reportCompleteness() {
    return completeness(GENERIC_FIELDS, ['Completeness depends entirely on the columns present in your file.']);
  },
};
