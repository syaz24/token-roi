# Architecture

## Layer map

```
AI history files (read-only)
        │
        ▼
[1] Source adapters            src/lib/adapters/*.ts
        │  detect / preview / scan / reportCompleteness
        ▼
[2] Normalisation              src/lib/adapters/types.ts  (NormalisedEvent, zod)
        │  one schema regardless of source format
        ▼
[3] Scan engine                src/lib/scan/engine.ts
        │  prices, maps to project, batches, checkpoints
        ▼
[4] SQLite (better-sqlite3)    src/db/{ddl,schema,client,migrate}.ts
        │  WAL, dataset-partitioned, indexed
        ▼
[5] Aggregation                src/lib/pricing/*, src/lib/roi/*, src/lib/projects/*
        │  cost, allocation, ROI, recommendations
        ▼
[6] UI                         Next.js on 127.0.0.1:4783
```

Each layer only depends on the one above it. Adapters know nothing about SQL; the scan engine knows nothing about a specific file format; the ROI layer knows nothing about adapters.

### [1] Adapters

An adapter implements four methods (`SourceAdapter` in `src/lib/adapters/types.ts`):

| Method | Contract |
|---|---|
| `detect()` | Does this source exist here, and did a real file actually match the expected structure? Returns `verified` / `detected-unverified` / `absent` / `unsupported`. |
| `preview(limit)` | Parse a handful of records without writing anything, for a "this is what will be imported" view. |
| `scan(ctx)` | Stream the source, emitting batches of `NormalisedEvent` through `ctx.onBatch` and persisting per-file checkpoints. |
| `reportCompleteness()` | Which normalised fields this format can genuinely populate, plus written caveats. |

`detect()` deliberately requires evidence, not just a directory. Claude Code's detect reads up to 25 files and looks for both `"usage"` and `"input_tokens"`; Codex looks for `"last_token_usage"`; Gemini looks for `"tokens"`. A folder with no usage-bearing record yields `detected-unverified`, and `npm run scan` skips it.

### [2] Normalisation

Every adapter emits the same zod-validated `NormalisedEvent`. The 16 fields tracked for completeness (`ALL_FIELDS`) are:

`sessionId`, `turnId`, `timestamp`, `workingDirectory`, `provider`, `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`, `reportedCostUsd`, `requestType`, `status`, `durationMs`, `promptPreview`.

`completeness()` computes `round(fields.length / ALL_FIELDS.length * 100)`, so the percentage shown on the Data Sources page is a statement about the *format*, not a guess about your data.

Token-count conventions are normalised at this layer, not later:

- `inputTokens` is always **uncached** input. Codex and Gemini both report an `input` that already includes the cached portion, so the adapter subtracts (`max(0, input - cached)`).
- `cacheReadTokens` is the cached input, priced separately.
- `reasoningTokens` are reported for visibility but are already inside `output` (Codex) or already inside `total` (Gemini). They are never added again.

### [3] Scan engine

`runScan(sourceId)` in `src/lib/scan/engine.ts`:

1. Opens a `scan_runs` row with status `running` and registers an in-process cancellation flag (`cancelScan(runId)` flips it).
2. Loads the pricing registry, the project list (`dataset = 'real'`) and the mapping rules **once** per run, not per event.
3. Reads `privacy.promptPolicy` from settings and passes it to the adapter.
4. For every batch the adapter yields, inside one transaction: price the event, map it to a project, `INSERT OR IGNORE`.
5. Records the outcome on `scan_runs` (status `completed` / `completed_with_errors` / `cancelled`, counts, first 100 warnings and errors, duration) and upserts `sources.last_scan_at`.

Two maintenance passes exist so you never need to rescan files for a change that is purely derived:

| Function | Effect |
|---|---|
| `remapProjects()` | Re-runs `matchProject` over every real event; used after adding/editing a project or rule. |
| `repriceAll()` | Re-runs the pricing registry over every real event; used after editing prices. Returns `{ priced, unpriced }`. |

### [4] Storage

Hand-written ordered SQL migrations in `src/db/ddl.ts`, applied by `src/db/migrate.ts` inside a transaction and recorded in `_migrations`. Deliberately not drizzle-kit generated, so `npm run db:migrate` needs no extra tooling and the same function can run on first boot. Drizzle is used for typed reads (`src/db/schema.ts`); the scan engine uses prepared `better-sqlite3` statements directly for throughput.

Core tables: `projects`, `events`, `scan_checkpoints`, `scan_runs`, `sources`, `pricing`, `subscriptions`, `value_events`, `git_metrics`, `mapping_rules`, `settings`.

All money is stored in USD. Display currency conversion happens at render time from a manually entered rate.

---

## Dataset partition: `real` vs `sample`

Every fact table carries a `dataset TEXT NOT NULL DEFAULT 'real'` column: `projects`, `events`, `subscriptions`, `value_events`. Every query filters on it.

- `'real'` — data derived from your machine.
- `'sample'` — demonstration data.

Consequences that fall out of the design:

- `projects` is uniquely indexed on `(path_norm, dataset)`, so a sample project and a real project may share a path without colliding.
- `events_ts_idx`, `events_project_idx`, `events_model_idx` and `events_source_idx` are all **prefixed by `dataset`**, so the partition filter is served by the index rather than applied afterwards.
- The scan engine writes `'real'` unconditionally and `loadProjects()` / `remapProjects()` / `repriceAll()` all scope to `dataset = 'real'`. Sample data can never be produced by, or mutated by, a scan.

Switching the displayed dataset is a settings change (`dataset`), not a destructive operation.

---

## Incremental indexing

History files are append-only in normal operation but can be rewritten, rotated or truncated. The design assumes all four.

A `scan_checkpoints` row per `(source, file_path)` stores:

| Column | Purpose |
|---|---|
| `byte_offset` | Resume point — the offset *after* the last complete line consumed |
| `mtime_ms` | Cheap "has anything happened" test |
| `size_bytes` | Recorded file size at checkpoint time |
| `content_hash` | SHA-1 of the first 64 KB — detects rewrite vs append |
| `last_line` | Line number, so error messages stay meaningful across resumes |

Per file, per scan:

1. `stat()` the file. If stat fails, record the error and move to the next file — one bad file never ends a scan.
2. Compute `headHash(file)` (SHA-1 of the first 64 KB).
3. If a checkpoint exists and its stored head hash differs, the file was **rewritten, not appended**. The stored byte offset is meaningless, so restart from offset 0 and emit a warning ("… was rewritten; re-reading from start"). Dedup makes the re-read harmless.
4. If `byte_offset == size` **and** `mtime_ms` is unchanged, skip the file without opening it.
5. Otherwise stream from `byte_offset` in 1 MB chunks (`readJsonlFrom`).

`readJsonlFrom` guarantees:

- A **trailing partial line** (the writer is mid-append) is neither emitted nor counted in the returned offset, so the next scan re-reads it once complete. No half-written JSON is ever ingested.
- A single corrupt line calls `onCorrupt(line, err)` and is skipped. Parsing never aborts on it; the first 50 are reported per source.
- `startOffset > size` (truncation/rotation) resets to 0.

Directory discovery uses `walk()` with an explicit depth cap — 3 for Claude Code, 5 for Codex, 4 for Gemini — and swallows `readdirSync` failures so a permission-denied subtree does not abort the walk.

### Dedup by stable event id

`events.event_id` is the primary key and the writer uses `INSERT OR IGNORE`. Re-scanning a file, replaying a snapshot, or restarting a cancelled run is therefore a no-op rather than a duplicate. The hash inputs are chosen per format to be stable:

| Source | `eventId` = sha1 of |
|---|---|
| `claude-code` | `claude-code\|<sessionId>\|<requestId ?? uuid ?? file:line>` |
| `codex` | `codex\|<sessionId>\|<seq>\|<timestamp>` |
| `gemini-cli` | `gemini-cli\|<message id>` |
| `generic-*` | `<source>\|<file>\|<line>\|<sessionId>\|<timestamp>\|<total>` |

Gemini is the case that makes this load-bearing: `$set` lines re-emit the entire conversation, so the same message arrives many times in one file. Because the id is derived from the stable per-message `id`, every re-emission collapses to the same row.

### Stateful resume (Codex)

Codex model attribution comes from `turn_context` lines that *precede* the `token_count` events they apply to. Resuming mid-file from a byte offset would lose that. The Codex adapter therefore packs its streaming state into the checkpoint's `content_hash` column as `"<headHash>::<state json>"`, where the state carries `sessionId`, `cwd`, `cliVersion`, `provider`, `model` and `seq`. `headOf()` / `extractState()` split it back apart, and the head-hash comparison is done on the prefix only.

---

## Performance choices

| Choice | Reason |
|---|---|
| Batched transactions of 500 events | `d.transaction(...)` around each batch amortises fsync and statement overhead; a per-event transaction is roughly an order of magnitude slower for a ~30k-event ingest. |
| Prepared statements hoisted out of the loop | `insertEvent`, `selectCp`, `upsertCp` are prepared once per run. |
| Registry/projects/rules loaded once per run | Pricing resolution is an in-memory `Map` lookup; there is no per-event query. |
| WAL journal + `synchronous = NORMAL` | Readers (the UI) never block the writer (a scan) and vice versa. `NORMAL` trades a crash-window of the last transaction for a large write-throughput gain, acceptable for data that can be rebuilt by rescanning. |
| `dataset`-prefixed composite indexes | `(dataset, timestamp)`, `(dataset, project_id, timestamp)`, `(dataset, model)`, `(dataset, source)` cover the four dashboard access patterns without a post-filter. |
| `session_id` index | Session drill-down and session-share allocation. |
| `pricing(model_id, effective_from)` index | Registry load is a single ordered scan. |
| Byte-offset resume + mtime skip | A repeat scan with no new activity opens no files at all. |
| Streaming 1 MB chunks, never `readFileSync` during scan | A multi-hundred-MB rollout directory is processed at constant memory. |
| `walk()` depth caps | Bounds the discovery cost and avoids wandering into unrelated trees. |
| Cancellable mid-batch | `ctx.onBatch` returning `false` unwinds the scan promptly; the checkpoint written so far is still valid. |
| Pagination on event lists | Event tables are queried with limit/offset against the `(dataset, timestamp)` index rather than materialising the full set; aggregate views read pre-aggregated sums, not per-row data. |
