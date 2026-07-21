# Data sources

Every statement below was verified against real local files. Where a format does not contain something, that is stated rather than approximated.

Field-completeness percentages are computed against the 16 fields in `ALL_FIELDS` (`src/lib/adapters/types.ts`):

`sessionId`, `turnId`, `timestamp`, `workingDirectory`, `provider`, `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`, `reportedCostUsd`, `requestType`, `status`, `durationMs`, `promptPreview`.

## Coverage summary

| Field | claude-code | codex | gemini-cli | generic |
|---|:--:|:--:|:--:|:--:|
| sessionId | yes | yes | yes | yes |
| turnId | yes | yes (sequence) | yes (message id) | no |
| timestamp | yes | yes | yes | yes |
| workingDirectory | yes (`cwd`) | yes (`cwd`) | yes (via `projects.json`) | yes |
| provider | yes (`anthropic`) | yes (`model_provider`) | yes (`google`) | yes |
| model | yes | yes (`turn_context`) | yes | yes |
| inputTokens | yes | yes (uncached) | yes (uncached) | yes |
| outputTokens | yes | yes | yes | yes |
| cacheReadTokens | yes | yes | yes | yes |
| cacheWriteTokens | **yes** | no | no | yes |
| reasoningTokens | no | **yes** | **yes** | yes |
| reportedCostUsd | no | no | no | maybe |
| requestType | yes | yes (`message`) | yes (`message`) | no |
| status | yes | yes | yes | yes |
| durationMs | no | no | no | maybe |
| promptPreview | yes | no | yes | yes |
| **Fields / 16** | 12 (75%) | 10 (63%) | 11 (69%) | 10 (63%) |

Cache-write is claude-code only. Reasoning tokens are codex and gemini-cli only. No verified source reports duration or provider cost.

---

## claude-code — Claude Code session history

**Root:** `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` (override: `TOKEN_ROI_CLAUDE_ROOT`). Walk depth 3, files matching `*.jsonl`.

**Verified 2026-07 against CLI versions 2.1.191 and 2.1.207.** Relevant record:

```json
{ "type":"assistant",
  "uuid":"...", "parentUuid":"...", "timestamp":"2026-07-13T10:14:21.525Z",
  "sessionId":"...", "requestId":"req_...", "cwd":"C:\\Users\\Dev\\demo-project",
  "version":"2.1.207", "gitBranch":"HEAD",
  "message": { "model":"claude-sonnet-5", "role":"assistant",
               "usage": { "input_tokens":2, "output_tokens":4,
                          "cache_creation_input_tokens":26221,
                          "cache_read_input_tokens":0 } },
  "error":"rate_limit"?, "isApiErrorMessage":true? }
```

**Mapping**

| Raw | Normalised |
|---|---|
| `message.usage.input_tokens` | `inputTokens` |
| `message.usage.output_tokens` | `outputTokens` |
| `message.usage.cache_creation_input_tokens` | `cacheWriteTokens` |
| `message.usage.cache_read_input_tokens` | `cacheReadTokens` |
| sum of all four | `totalTokens` |
| `message.model` | `model`, `modelAlias`; `provider` is hardcoded `anthropic` |
| `cwd` | `workingDirectory` |
| `sessionId` | `sessionId` |
| `uuid` | `turnId` |
| `version` | `sourceVersion` |
| `isSidechain` | `requestType` = `subagent`, else `message` |
| `isApiErrorMessage` | `status` = `String(error ?? 'error')`, else `ok` |
| `gitBranch`, `entrypoint`, `message.stop_reason`, `usage.service_tier` | `metadata` |

**Event id:** `sha1("claude-code|<sessionId>|<requestId ?? uuid ?? file:line>")`. `requestId` is the most stable natural key; `uuid` is the fallback.

**Skips**

- Any line whose `type` is not `assistant` (mode, permission-mode, file-history-snapshot, user, summary…). These carry no usage.
- `model === "<synthetic>"` — locally generated messages such as rate-limit notices. They carry zero tokens and are not real requests.
- Records whose four token counters sum to zero — nothing billable happened.

**Caveats (as reported by `reportCompleteness`)**

- No per-request duration is recorded by this format.
- No provider-reported cost is recorded; cost is always calculated from the pricing registry.
- Reasoning tokens are not reported separately by this format.

Unlike the other two sources, `input_tokens` here is already the uncached input — cache reads are a separate counter — so no subtraction is needed.

---

## codex — OpenAI Codex CLI rollouts

**Root:** `~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl` (override: `TOKEN_ROI_CODEX_ROOT`). Walk depth 5, files named `rollout-*.jsonl`.

**Verified 2026-07 against codex `cli_version` 0.143.0.** Three relevant line types:

```json
{ "timestamp":"...", "type":"session_meta",
  "payload":{ "session_id":"...", "cwd":"C:\\Users\\Dev\\demo-project",
              "cli_version":"0.143.0", "model_provider":"openai" } }

{ "timestamp":"...", "type":"turn_context",
  "payload":{ "model":"gpt-5.5", ... } }

{ "timestamp":"...", "type":"event_msg",
  "payload":{ "type":"token_count",
    "info":{ "total_token_usage":{ ... },
             "last_token_usage":{ "input_tokens":27073,
                                  "cached_input_tokens":13696,
                                  "output_tokens":438,
                                  "reasoning_output_tokens":17,
                                  "total_tokens":27511 } } } }
```

### Critical semantics

1. **`last_token_usage` is the per-request delta; `total_token_usage` is the running session cumulative.** The adapter records **only the delta**. Using the cumulative figure would count a session's tokens once per turn — a quadratic overcount that grows with conversation length.
2. **`input_tokens` INCLUDES `cached_input_tokens`.** The adapter subtracts to get full-price input:
   ```
   uncachedInput = max(0, input_tokens - cached_input_tokens)
   total         = uncachedInput + cached_input_tokens + output_tokens
   ```
   so the cached portion is billed at the cache-read rate and never double-charged at the input rate.
3. **`reasoning_output_tokens` is a subset of `output_tokens`.** It is surfaced as `reasoningTokens` for reporting but is not added into the total again.
4. **Model comes from `turn_context`,** which precedes the `token_count` events it applies to. The adapter tracks the most recent one while streaming, and persists that streaming state into the checkpoint so a mid-file resume does not lose model attribution (see `docs/architecture.md`).

**Mapping**

| Raw | Normalised |
|---|---|
| `session_meta.payload.session_id` | `sessionId` |
| `session_meta.payload.cwd` / `turn_context.payload.cwd` | `workingDirectory` |
| `session_meta.payload.cli_version` | `sourceVersion` |
| `session_meta.payload.model_provider` | `provider` (default `openai`) |
| `turn_context.payload.model` | `model`, `modelAlias` |
| `last_token_usage.input_tokens - cached_input_tokens` | `inputTokens` |
| `last_token_usage.cached_input_tokens` | `cacheReadTokens` |
| `last_token_usage.output_tokens` | `outputTokens` |
| `last_token_usage.reasoning_output_tokens` | `reasoningTokens` |
| per-file counter | `turnId` (`seq`) |
| `info.model_context_window`, `rate_limits.plan_type` | `metadata` |

**Event id:** `sha1("codex|<sessionId>|<seq>|<timestamp>")`.

**Caveats**

- Prompt text is not captured from this source (`promptPreview` is always NULL — the format has no reliable per-request prompt text).
- Cache-write tokens are not distinguished by this format.
- `input_tokens` includes cached input; the adapter splits them before pricing.
- Per-request duration and provider-reported cost are not present.
- `status` is always `ok`; the format does not mark request failures at this level.

---

## gemini-cli — Gemini CLI chat history

**Root:** `~/.gemini/tmp/<projectDir>/chats/session-*.jsonl` (override: `TOKEN_ROI_GEMINI_ROOT`). Walk depth 4, `*.jsonl` files under a `chats/` directory.

**Verified 2026-07.** Structure:

```
line 1: { "sessionId":"...", "projectHash":"...", "startTime":"...", "kind":"main" }
then a mix of:
  full-snapshot rewrites:  { "$set": { "messages": [ <message>, ... ] } }
  individual messages:     { "id", "timestamp", "type", "content", ... }
```

An assistant message:

```json
{ "id":"3398d753-...", "timestamp":"2026-06-12T13:12:17.258Z",
  "type":"gemini", "model":"gemini-3-flash-preview",
  "tokens": { "input":12577, "output":161, "cached":3815,
              "thoughts":389, "tool":0, "total":13127 } }
```

### Critical semantics

1. **`total == input + output + thoughts`**, therefore `cached` is a **subset of `input`** — the same convention as Codex. `uncachedInput = max(0, input - cached)`.
2. **`thoughts` are reasoning tokens**, already counted inside `total` but **not** inside `output`. They map to `reasoningTokens`.
3. **`$set` lines re-emit the whole conversation**, so the same message appears many times in a single file. `id` is stable, so `eventId = sha1("gemini-cli|<id>")` makes every re-emission a no-op under `INSERT OR IGNORE`. This is the mechanism that keeps Gemini counts correct — there is no positional dedup.
4. **Working directory is recovered from `~/.gemini/projects.json`**, which maps an absolute path to the tmp directory name. The adapter reverses that map and looks up the `<projectDir>` segment preceding `chats/` in the file path.

**Mapping**

| Raw | Normalised |
|---|---|
| header `sessionId` | `sessionId` (fallback: file basename) |
| message `id` | `turnId`, and the sole input to `eventId` |
| `tokens.input - tokens.cached` | `inputTokens` |
| `tokens.cached` | `cacheReadTokens` |
| `tokens.output` | `outputTokens` |
| `tokens.thoughts` | `reasoningTokens` |
| `tokens.total` (fallback: computed sum) | `totalTokens` |
| `tokens.tool` | `metadata.toolTokens` |
| `model` | `model`, `modelAlias`; `provider` hardcoded `google` |
| reverse `projects.json` lookup | `workingDirectory` |

**Caveats**

- Snapshot (`$set`) lines re-emit the whole conversation; duplicates are collapsed by stable message id.
- Working directory is recovered from `~/.gemini/projects.json` and may be absent for older sessions — those events land unassigned until you add a mapping rule.
- Cache-write tokens, duration and reported cost are not present in this format.
- `tokens.tool` is retained in metadata but is not added to `totalTokens`.

---

## generic-jsonl / generic-csv

These **never auto-discover anything**. The path comes from an explicit import action and is held in `TOKEN_ROI_IMPORT_FILE` for a single scan run. `detect()` returns `absent` when no file is selected.

- `generic-jsonl` accepts either a JSON array file or a JSONL file; it sniffs a leading `[` and falls back to line mode.
- `generic-csv` uses an RFC4180-ish parser handling quotes, escaped quotes and embedded newlines. Reported line numbers are 1-based data rows offset by the header (`i + 2`).

Header matching is tolerant: keys are compared case-insensitively with spaces, underscores and hyphens stripped.

| Normalised field | Accepted column names |
|---|---|
| `inputTokens` | `inputTokens`, `input`, `promptTokens`, `prompt_tokens`, `tokens_in` |
| `outputTokens` | `outputTokens`, `output`, `completionTokens`, `completion_tokens`, `tokens_out` |
| `cacheReadTokens` | `cacheReadTokens`, `cachedTokens`, `cache_read`, `cached` |
| `cacheWriteTokens` | `cacheWriteTokens`, `cacheCreationTokens`, `cache_write` |
| `reasoningTokens` | `reasoningTokens`, `thoughts`, `reasoning` |
| `totalTokens` | `totalTokens`, `total`, `tokens` (used only when the components sum to 0) |
| `timestamp` | `timestamp`, `date`, `time`, `created_at`, `createdAt` |
| `sessionId` | `sessionId`, `session`, `conversationId`, `id` |
| `model` | `model`, `modelId`, `model_name` |
| `workingDirectory` | `workingDirectory`, `cwd`, `project`, `projectPath`, `directory` |
| `provider` | `provider`, `vendor` |
| `reportedCostUsd` | `costUsd`, `cost`, `reportedCost`, `amount`, `spend` |
| `durationMs` | `durationMs`, `duration`, `latencyMs` |
| `promptPreview` | `prompt`, `promptPreview`, `input_text`, `message` |
| `status` | `status` (default `ok`) |

Numeric parsing strips `$` and `,`. Rows with a zero total are skipped.

**Event id:** `sha1("<source>|<file>|<line>|<sessionId>|<timestamp>|<total>")`. Note this is position-dependent: re-importing the same file is idempotent, but re-importing a file whose rows were reordered or re-exported with different line numbers will create new rows. This is the one adapter whose dedup depends on the file being stable.

`reportedCostUsd` is the only place a provider-supplied cost can enter the system, and only if your export contains such a column.

**Caveat:** completeness depends entirely on the columns present in your file.

---

## Deliberately unsupported

From `UNSUPPORTED_SOURCES` in `src/lib/adapters/registry.ts`. These are surfaced in the UI so an absent adapter is an explained decision rather than a silent gap.

| id | Name | Reason |
|---|---|---|
| `cursor` | Cursor | Local Cursor state was inspected and contains no per-request token accounting; usage is only visible in the vendor dashboard. |
| `anthropic-usage-export` | Anthropic console usage export | No export file was available locally to verify the column layout. Use the Generic CSV importer and map the columns manually. |
| `openai-usage-export` | OpenAI usage export | No export file was available locally to verify the column layout. Use the Generic CSV importer and map the columns manually. |
| `openrouter` | OpenRouter usage export | No local OpenRouter export was present to verify against. Use the Generic CSV importer. |

The project rule is that an adapter is registered only after being verified against real files. Writing an adapter against documentation alone produces a format that silently mis-parses. See `docs/adding-an-adapter.md`.
