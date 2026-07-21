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
import { redact, truncatePreview } from '../privacy';

/**
 * Gemini CLI chat history.
 *
 * VERIFIED against real files at ~/.gemini/tmp/<projectDir>/chats/session-*.jsonl
 * (confirmed 2026-07). Structure:
 *
 *  line 1: { "sessionId":"...", "projectHash":"...", "startTime":"...", "kind":"main" }
 *  then a mix of:
 *    - full-snapshot rewrites: { "$set": { "messages": [ <message>, ... ] } }
 *    - individual messages:    { "id","timestamp","type","content", ... }
 *
 *  A gemini (assistant) message carries:
 *    { "id":"3398d753-...", "timestamp":"2026-06-12T13:12:17.258Z",
 *      "type":"gemini", "model":"gemini-3-flash-preview",
 *      "tokens": { "input":12577, "output":161, "cached":3815,
 *                  "thoughts":389, "tool":0, "total":13127 } }
 *
 * Semantics confirmed from the data:
 *  - total == input + output + thoughts, so `cached` is a SUBSET of `input`
 *    (same convention as Codex). Uncached input = input - cached.
 *  - `thoughts` are reasoning tokens and are already counted in `total` but
 *    NOT inside `output`.
 *  - Because $set lines re-emit the whole conversation, the same message
 *    appears many times. `id` is stable, so eventId derived from it makes
 *    re-emission a no-op via INSERT OR IGNORE.
 *
 * The working directory is recovered from ~/.gemini/projects.json, which maps
 * an absolute path to the tmp directory name.
 */

export const GEMINI_FIELDS: FieldName[] = [
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
  'promptPreview',
];

export function geminiRoot(): string {
  return process.env.TOKEN_ROI_GEMINI_ROOT ?? path.join(os.homedir(), '.gemini', 'tmp');
}

/** Reverse ~/.gemini/projects.json ("<abs path>": "<tmp dir name>") -> dir -> path. */
export function geminiProjectDirMap(): Record<string, string> {
  const file = path.join(path.dirname(geminiRoot()), 'projects.json');
  const out: Record<string, string> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { projects?: Record<string, string> };
    for (const [abs, dir] of Object.entries(raw.projects ?? {})) {
      if (!(dir in out)) out[dir] = abs;
    }
  } catch {
    /* optional file */
  }
  return out;
}

export interface GeminiFileState {
  sessionId: string | null;
  cwd: string | null;
}

/** Pure transform. Emits zero or more events (a $set line yields many). */
export function normaliseGeminiLine(
  obj: unknown,
  st: GeminiFileState,
  file: string,
  line: number,
  promptPolicy: PromptPolicy,
): NormalisedEvent[] {
  if (!obj || typeof obj !== 'object') return [];
  const r = obj as Record<string, any>;

  if (typeof r.sessionId === 'string' && r.startTime) {
    st.sessionId = r.sessionId;
    return [];
  }
  const messages: unknown[] = Array.isArray(r?.$set?.messages)
    ? r.$set.messages
    : r.tokens || r.type
      ? [r]
      : [];

  const out: NormalisedEvent[] = [];
  for (const m of messages) {
    const e = normaliseGeminiMessage(m, st, file, line, promptPolicy);
    if (e) out.push(e);
  }
  return out;
}

function normaliseGeminiMessage(
  m: unknown,
  st: GeminiFileState,
  file: string,
  line: number,
  promptPolicy: PromptPolicy,
): NormalisedEvent | null {
  if (!m || typeof m !== 'object') return null;
  const msg = m as Record<string, any>;
  const t = msg.tokens;
  if (!t || typeof t !== 'object') return null;

  const input = num(t.input) ?? 0;
  const cached = num(t.cached) ?? 0;
  const output = num(t.output) ?? 0;
  const thoughts = num(t.thoughts);
  const uncachedInput = Math.max(0, input - cached);
  const total = num(t.total) ?? uncachedInput + cached + output + (thoughts ?? 0);
  if (total === 0) return null;

  const id: string = msg.id ?? `${file}:${line}`;
  const sessionId = st.sessionId ?? path.basename(file, '.jsonl');

  let preview: string | null = null;
  if (promptPolicy !== 'none' && typeof msg.content === 'string') {
    preview = truncatePreview(redact(msg.content), promptPolicy === 'full' ? 4000 : 160);
  }

  return {
    eventId: sha1(`gemini-cli|${id}`),
    source: 'gemini-cli',
    sourceVersion: null,
    sessionId,
    turnId: id,
    timestamp: msg.timestamp ?? new Date(0).toISOString(),
    workingDirectory: st.cwd,
    detectedProjectRoot: null,
    provider: 'google',
    model: msg.model ?? null,
    modelAlias: msg.model ?? null,
    inputTokens: uncachedInput,
    outputTokens: output,
    cacheReadTokens: cached,
    cacheWriteTokens: null,
    reasoningTokens: thoughts,
    totalTokens: total,
    reportedCostUsd: null,
    requestType: 'message',
    status: 'ok',
    durationMs: null,
    promptPreview: preview,
    // This format exposes no turn numbering or tool-call counts.
    turnIndex: null,
    toolUses: null,
    isTurnStart: false,
    metadata: { toolTokens: num(t.tool) },
    sourceFile: file,
    sourceLine: line,
  };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : null;
}

function cwdForFile(file: string, map: Record<string, string>): string | null {
  // .../.gemini/tmp/<projectDir>/chats/session-*.jsonl
  const parts = file.replace(/\\/g, '/').split('/');
  const i = parts.lastIndexOf('chats');
  const dir = i > 0 ? parts[i - 1] : null;
  return dir ? (map[dir] ?? null) : null;
}

export const geminiAdapter: SourceAdapter = {
  id: 'gemini-cli',
  name: 'Gemini CLI chat history',
  verifiedNote:
    'Verified against real ~/.gemini/tmp/*/chats/session-*.jsonl messages carrying a tokens {input, output, cached, thoughts, total} object.',

  async detect() {
    const root = geminiRoot();
    if (!fs.existsSync(root)) {
      return { available: false, rootPath: root, status: 'absent' as const, reason: 'Directory not found.' };
    }
    const files = walk(root, (n, f) => n.endsWith('.jsonl') && f.includes('/chats/'), 4);
    let verified = false;
    for (const f of files.slice(0, 25)) {
      try {
        if (fs.readFileSync(f, 'utf8').includes('"tokens"')) {
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
      reason: verified ? undefined : 'Found chat files but no token records.',
    };
  },

  async preview(limit = 10) {
    const map = geminiProjectDirMap();
    const files = walk(geminiRoot(), (n, f) => n.endsWith('.jsonl') && f.includes('/chats/'), 4);
    const out: NormalisedEvent[] = [];
    let filesSeen = 0;
    for (const f of files) {
      if (out.length >= limit) break;
      filesSeen++;
      const st: GeminiFileState = { sessionId: null, cwd: cwdForFile(f, map) };
      readJsonlFrom(
        f,
        0,
        0,
        (rec) => {
          for (const e of normaliseGeminiLine(rec.json, st, f, rec.line, 'preview')) {
            if (out.length < limit) out.push(e);
          }
        },
        () => {},
        () => out.length >= limit,
      );
    }
    return { sampleEvents: out, filesSeen, fields: GEMINI_FIELDS };
  },

  async scan(ctx: ScanContext) {
    const root = geminiRoot();
    const res = { filesScanned: 0, recordsAdded: 0, recordsSkipped: 0, errors: [] as string[], warnings: [] as string[], cancelled: false };
    if (!fs.existsSync(root)) {
      res.errors.push(`Source directory missing: ${root}`);
      return res;
    }
    const map = geminiProjectDirMap();
    const files = walk(root, (n, f) => n.endsWith('.jsonl') && f.includes('/chats/'), 4);
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
      if (cp?.contentHash && hh && cp.contentHash !== hh) {
        startOffset = 0;
        startLine = 0;
      }
      if (cp && startOffset === stat.size && cp.mtimeMs === stat.mtimeMs) continue;

      res.filesScanned++;
      const st: GeminiFileState = { sessionId: null, cwd: cwdForFile(file, map) };
      const batch: NormalisedEvent[] = [];
      let endOffset = startOffset;
      let endLine = startLine;
      try {
        const r = readJsonlFrom(
          file,
          startOffset,
          startLine,
          (rec) => {
            for (const e of normaliseGeminiLine(rec.json, st, file, rec.line, ctx.promptPolicy)) {
              batch.push(e);
            }
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
        source: 'gemini-cli',
        filePath: file,
        byteOffset: endOffset,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        contentHash: hh,
        lastLine: endLine,
      });
      if (res.cancelled) break;
    }
    return res;
  },

  reportCompleteness() {
    return completeness(GEMINI_FIELDS, [
      'Snapshot ($set) lines re-emit the whole conversation; duplicates are collapsed by stable message id.',
      'Working directory is recovered from ~/.gemini/projects.json and may be absent for older sessions.',
      'Cache-write tokens, duration and reported cost are not present in this format.',
    ]);
  },
};
