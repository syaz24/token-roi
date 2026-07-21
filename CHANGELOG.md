# Changelog

## 0.2.0

### Added

- **Insights** (`/insights`) — eight deterministic rules over your own indexed
  history: short prompts costing more than detailed ones, cost per turn rising
  as a conversation grows, usage concentration, output-token share, busiest
  weekday, tool-heavy sessions, estimated cache savings, and a suggested point
  to start a fresh conversation. Every rule is gated on a minimum sample size
  and stays silent when the evidence is not there. No model is consulted.
- **Most expensive prompts** — turns ranked by tokens, showing the prompt that
  caused them, opening the turn-by-turn breakdown.
- **Conversation view** on the Sessions page — one row per session with the
  opening prompt, turns, tool calls, tokens and cost, plus a cost-per-turn
  curve and a callout when one turn dwarfs the session median. The existing
  per-request trace explorer remains, behind a toggle.
- **Project setup wizard** — proposes projects from the folders your indexed
  sessions actually ran in, rolling subfolders (worktrees, packages,
  `node_modules`, `dist`) up to their project root and grouping scratch and
  temp locations into a single shared "Miscellaneous" project. Nothing is
  created until you confirm.
- **Share stats** — a PNG summary card drawn locally with the Canvas API. It
  carries no project names, folder paths or prompt text, and nothing is
  uploaded.
- **Subscription spend to date** — plans billed from an earlier date now
  accumulate. Settings shows a running total per plan; the Overview card shows
  total spent to date alongside the current monthly run rate.
- Overview metric cards link through to the page that explains each number.
- Page and panel enter transitions, CSS-driven so they degrade to instant when
  animation is unavailable or reduced motion is set.

### Changed

- **`prompt_preview` now holds the user prompt that began a turn.** It
  previously held the assistant's *reply* despite its name, which made any
  prompt-level feature meaningless. Migration `0002` also adds `turn_index`,
  `tool_uses` and `is_turn_start`. Re-index a source to populate them for
  existing rows; older rows keep their previous value until you do.
- ROI percentages are thousand-separated.

### Fixed

- Drawers and modals rendered inline instead of pinned to the viewport.
  `.panel` sets `position: relative` and was defined after `@tailwind
  utilities`, so on source order it beat the `fixed` utility on any element
  using both. Panel styles moved into `@layer components`; overlays are also
  portalled to `<body>`.
- Metric cards in a row could differ in height depending on whether they
  carried a sparkline, exact value or footnote. Every optional row now keeps
  its slot.
- The project wizard let the home directory act as a merge root, collapsing
  every project on the machine into one proposal.
- A busy port produced a raw `EADDRINUSE` stack trace. The launcher now
  reports it and moves to the next free port, or fails with one clear line if
  the port was given explicitly.

## 0.1.0

Initial release. Verified adapters for Claude Code, OpenAI Codex CLI and
Gemini CLI, plus generic JSON/JSONL and CSV importers. Date-effective pricing
registry, subscription allocation across six methods, three cost bases, ROI
with explicit null handling, deterministic project recommendations, and
automatic local indexing. Ships as a prebuilt Next standalone server behind an
`npx` launcher on `127.0.0.1:4783`.
