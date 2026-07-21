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
 * Claude Code local session history.
 *
 * VERIFIED against real files at ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl.
 * Relevant record shape (confirmed 2026-07, CLI versions 2.1.191 / 2.1.207):
 *
 *   { "type":"assistant",
 *     "uuid":"...", "parentUuid":"...", "timestamp":"2026-07-13T10:14:21.525Z",
 *     "sessionId":"...", "requestId":"req_...", "cwd":"C:\\Users\\Dev\\demo-project",
 *     "version":"2.1.207", "gitBranch":"HEAD",
 *     "message": { "model":"claude-sonnet-5", "role":"assistant",
 *                  "usage": { "input_tokens":2, "output_tokens":4,
 *                             "cache_creation_input_tokens":26221,
 *                             "cache_read_input_tokens":0 } },
 *     "error":"rate_limit"?, "isApiErrorMessage":true? }
 *
 * Notes derived from the real data:
 *  - model can be the literal "<synthetic>" for locally generated messages
 *    (e.g. rate-limit notices). Those carry zero tokens and are skipped.
 *  - Non-assistant line types (mode, permission-mode, file-history-snapshot,
 *    user, summary...) carry no usage and are ignored.
 *  - There is no per-request duration or reported cost in this format.
 */

export const CLAUDE_FIELDS: FieldName[] = [
  'sessionId',
  'turnId',
  'timestamp',
  'workingDirectory',
  'provider',
  'model',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'status',
  'promptPreview',
];

export function claudeRoot(): string {
  return process.env.TOKEN_ROI_CLAUDE_ROOT ?? path.join(os.homedir(), '.claude', 'projects');
}

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Conversation state carried across a single file.
 *
 * Assistant records do not contain the prompt that caused them, so the most
 * recent real user message is tracked and attached to the events it produced.
 * That is what makes per-turn cost and prompt rankings possible.
 */
export interface ClaudeFileState {
  lastUserPrompt: string | null;
  turnIndex: number;
  /** True until the first assistant event of the current turn is emitted. */
  turnPending: boolean;
}

export function newClaudeState(): ClaudeFileState {
  return { lastUserPrompt: null, turnIndex: 0, turnPending: false };
}

/**
 * A `type:"user"` record is only a real prompt when its content is a string, or
 * a block list containing text. A list of `tool_result` blocks is the harness
 * feeding output back to the model, not something a human typed.
 */
export function extractUserPrompt(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null;
  if (Array.isArray(content)) {
    const text = content
      .filter((c) => c && typeof c === 'object' && (c as any).type === 'text')
      .map((c) => String((c as any).text ?? ''))
      .join('\n')
      .trim();
    return text || null;
  }
  return null;
}

function countToolUses(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  return content.filter((c) => c && typeof c === 'object' && (c as any).type === 'tool_use').length;
}

/** Pure transform: one raw JSONL object -> NormalisedEvent | null. Unit tested. */
export function normaliseClaudeLine(
  obj: unknown,
  file: string,
  line: number,
  promptPolicy: PromptPolicy,
  st: ClaudeFileState = newClaudeState(),
): NormalisedEvent | null {
  if (!obj || typeof obj !== 'object') return null;
  const r = obj as Record<string, any>;

  // Track the prompt that opens each turn.
  if (r.type === 'user') {
    const prompt = extractUserPrompt(r.message?.content);
    if (prompt) {
      st.lastUserPrompt = prompt;
      st.turnIndex += 1;
      st.turnPending = true;
    }
    return null;
  }

  if (r.type !== 'assistant') return null;
  const msg = r.message;
  if (!msg || typeof msg !== 'object') return null;
  const usage: ClaudeUsage = msg.usage ?? {};
  const model: string | undefined = msg.model;
  if (!model || model === '<synthetic>') return null;

  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheWrite = num(usage.cache_creation_input_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  const total = (input ?? 0) + (output ?? 0) + (cacheWrite ?? 0) + (cacheRead ?? 0);
  if (total === 0) return null; // nothing billable happened

  const timestamp: string = r.timestamp ?? new Date(0).toISOString();
  const sessionId: string = r.sessionId ?? r.session_id ?? 'unknown';
  // requestId is the most stable natural key; uuid is the fallback.
  const natural = r.requestId ?? r.uuid ?? `${file}:${line}`;

  // The stored preview is the USER's prompt for this turn, not the reply.
  let preview: string | null = null;
  if (promptPolicy !== 'none' && st.lastUserPrompt) {
    preview = truncatePreview(redact(st.lastUserPrompt), promptPolicy === 'full' ? 4000 : 300);
  }

  // Only the first assistant event of a turn is the turn's start, so per-turn
  // aggregates do not count a multi-step tool loop as many turns.
  const isTurnStart = st.turnPending;
  st.turnPending = false;

  return {
    eventId: sha1(`claude-code|${sessionId}|${natural}`),
    source: 'claude-code',
    sourceVersion: r.version ?? null,
    sessionId,
    turnId: r.uuid ?? null,
    timestamp,
    workingDirectory: typeof r.cwd === 'string' ? r.cwd : null,
    detectedProjectRoot: null,
    provider: 'anthropic',
    model,
    modelAlias: model,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: null,
    totalTokens: total,
    reportedCostUsd: null,
    requestType: r.isSidechain ? 'subagent' : 'message',
    status: r.isApiErrorMessage ? String(r.error ?? 'error') : 'ok',
    durationMs: null,
    promptPreview: preview,
    turnIndex: st.turnIndex || null,
    toolUses: countToolUses(msg.content),
    isTurnStart,
    metadata: {
      gitBranch: r.gitBranch ?? null,
      entrypoint: r.entrypoint ?? null,
      stopReason: msg.stop_reason ?? null,
      serviceTier: (msg.usage as any)?.service_tier ?? null,
    },
    sourceFile: file,
    sourceLine: line,
  };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : null;
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .filter((c) => c && typeof c === 'object' && (c as any).type === 'text')
      .map((c) => String((c as any).text ?? ''));
    return parts.length ? parts.join('\n') : null;
  }
  return null;
}

export const claudeCodeAdapter: SourceAdapter = {
  id: 'claude-code',
  name: 'Claude Code session history',
  verifiedNote:
    'Verified against real ~/.claude/projects/**/*.jsonl assistant records containing message.usage token counters.',

  async detect() {
    const root = claudeRoot();
    if (!fs.existsSync(root)) {
      return { available: false, rootPath: root, status: 'absent' as const, reason: 'Directory not found.' };
    }
    const files = walk(root, (n) => n.endsWith('.jsonl'), 3);
    // "Verified" requires actually finding a usage-bearing record, not just a folder.
    let verified = false;
    for (const f of files.slice(0, 25)) {
      try {
        const head = fs.readFileSync(f, 'utf8').slice(0, 400_000);
        if (head.includes('"usage"') && head.includes('"input_tokens"')) {
          verified = true;
          break;
        }
      } catch {
        /* unreadable file, keep looking */
      }
    }
    return {
      available: files.length > 0,
      rootPath: root,
      status: verified ? ('verified' as const) : ('detected-unverified' as const),
      fileCount: files.length,
      reason: verified ? undefined : 'Found .jsonl files but no token usage records yet.',
    };
  },

  async preview(limit = 10) {
    const files = walk(claudeRoot(), (n) => n.endsWith('.jsonl'), 3);
    const out: NormalisedEvent[] = [];
    let filesSeen = 0;
    for (const f of files) {
      if (out.length >= limit) break;
      filesSeen++;
      const pst = newClaudeState();
      readJsonlFrom(
        f,
        0,
        0,
        (rec) => {
          if (out.length >= limit) return;
          const e = normaliseClaudeLine(rec.json, f, rec.line, 'preview', pst);
          if (e) out.push(e);
        },
        () => {},
        () => out.length >= limit,
      );
    }
    return { sampleEvents: out, filesSeen, fields: CLAUDE_FIELDS };
  },

  async scan(ctx: ScanContext) {
    const root = claudeRoot();
    const res = { filesScanned: 0, recordsAdded: 0, recordsSkipped: 0, errors: [] as string[], warnings: [] as string[], cancelled: false };
    if (!fs.existsSync(root)) {
      res.errors.push(`Source directory missing: ${root}`);
      return res;
    }
    const files = walk(root, (n) => n.endsWith('.jsonl'), 3);
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
      // Conversation state is packed into the checkpoint: resuming mid-file must
      // not lose the prompt or turn number established by earlier lines.
      let st = decodeState(cp?.contentHash ?? null);
      if (cp && cp.contentHash && hh && headOf(cp.contentHash) !== hh) {
        ctx.onWarning(`${path.basename(file)} was rewritten; re-reading from start.`);
        startOffset = 0;
        startLine = 0;
        st = newClaudeState();
      }
      // Unchanged since last scan: skip without opening.
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
            const e = normaliseClaudeLine(rec.json, file, rec.line, ctx.promptPolicy, st);
            if (e) batch.push(e);
            else res.recordsSkipped++;
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
        if ((e as Error).message === '__CANCELLED__') {
          res.cancelled = true;
        } else {
          res.errors.push(`read failed ${file}: ${(e as Error).message}`);
          continue; // one bad file must not end the scan
        }
      }
      if (batch.length) ctx.onBatch(batch);
      res.recordsAdded += 0; // real count comes from the writer
      ctx.saveCheckpoint({
        source: 'claude-code',
        filePath: file,
        byteOffset: endOffset,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        contentHash: `${hh ?? ''}::${JSON.stringify(st)}`,
        lastLine: endLine,
      });
      if (res.cancelled) break;
    }
    return res;
  },

  reportCompleteness() {
    return completeness(CLAUDE_FIELDS, [
      'No per-request duration is recorded by this format.',
      'No provider-reported cost is recorded; cost is always calculated from the pricing registry.',
      'Reasoning tokens are not reported separately by this format.',
    ]);
  },
};

// Checkpoints pack "<headHash>::<state json>" so a resumed scan keeps the
// conversation context established by earlier lines in the same file.
function headOf(s: string): string {
  return s.split('::')[0] ?? '';
}

function decodeState(packed: string | null): ClaudeFileState {
  if (!packed) return newClaudeState();
  const i = packed.indexOf('::');
  if (i === -1) return newClaudeState();
  try {
    return { ...newClaudeState(), ...(JSON.parse(packed.slice(i + 2)) as ClaudeFileState) };
  } catch {
    return newClaudeState();
  }
}
