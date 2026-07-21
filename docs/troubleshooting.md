# Troubleshooting

---

## 1. better-sqlite3 fails to build or load

**The single most common install failure.** `better-sqlite3` is a native module and needs its install script to produce a working binary. **npm 11 blocks native install scripts by default.**

Symptoms:

- `npm install` prints an `allow-scripts` warning.
- `Error: Could not locate the bindings file` / `Cannot find module '.../better_sqlite3.node'`
- `was compiled against a different Node.js version ... NODE_MODULE_VERSION`
- `invalid ELF header`
- Every page fails, because everything reads from SQLite.

Fix — rebuild with scripts in the foreground so you can see the compiler output:

```bash
npm rebuild better-sqlite3 --foreground-scripts
```

Verified working on Node 23 / Windows 11. Alternatively approve install scripts once:

```bash
npm approve-scripts
```

If the rebuild itself fails:

| Cause | Fix |
|---|---|
| Node < 20 | Upgrade. Node 20+ is required. |
| Switched Node versions after installing | `npm rebuild better-sqlite3 --foreground-scripts` — the ABI changed. |
| No C++ toolchain (Windows) | Install Visual Studio Build Tools with the "Desktop development with C++" workload. |
| No toolchain (macOS) | `xcode-select --install` |
| No toolchain (Linux) | Install `build-essential` and `python3`. |
| Corrupt install tree | Delete `node_modules` and `package-lock.json`, `npm install`, then rebuild. |

Verify:

```bash
node -e "const D=require('better-sqlite3'); new D(':memory:').prepare('select 1 x').get(); console.log('ok')"
```

---

## 2. Port 4783 already in use

Symptom: `EADDRINUSE: address already in use 127.0.0.1:4783`.

Almost always a previous `npm run dev` that did not exit.

```powershell
# Windows
netstat -ano | findstr :4783
taskkill /PID <pid> /F
```

```bash
# macOS / Linux
lsof -i :4783
kill <pid>
```

To run on a different port, edit the `dev` / `start` scripts in `package.json` — the port is hardcoded there (`next dev -H 127.0.0.1 -p 4783`). **Keep `-H 127.0.0.1`.** Removing it binds the server to every interface and exposes your local usage data to the network.

If the app is running but the browser cannot reach it, use `http://127.0.0.1:4783` explicitly. `localhost` can resolve to `::1` (IPv6), which the loopback IPv4 bind does not answer.

---

## 3. Migration failure

`npm run db:migrate` reports `Migration <id> failed: <message>`.

Migrations run inside a transaction and are recorded in `_migrations`. A failure rolls the whole migration back and closes the connection, so the database is never left half-migrated.

| Cause | Fix |
|---|---|
| better-sqlite3 not built | Fix issue 1 first. Everything else is downstream. |
| No write permission on `~/.project-token-roi` | Check ownership, or set `TOKEN_ROI_DB` to a writable path. |
| Path does not exist / is on a disconnected drive | `TOKEN_ROI_DB` points somewhere unreachable. |
| Database locked | Another process holds it. Stop the dev server and any `sqlite3` shell. |
| File is not a SQLite database | You pointed `TOKEN_ROI_DB` at the wrong file. |
| Corrupt database | Restore a backup, or delete `token-roi.db`, `-wal`, `-shm` and re-migrate, then `npm run scan` to rebuild events. |

Check what has been applied:

```bash
sqlite3 ~/.project-token-roi/token-roi.db "SELECT id, applied_at FROM _migrations;"
```

Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), so re-running is safe.

---

## 4. No sources detected

`npm run scan` prints `No verified sources to scan.` Read the status it printed per source first — the reason is on the line below.

| Status | Meaning | Action |
|---|---|---|
| `ABSENT` — "Directory not found." | The root does not exist | You have not used that CLI on this machine, or it stores history elsewhere. Set the matching `TOKEN_ROI_*_ROOT`. |
| `DETECTED-UNVERIFIED` — "Found .jsonl files but no token usage records yet." | Files exist but none carried usage | Have a real conversation with the CLI and rescan. `detect()` requires evidence, not just a folder. |
| Source missing entirely | Not a registered adapter | Check the unsupported list in `docs/data-sources.md`. |

Expected roots (override in brackets):

| Source | Root | Override |
|---|---|---|
| claude-code | `~/.claude/projects` | `TOKEN_ROI_CLAUDE_ROOT` |
| codex | `~/.codex/sessions` | `TOKEN_ROI_CODEX_ROOT` |
| gemini-cli | `~/.gemini/tmp` | `TOKEN_ROI_GEMINI_ROOT` |
| generic-jsonl / generic-csv | none | `TOKEN_ROI_IMPORT_FILE` |

Filename and depth constraints matter — a file in the right tree but the wrong shape is not found:

- claude-code: `*.jsonl`, depth ≤ 3 below the root.
- codex: name must **start with `rollout-`** and end `.jsonl`, depth ≤ 5.
- gemini-cli: `*.jsonl` whose path contains `/chats/`, depth ≤ 4.

`detect()` only inspects the first 25 files it finds, looking for `"usage"` + `"input_tokens"` (claude-code), `"last_token_usage"` (codex) or `"tokens"` (gemini-cli). A very large history whose first 25 files are all empty sessions can read as unverified; run a real session and rescan.

You can force a specific source regardless of order: `npm run scan -- codex`. Note it still requires `verified` status to actually scan.

---

## 5. Unpriced models

Symptom: token totals look right but cost is lower than expected, and the UI shows a pricing-coverage warning.

An event whose model has no matching pricing row gets `calculated_cost_usd = NULL` and `priced = 0`. **Its tokens still count; its cost is excluded from every cost total.** This is deliberate — pricing an unknown model at zero would make it look free.

Find the offenders:

```sql
SELECT model, COUNT(*) AS events, SUM(total_tokens) AS tokens
FROM events WHERE dataset='real' AND priced = 0
GROUP BY model ORDER BY tokens DESC;
```

Fix:

1. Add or edit a pricing row for that model (Settings › Pricing). Use the exact model string, or add it as an alias on an existing row.
2. Run `repriceAll()` — it re-prices every real event from the current registry and returns `{ priced, unpriced }`. **You do not need to re-scan the source files.**

Before adding a row, check whether normalisation should already have matched. `normaliseModelKey()` lowercases, strips a leading `anthropic/`/`openai/`/`google/`/`models/`, converts `.` and `_` to `-`, and strips a trailing 8-digit datestamp or `-latest`. Resolution also falls back to the **longest registered key that prefixes** the model, so a new dated variant of a known family usually prices itself.

If it did not match, the likely causes are:

- The model genuinely is not in the registry (a new release).
- A date window: the row's `[effective_from, effective_to)` does not contain the event timestamp. Cross-check with `SELECT model_id, effective_from, effective_to FROM pricing;`.
- The event timestamp is bogus (e.g. epoch 0 from a record with no timestamp), falling before every window.

Seeded rows are **starting values only** — verify them against your provider's pricing page. See `docs/cost-calculation.md`.

---

## 6. Permission denied or locked source files

The scan is built to survive these; you will see them as warnings and errors, not a crash.

| Situation | Behaviour |
|---|---|
| A directory cannot be read | `walk()` catches the `readdirSync` failure and continues. That subtree is silently skipped. |
| `stat` fails on a file | Recorded as `stat failed <file>: <message>`, scan continues to the next file. |
| The file cannot be opened | Recorded as `read failed <file>: <message>`, scan continues — one bad file never ends a scan. |
| `detect()` cannot read a candidate | Swallowed; detection keeps looking at the next file. |

So a permission problem shows up as **missing data plus errors on the scan run**, not as a failure. Check `scan_runs.errors` after a run:

```sql
SELECT source, status, files_scanned, records_added, error_count, errors
FROM scan_runs ORDER BY started_at DESC LIMIT 5;
```

Common causes: history under another user's profile; a synced folder (OneDrive/Dropbox) with a file locked mid-sync; corporate endpoint protection holding a handle; antivirus scanning a large JSONL. Fixes: run as the owning user, pause the sync client, or copy the tree elsewhere and point the matching `TOKEN_ROI_*_ROOT` at the copy.

A file locked by the CLI *writing* it is not a problem — the reader opens read-only and a trailing partial line is deliberately not consumed.

---

## 7. Corrupt records

Symptom: scan errors of the form `session-abc.jsonl:1423 corrupt JSON (Unexpected token ...)`.

A single unparseable line calls `onCorrupt`, increments `recordsSkipped`, and is skipped. Parsing never aborts. Only the **first 50** corrupt-line errors per source are recorded, to keep the run report readable.

Usually benign:

- **A trailing partial line** while the CLI is mid-write is *not* reported — `readJsonlFrom` neither emits it nor counts it in the resume offset, so the next scan picks it up once complete.
- **A file that was rewritten rather than appended** is detected by comparing the SHA-1 of its first 64 KB against the checkpoint. The adapter warns `<file> was rewritten; re-reading from start` and restarts at offset 0. Dedup on `event_id` makes that harmless.
- **A truncated file** (`startOffset > size`) resets to offset 0 automatically.

If a specific file produces persistent errors, inspect the reported line:

```bash
sed -n '1423p' /path/to/session-abc.jsonl | head -c 400
```

A genuinely damaged line is unrecoverable — the request it described is simply absent. To retry a file from scratch, delete its checkpoint and rescan:

```sql
DELETE FROM scan_checkpoints WHERE file_path LIKE '%session-abc.jsonl';
```

---

## 8. Unassigned sessions

Symptom: events exist and are priced, but `project_id` is NULL, projects look emptier than expected, and subscription allocation reports a large `unallocated` share with low confidence.

Find them:

```sql
SELECT working_directory, COUNT(*) AS events, SUM(total_tokens) AS tokens
FROM events WHERE dataset='real' AND project_id IS NULL
GROUP BY working_directory ORDER BY tokens DESC;
```

Causes and fixes:

| Cause | Fix |
|---|---|
| No project registered for that directory | Add a project whose path is that directory (or an ancestor of it). |
| `working_directory` is NULL | The source did not record one. For gemini-cli this happens when `~/.gemini/projects.json` has no entry for the session's tmp directory — common for older sessions. Add a `mapping_rules` row keyed on the session or path prefix. |
| Path recorded differently (drive case, separators, trailing slash) | Should not happen: `normPath()` lower-cases the whole string including the drive letter, converts `\` to `/`, and strips trailing slashes on both sides of every comparison. If it does, the two paths genuinely differ. |
| Work happened outside any project you track | Expected. Either register it or accept the `unallocated` share. |

After any change, run `remapProjects()`. It re-runs `matchProject` over every real event and returns the number now assigned. **Re-scanning is not required** — mapping is derived, not ingested.

Attribution precedence, first hit wins: **exact** (cwd equals project path or git root) → **child** (cwd nested inside a root; deepest root wins, so a nested project beats its parent) → **remote** (normalised git remote matches) → **manual** (a `mapping_rules` prefix/exact pattern) → **unassigned**.

Note that `unallocated` subscription cost is **never silently redistributed** across your assigned projects — that is why it is visible at all. See `docs/subscription-allocation.md`.

---

## Diagnostics reference

```sql
-- recent scan runs
SELECT id, source, status, files_scanned, records_added, records_skipped,
       error_count, duration_ms
FROM scan_runs ORDER BY started_at DESC LIMIT 10;

-- event counts by source
SELECT source, COUNT(*) AS events, SUM(total_tokens) AS tokens,
       SUM(priced) AS priced
FROM events WHERE dataset='real' GROUP BY source;

-- pricing coverage
SELECT SUM(CASE WHEN priced=1 THEN total_tokens ELSE 0 END) * 1.0
       / NULLIF(SUM(total_tokens),0) AS coverage
FROM events WHERE dataset='real';

-- checkpoint state for one source
SELECT file_path, byte_offset, size_bytes, last_line, updated_at
FROM scan_checkpoints WHERE source='codex' ORDER BY updated_at DESC LIMIT 20;
```

Also useful: `npm run typecheck`, `npm test`, and `npm run scan` (which prints detection status and reason for every source before scanning anything).
