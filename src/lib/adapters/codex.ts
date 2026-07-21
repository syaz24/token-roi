import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  completeness,
  type FieldName,
  type NormalisedEvent,
  type PromptPolicy,
  type ScanContext,
  type SourceAdapter,
} from './types';
import { headHash, readJsonlFrom, sha1, walk } from './jsonl';

/**
 * OpenAI Codex CLI rollout history.
 *
 * VERIFIED against real files at
 * ~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl
 * (confirmed 2026-07, codex cli_version 0.143.0):
 *
 *  { "timestamp":"...", "type":"session_meta",
 *    "payload":{ "session_id":"...", "cwd":"C:\\Users\\Dev\\demo-project",
 *                "cli_version":"0.143.0", "model_provider":"openai" } }
 *
 *  { "timestamp":"...", "type":"turn_context",
 *    "payload":{ "model":"gpt-5.5", ... } }
 *
 *  { "timestamp":"...", "type":"event_msg",
 *    "payload":{ "type":"token_count",
 *      "info":{ "total_token_usage":{...},          // cumulative for session
 *               "last_token_usage":{ "input_tokens":27073,
 *                                    "cached_input_tokens":13696,
 *                                    "output_tokens":438,
 *                                    "reasoning_output_tokens":17,
 *                                    "total_tokens":27511 } } } }
 *
 * IMPORTANT semantics confirmed from the data:
 *  - `last_token_usage` is the per-request delta; `total_token_usage` is the
 *    running session total. We record ONLY the delta, otherwise a session's
 *    tokens would be counted once per turn (quadratic overcount).
 *  - `input_tokens` INCLUDES `cached_input_tokens`. We therefore subtract to
 *    get the uncached (full-price) input and bill the remainder at cache-read.
 *  - `reasoning_output_tokens` is a subset of `output_tokens`; it is surfaced
 *    for reporting but NOT added again into the total.
 *  - model lives on `turn_context`, which precedes the token_count events it
 *    applies to, so we track the most recent one while streaming the file.
 */

export const CODEX_FIELDS: FieldName[] = [
  'sessionId',
  'timestamp',
  'workingDirectory',
  'provider',
  'model',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'reasoningTokens',
  'status',
];

export function codexRoot(): string {
  return process.env.TOKEN_ROI_CODEX_ROOT ?? path.join(os.homedir(), '.codex', 'sessions');
}

export interface CodexFileState {
  sessionId: string | null;
  cwd: string | null;
  cliVersion: string | null;
  provider: string | null;
  model: string | null;
  seq: number;
}

export function newCodexState(): CodexFileState {
  return { sessionId: null, cwd: null, cliVersion: null, provider: null, model: null, seq: 0 };
}

/** Pure transform, stateful across a single file. Unit tested. */
export function normaliseCodexLine(
  obj: unknown,
  st: CodexFileState,
  file: string,
  line: number,
  _promptPolicy: PromptPolicy,
): NormalisedEvent | null {
  if (!obj || typeof obj !== 'object') return null;
  const r = obj as Record<string, any>;
  const p = r.payload;
  if (!p || typeof p !== 'object') return null;

  if (r.type === 'session_meta') {
    st.sessionId = p.session_id ?? p.id ?? st.sessionId;
    st.cwd = typeof p.cwd === 'string' ? p.cwd : st.cwd;
    st.cliVersion = p.cli_version ?? st.cliVersion;
    st.provider = p.model_provider ?? st.provider;
    if (typeof p.model === 'string') st.model = p.model;
    return null;
  }
  if (r.type === 'turn_context') {
    if (typeof p.model === 'string') st.model = p.model;
    if (typeof p.cwd === 'string') st.cwd = p.cwd;
    return null;
  }
  if (r.type !== 'event_msg' || p.type !== 'token_count') return null;

  const last = p.info?.last_token_usage;
  if (!last || typeof last !== 'object') return null;

  const rawInput = num(last.input_tokens) ?? 0;
  const cached = num(last.cached_input_tokens) ?? 0;
  const output = num(last.output_tokens) ?? 0;
  const reasoning = num(last.reasoning_output_tokens);
  // input_tokens includes cached ones; split them so each is priced correctly.
  const uncachedInput = Math.max(0, rawInput - cached);
  const total = uncachedInput + cached + output;
  if (total === 0) return null;

  st.seq += 1;
  const sessionId = st.sessionId ?? path.basename(file);
  const timestamp: string = r.timestamp ?? new Date(0).toISOString();

  return {
    eventId: sha1(`codex|${sessionId}|${st.seq}|${timestamp}`),
    source: 'codex',
    sourceVersion: st.cliVersion,
    sessionId,
    turnId: String(st.seq),
    timestamp,
    workingDirectory: st.cwd,
    detectedProjectRoot: null,
    provider: st.provider ?? 'openai',
    model: st.model,
    modelAlias: st.model,
    inputTokens: uncachedInput,
    outputTokens: output,
    cacheReadTokens: cached,
    cacheWriteTokens: null,
    reasoningTokens: reasoning,
    totalTokens: total,
    reportedCostUsd: null,
    requestType: 'message',
    status: 'ok',
    durationMs: null,
    promptPreview: null, // this format has no reliable per-request prompt text
    metadata: {
      contextWindow: p.info?.model_context_window ?? null,
      planType: p.rate_limits?.plan_type ?? null,
    },
    sourceFile: file,
    sourceLine: line,
  };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : null;
}

/**
 * Codex checkpoints must also persist the streaming state (session/model/seq),
 * because resuming mid-file would otherwise lose the model attribution set by
 * an earlier turn_context line.
 */
function encodeState(st: CodexFileState): string {
  return JSON.stringify(st);
}
function decodeState(s: string | null): CodexFileState {
  if (!s) return newCodexState();
  try {
    return { ...newCodexState(), ...(JSON.parse(s) as CodexFileState) };
  } catch {
    return newCodexState();
  }
}

export const codexAdapter: SourceAdapter = {
  id: 'codex',
  name: 'OpenAI Codex CLI rollouts',
  verifiedNote:
    'Verified against real ~/.codex/sessions/**/rollout-*.jsonl files containing event_msg/token_count records with last_token_usage deltas.',

  async detect() {
    const root = codexRoot();
    if (!fs.existsSync(root)) {
      return { available: false, rootPath: root, status: 'absent' as const, reason: 'Directory not found.' };
    }
    const files = walk(root, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), 5);
    let verified = false;
    for (const f of files.slice(0, 25)) {
      try {
        if (fs.readFileSync(f, 'utf8').includes('"last_token_usage"')) {
          verified = true;
          break;
        }
      } catch {
        /* skip */
      }
    }
    return {
      available: files.length > 0,
      rootPath: root,
      status: verified ? ('verified' as const) : ('detected-unverified' as const),
      fileCount: files.length,
      reason: verified ? undefined : 'Found rollout files but no token_count records.',
    };
  },

  async preview(limit = 10) {
    const files = walk(codexRoot(), (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), 5);
    const out: NormalisedEvent[] = [];
    let filesSeen = 0;
    for (const f of files.slice(-20)) {
      if (out.length >= limit) break;
      filesSeen++;
      const st = newCodexState();
      readJsonlFrom(
        f,
        0,
        0,
        (rec) => {
          const e = normaliseCodexLine(rec.json, st, f, rec.line, 'none');
          if (e && out.length < limit) out.push(e);
        },
        () => {},
        () => out.length >= limit,
      );
    }
    return { sampleEvents: out, filesSeen, fields: CODEX_FIELDS };
  },

  async scan(ctx: ScanContext) {
    const root = codexRoot();
    const res = { filesScanned: 0, recordsAdded: 0, recordsSkipped: 0, errors: [] as string[], warnings: [] as string[], cancelled: false };
    if (!fs.existsSync(root)) {
      res.errors.push(`Source directory missing: ${root}`);
      return res;
    }
    const files = walk(root, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), 5);
    for (const file of files) {
      if (ctx.signal?.cancelled) {
        res.cancelled = true;
        break;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch (e) {
        res.errors.push(`stat failed ${file}: ${(e as Error).message}`);
        continue;
      }
      const cp = ctx.getCheckpoint(file);
      const hh = headHash(file);
      let startOffset = cp?.byteOffset ?? 0;
      let startLine = cp?.lastLine ?? 0;
      let st = decodeState(cp?.contentHash ? extractState(cp.contentHash) : null);
      if (cp?.contentHash && hh && headOf(cp.contentHash) !== hh) {
        ctx.onWarning(`${path.basename(file)} was rewritten; re-reading from start.`);
        startOffset = 0;
        startLine = 0;
        st = newCodexState();
      }
      if (cp && startOffset === stat.size && cp.mtimeMs === stat.mtimeMs) continue;

      res.filesScanned++;
      const batch: NormalisedEvent[] = [];
      let endOffset = startOffset;
      let endLine = startLine;
      try {
        const r = readJsonlFrom(
          file,
          startOffset,
          startLine,
          (rec) => {
            const e = normaliseCodexLine(rec.json, st, file, rec.line, ctx.promptPolicy);
            if (e) batch.push(e);
            if (batch.length >= 500) {
              if (!ctx.onBatch(batch.splice(0))) throw new Error('__CANCELLED__');
            }
          },
          (line, err) => {
            res.recordsSkipped++;
            if (res.errors.length < 50) res.errors.push(`${path.basename(file)}:${line} corrupt JSON (${err})`);
          },
          () => !!ctx.signal?.cancelled,
        );
        endOffset = r.endOffset;
        endLine = r.endLine;
      } catch (e) {
        if ((e as Error).message === '__CANCELLED__') res.cancelled = true;
        else {
          res.errors.push(`read failed ${file}: ${(e as Error).message}`);
          continue;
        }
      }
      if (batch.length) ctx.onBatch(batch);
      ctx.saveCheckpoint({
        source: 'codex',
        filePath: file,
        byteOffset: endOffset,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        contentHash: `${hh ?? ''}::${encodeState(st)}`,
        lastLine: endLine,
      });
      if (res.cancelled) break;
    }
    return res;
  },

  reportCompleteness() {
    return completeness(CODEX_FIELDS, [
      'Prompt text is not captured from this source.',
      'Cache-write tokens are not distinguished by this format.',
      'input_tokens includes cached input; the adapter splits them before pricing.',
      'Per-request duration and provider-reported cost are not present.',
    ]);
  },
};

// Checkpoint contentHash for codex packs "<headHash>::<state json>".
function headOf(s: string): string {
  return s.split('::')[0] ?? '';
}
function extractState(s: string): string | null {
  const i = s.indexOf('::');
  return i === -1 ? null : s.slice(i + 2);
}
