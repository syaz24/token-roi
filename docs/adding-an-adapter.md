# Adding an adapter

## The project rule

> **An adapter is registered only after it has been verified against real files on a real machine.**

Not against vendor documentation. Not against a format someone described. Not against a fixture you wrote yourself from an example in a changelog. Against actual history files, with a real token count you can check.

The reason is written into the code: `UNSUPPORTED_SOURCES` in `src/lib/adapters/registry.ts` lists four formats that were *not* implemented, each with the reason — three of them because no local export file existed to verify the column layout. An adapter written blind will parse *something*, produce plausible-looking numbers, and be wrong in a way nobody notices. Both non-obvious semantics in the shipped adapters — Codex's `last_token_usage` delta versus `total_token_usage` cumulative, and the fact that `input_tokens` already includes `cached_input_tokens` in both Codex and Gemini — were discovered by reading real data, not documentation. Either one, missed, silently corrupts every cost figure downstream.

If you cannot verify a format, do not register it. Add it to `UNSUPPORTED_SOURCES` with an honest reason, and point users at the generic CSV/JSONL importer.

---

## The `SourceAdapter` interface

`src/lib/adapters/types.ts`:

```ts
export interface SourceAdapter {
  id: string;
  name: string;
  /** Human-readable description of what was verified about this format. */
  verifiedNote: string;
  detect(): Promise<DetectResult>;
  preview(limit?: number): Promise<PreviewResult>;
  scan(ctx: ScanContext): Promise<ScanResult>;
  reportCompleteness(): CompletenessReport;
}
```

### `detect()`

```ts
interface DetectResult {
  available: boolean;
  rootPath: string | null;
  status: 'verified' | 'detected-unverified' | 'absent' | 'unsupported';
  reason?: string;
  fileCount?: number;
}
```

**`status: 'verified'` requires evidence, not a folder.** Every shipped adapter opens up to 25 candidate files and looks for the marker that proves the format really is what it claims: `"usage"` + `"input_tokens"` (claude-code), `"last_token_usage"` (codex), `"tokens"` (gemini-cli). Finding the directory but no usage-bearing record yields `detected-unverified` with a reason string.

This matters because `npm run scan` only scans sources that detect as `verified`. A directory that happens to contain `.jsonl` files must not cause a scan that produces nothing and reports success.

Always populate `reason` on any non-`verified` status — it is shown to the user verbatim.

Read the root from an env-overridable helper so tests can redirect it:

```ts
export function myRoot(): string {
  return process.env.TOKEN_ROI_MY_ROOT ?? path.join(os.homedir(), '.mytool', 'sessions');
}
```

### `preview(limit)`

Parses a handful of records and **writes nothing**. Returns `{ sampleEvents, filesSeen, fields }` for a "this is what will be imported" view. Always parse with `promptPolicy: 'preview'` (or `'none'` if the format has no prompt text) — never `'full'`.

### `scan(ctx)`

Streams the source and emits batches. The context you are handed:

```ts
interface ScanContext {
  getCheckpoint(filePath: string): FileCheckpoint | null;
  saveCheckpoint(cp: FileCheckpoint): void;
  /** Called per batch. Return false to request cancellation. */
  onBatch(events: NormalisedEvent[]): boolean;
  onWarning(msg: string): void;
  onError(msg: string): void;
  promptPolicy: PromptPolicy;   // 'none' | 'preview' | 'full'
  signal?: { cancelled: boolean };
}
```

Returns:

```ts
interface ScanResult {
  filesScanned: number;
  recordsAdded: number;      // the writer supplies the real count; leave 0
  recordsSkipped: number;
  errors: string[];
  warnings: string[];
  cancelled: boolean;
}
```

### `reportCompleteness()`

```ts
return completeness(MY_FIELDS, [
  'Per-request duration is not present in this format.',
  ...
]);
```

`completeness()` computes `missing` and `percentage = round(fields.length / 16 * 100)` against `ALL_FIELDS`. See "Reporting completeness honestly" below.

---

## The `NormalisedEvent` schema

Zod-validated. Every adapter emits exactly this shape.

| Field | Type | Notes |
|---|---|---|
| `eventId` | string | Stable hash. Primary key. Drives dedup. |
| `source` | string | Your adapter `id`. |
| `sourceVersion` | string \| null | CLI version if the format records one. |
| `sessionId` | string | Required, min length 1. Fall back to the file basename. |
| `turnId` | string \| null | Per-request id within the session. |
| `timestamp` | string | ISO 8601. Required. |
| `workingDirectory` | string \| null | Raw path as recorded; the engine normalises it. |
| `detectedProjectRoot` | string \| null | Leave null — the engine fills it from `workingDirectory`. |
| `provider` | string \| null | `anthropic`, `openai`, `google`, … |
| `model` | string \| null | Raw model string; the pricing registry normalises it. |
| `modelAlias` | string \| null | Usually the same as `model`. |
| `inputTokens` | int ≥ 0 \| null | **Uncached input only.** |
| `outputTokens` | int ≥ 0 \| null | |
| `cacheReadTokens` | int ≥ 0 \| null | Cached input, priced at the cache-read rate. |
| `cacheWriteTokens` | int ≥ 0 \| null | Cache creation. Null if the format does not distinguish it. |
| `reasoningTokens` | int ≥ 0 \| null | Reported for visibility; usually a subset of output. |
| `totalTokens` | int ≥ 0 | Defaults 0. Return null from the transform if this would be 0. |
| `reportedCostUsd` | number \| null | Only if the source genuinely reports a billed amount. |
| `requestType` | string \| null | e.g. `message`, `subagent`. |
| `status` | string | Defaults `ok`. |
| `durationMs` | int ≥ 0 \| null | Null unless the format records latency. |
| `promptPreview` | string \| null | Must be `redact()`ed and truncated per policy. |
| `metadata` | record \| null | Anything format-specific worth keeping. |
| `sourceFile` | string \| null | For traceability. |
| `sourceLine` | int \| null | For traceability. |

### Token-count conventions — get these right

1. **`inputTokens` is always the uncached count.** If your format's `input` already includes the cached portion (as Codex and Gemini both do), subtract: `uncachedInput = max(0, input - cached)`. Otherwise the cached tokens are billed twice — once at full input rate, once at cache-read rate.
2. **Do not add reasoning tokens into the total** if they are already inside output or total. Report them; do not re-count them.
3. **Never emit an event whose tokens sum to zero.** Return null from the transform. Zero-token records are heartbeats, notices and synthetic messages, not requests.
4. **Establish whether a counter is a delta or a running cumulative.** Codex ships both; using the cumulative one would count each session's tokens once per turn, a quadratic overcount. If your format has a `total_*` field, assume it is cumulative until you have proved otherwise by summing.
5. **Clamp and truncate:** `typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : null`.

### Structure your parse as a pure transform

Keep the raw-record → `NormalisedEvent | null` step as an exported pure function (`normaliseClaudeLine`, `normaliseCodexLine`, `normaliseGeminiLine`). It is the part that carries the format semantics, it is directly unit-testable against a captured real record, and it keeps the streaming/checkpoint machinery separate from the format knowledge.

---

## Stable event ids drive dedup

`events.event_id` is the primary key and the writer uses `INSERT OR IGNORE`. There is no other dedup mechanism. Everything about re-scan safety follows from your hash being **stable across re-reads of the same logical record**.

Shipped examples:

| Source | `eventId` = `sha1(...)` |
|---|---|
| `claude-code` | `claude-code\|<sessionId>\|<requestId ?? uuid ?? file:line>` |
| `codex` | `codex\|<sessionId>\|<seq>\|<timestamp>` |
| `gemini-cli` | `gemini-cli\|<message id>` |
| `generic-*` | `<source>\|<file>\|<line>\|<sessionId>\|<timestamp>\|<total>` |

Rules:

- **Prefix with your source id** so two sources cannot collide.
- **Prefer a natural key the format supplies** — a request id or message id. Claude Code uses `requestId` (most stable) with `uuid` as fallback. Gemini's entire correctness argument rests on its message `id`: `$set` lines re-emit the whole conversation, so the same message arrives many times per file, and only a stable id collapses them.
- **Never include the byte offset,** and avoid the line number unless nothing better exists. Both change when a file is rewritten, which turns a re-read into a duplicate.
- **A per-file sequence counter is acceptable only if you persist it in the checkpoint** — Codex does exactly this, because resuming mid-file would otherwise restart the counter and generate different ids for the same records.
- Test it: scan the same fixture twice and assert the second run adds zero rows.

---

## The checkpoint contract

```ts
interface FileCheckpoint {
  source: string;
  filePath: string;
  byteOffset: number;   // offset AFTER the last complete line consumed
  mtimeMs: number;
  sizeBytes: number;
  contentHash: string | null;   // sha1 of the first 64KB
  lastLine: number;
}
```

Per file, the shipped pattern is:

1. `fs.statSync(file)`; on failure push an error and **continue to the next file** — one bad file must never end a scan.
2. `const cp = ctx.getCheckpoint(file)`, `const hh = headHash(file)`.
3. If `cp.contentHash` exists, `hh` exists, and they differ: the file was **rewritten, not appended**. The stored offset is meaningless — reset to offset 0 and line 0, and call `ctx.onWarning('<file> was rewritten; re-reading from start.')`. Dedup makes the re-read harmless.
4. If `cp && cp.byteOffset === stat.size && cp.mtimeMs === stat.mtimeMs`: unchanged — `continue` **without opening the file**.
5. Otherwise stream from the offset with `readJsonlFrom(file, startOffset, startLine, onRecord, onCorrupt, isCancelled)`, which guarantees a trailing partial line is neither emitted nor counted, and that a corrupt line is skipped rather than fatal.
6. Push events into a `batch`; at 500, `if (!ctx.onBatch(batch.splice(0))) throw new Error('__CANCELLED__')`.
7. Flush any remaining batch, then `ctx.saveCheckpoint({...})` with the end offset, the observed `mtimeMs`/`size`, the head hash, and the end line.
8. Check `ctx.signal?.cancelled` at the top of the file loop and break out cleanly.

**Save the checkpoint even on a partial or cancelled run** — the offset written is valid up to the last complete line consumed, so the next run resumes rather than restarting.

If your adapter carries streaming state across lines (model set by an earlier record, a sequence counter), that state must survive a resume. Codex packs it into `contentHash` as `"<headHash>::<state json>"` and compares only the prefix when checking for a rewrite. Use the same trick or the equivalent.

---

## Reporting completeness honestly

`reportCompleteness()` exists so the Data Sources page can state what a format genuinely contains, rather than implying full coverage.

**List only fields you actually populate from real data.** Do not include a field because you wrote code that would populate it if present. Compare against the shipped adapters: `claude-code` claims 12 of 16 and explicitly disclaims duration, reported cost and reasoning tokens; `codex` claims 10 and disclaims prompt text, cache-write, duration and cost.

**Write caveats as prose, aimed at someone reading a number they do not trust.** Good caveats state a fact about the format and, where relevant, what the adapter does about it:

- *"No per-request duration is recorded by this format."*
- *"input_tokens includes cached input; the adapter splits them before pricing."*
- *"Snapshot ($set) lines re-emit the whole conversation; duplicates are collapsed by stable message id."*
- *"Working directory is recovered from ~/.gemini/projects.json and may be absent for older sessions."*

Bad caveats hedge (*"may not be fully accurate"*) or apologise without saying what is missing.

Set `verifiedNote` to a specific claim about what you checked, in the style of the shipped ones: *"Verified against real `~/.codex/sessions/**/rollout-*.jsonl` files containing `event_msg`/`token_count` records with `last_token_usage` deltas."* If you cannot write that sentence truthfully, the adapter is not ready to register.

---

## Checklist

1. Find and read real files. Sum a session's tokens by hand and check it against the CLI's own reported figure.
2. Write the header comment documenting the **real** record shape, including a redacted real example and every non-obvious semantic (deltas vs cumulatives, subset relationships, where the model name lives).
3. Implement the pure `normaliseXLine` transform; unit-test it against captured real records, including the zero-token and malformed cases.
4. Implement `detect()` with an evidence check, `preview()`, `scan()` with the checkpoint pattern, and `reportCompleteness()`.
5. Add a `TOKEN_ROI_X_ROOT` env override and document it.
6. Verify idempotence: scan the fixture twice, assert zero rows added the second time.
7. Verify resume: cancel mid-scan, rerun, assert the totals match an uninterrupted run.
8. Add the adapter to `ADAPTERS` in `src/lib/adapters/registry.ts` — **only now**.
9. Add a row to the coverage table in `docs/data-sources.md` and to the supported-sources table in `README.md`.
10. If pricing rows are needed for the models it emits, add them to `src/lib/pricing/seed.ts`. Do not hardcode a price anywhere else.
