# Privacy

## The guarantees

| Guarantee | Mechanism |
|---|---|
| **Read-only toward AI history files** | Adapters only ever call `fs.statSync`, `fs.openSync(path, 'r')`, `fs.readSync`, `fs.readFileSync` and `fs.readdirSync`. There is no write, rename, unlink or truncate path anywhere in `src/lib/adapters/`. Deleting the app's database never touches your history. |
| **Nothing leaves the machine** | There is no HTTP client, no SDK, no analytics, no crash reporter, no update check, no exchange-rate lookup. Currency conversion uses a rate you type in (`general.usdToMyr`). |
| **No accounts** | There is no login, no identity, no sync. |
| **No telemetry** | No usage pings of any kind, opt-in or otherwise. |
| **No remote fonts or assets** | No external stylesheet, font CDN or third-party script. The page renders offline. |
| **Loopback only** | Both `npm run dev` and `npm run start` bind `-H 127.0.0.1`. The server does not listen on a LAN-visible interface. |
| **One file you own** | All state is `%USERPROFILE%\.project-token-roi\token-roi.db` (override: `TOKEN_ROI_DB`). |

The app is a reader of files that already exist on your disk. It does not create a new copy of your conversations unless you tell it to — see prompt-storage policy below.

---

## What is stored

Per token event (`events` table): timestamps, session and turn ids, the working directory, provider, model, token counts, calculated cost, mapping method, request type, status, source file path and line number, and a JSON metadata blob (git branch, stop reason, service tier, context window, plan type, tool tokens — whatever the format offered).

Per project, subscription and value event: exactly what you typed.

**Prompt and response text is stored only according to the prompt-storage policy**, and never unredacted.

`privacy.showSourceFiles` (default `true`) controls whether the originating file path and line are displayed in the UI. Set it to `false` if the paths themselves are sensitive; the columns remain in the database for debugging.

---

## The three prompt-storage policies

Setting: `privacy.promptPolicy`. Default: **`preview`**. The scan engine reads it once per run and hands it to the adapter as `ctx.promptPolicy`, so the policy is enforced at parse time — text outside the policy is never constructed, let alone written.

| Policy | Behaviour |
|---|---|
| `none` | No prompt text is extracted at all. `prompt_preview` is always NULL. Maximum privacy; the UI shows sessions by id and metadata only. |
| `preview` | Text is redacted, whitespace-collapsed, and truncated to **160 characters** with an ellipsis. Enough to recognise a session, not enough to reconstruct it. |
| `full` | Text is redacted, whitespace-collapsed, and truncated to **4000 characters**. |

Redaction runs in **every** policy that stores anything: the pipeline is always `redact(text)` then `truncatePreview(..., max)`. There is no setting that stores raw text.

Per-source reality:

- `claude-code` — extracts the concatenated `text` parts of `message.content`.
- `gemini-cli` — uses `msg.content` when it is a string.
- `codex` — **never stores prompt text under any policy.** The format has no reliable per-request prompt text, so `promptPreview` is hardcoded NULL.
- `generic-*` — uses whichever of `prompt`, `promptPreview`, `input_text`, `message` your file provides.

Changing the policy affects **future** scans. Events already stored keep the preview they were written with. To purge existing previews, clear them directly (see below) or reset and re-scan under the stricter policy.

---

## Redaction rules

Applied by `redact()` in `src/lib/privacy.ts`, in order, before any prompt text is persisted. Rule names are exported as `REDACTION_RULE_NAMES` so the UI can list exactly what is scrubbed.

| Rule | Pattern | Replacement |
|---|---|---|
| `anthropic-key` | `sk-ant-` + 20+ of `[A-Za-z0-9-_]` | `[REDACTED:anthropic-key]` |
| `openai-key` | `sk-` or `sk-proj-` + 20+ alphanumerics | `[REDACTED:openai-key]` |
| `github-token` | `ghp_` / `gho_` / `ghu_` / `ghs_` / `ghr_` + 20+ alphanumerics | `[REDACTED:github-token]` |
| `aws-key` | `AKIA` + 16 of `[0-9A-Z]` | `[REDACTED:aws-key]` |
| `slack-token` | `xoxb-` / `xoxa-` / `xoxp-` / `xoxr-` / `xoxs-` + 10+ chars | `[REDACTED:slack-token]` |
| `google-key` | `AIza` + 35 of `[0-9A-Za-z-_]` | `[REDACTED:google-key]` |
| `bearer` | `Bearer <20+ token chars>` | `Bearer [REDACTED]` |
| `jwt` | `eyJ…` three base64url segments | `[REDACTED:jwt]` |
| `pem` | `-----BEGIN … PRIVATE KEY----- … -----END … PRIVATE KEY-----` | `[REDACTED:private-key]` |
| `email` | RFC-ish address | `[REDACTED:email]` |
| `env-assign` | `NAME=value` where NAME contains `SECRET`, `PASSWORD`, `TOKEN`, `APIKEY` or `API_KEY` | `NAME=[REDACTED]` (name kept, value removed) |

All rules are global (every occurrence, not just the first).

**Limits, stated plainly.** These are pattern matchers. They catch credentials that follow a recognisable vendor format. They will **not** catch a bespoke secret, a password with no distinguishing shape, a customer name, a private code snippet, or an internal hostname. If your prompts contain material that must never be stored at rest, use `privacy.promptPolicy = none`. That is the only setting that offers a guarantee rather than a best effort.

---

## Clearing indexed data

Nothing here touches your AI history files.

| Goal | Action |
|---|---|
| Forget scan positions, keep events | Delete all rows from `scan_checkpoints`. The next `npm run scan` re-reads every file; `INSERT OR IGNORE` on `event_id` means nothing duplicates. |
| Drop all token events, keep projects/values/pricing/subscriptions | Delete from `events` (and optionally `scan_checkpoints` and `scan_runs`). |
| Drop stored prompt text only | `UPDATE events SET prompt_preview = NULL;` then set `privacy.promptPolicy` to `none` so it does not come back. |
| Full reset | Stop the app. Delete `token-roi.db`, `token-roi.db-wal` and `token-roi.db-shm`. Run `npm run db:migrate`. |

Because history files are only ever read, a destroyed database costs you your projects, subscriptions, value entries and pricing edits — the token events themselves can always be rebuilt with `npm run scan`.

## Export

The database is a single portable SQLite file. Any SQLite client can read it; there is no proprietary container and no encryption layer to work around.

```bash
# whole database
sqlite3 ~/.project-token-roi/token-roi.db ".backup 'export.db'"

# one table as CSV
sqlite3 -header -csv ~/.project-token-roi/token-roi.db "SELECT * FROM events WHERE dataset='real';" > events.csv
```

Or stop the app and copy the directory (see the backup section of the README). Copy `-wal` and `-shm` alongside the `.db` if the app was running.

**Before sharing an export, check `prompt_preview` and `source_file`.** Those two columns are the ones that can carry content from your own machine.

## Import

- **Restore:** stop the app and copy a backed-up `token-roi.db` back into place.
- **Bring in usage from another tool:** point `TOKEN_ROI_IMPORT_FILE` at a JSON, JSONL or CSV file and run the `generic-jsonl` or `generic-csv` adapter. Those adapters never auto-discover anything — they operate solely on the path you give them, for a single scan run. This is the documented route for Anthropic, OpenAI and OpenRouter usage exports, whose column layouts could not be verified locally.
- **Point the adapters somewhere else entirely:** `TOKEN_ROI_CLAUDE_ROOT`, `TOKEN_ROI_CODEX_ROOT` and `TOKEN_ROI_GEMINI_ROOT` redirect the discovery roots, which is how the test suite runs against fixtures without reading real history.
