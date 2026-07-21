# Cost calculation

## The central rule

> **Nothing else in the codebase may hardcode a token price.**

All cost derives from the `pricing` table via `PricingRegistry` (`src/lib/pricing/engine.ts`). No verified source reports a provider-billed amount, so every cost figure in the app is *calculated*, never *observed*. (The sole exception is `reported_cost_usd`, which only a generic import can populate from a column in your own file; it is stored alongside, not substituted for, the calculated figure.)

## The pricing registry

One row per model per effective window:

| Column | Meaning |
|---|---|
| `provider` | `anthropic`, `openai`, `google`, … |
| `model_id` | Canonical id |
| `aliases` | JSON array of alternative ids that resolve to this row |
| `effective_from` / `effective_to` | Half-open window `[from, to)`; NULL `to` means "still current" |
| `input_per_mtok` | USD per 1M uncached input tokens |
| `output_per_mtok` | USD per 1M output tokens |
| `cache_read_per_mtok` | USD per 1M cached-input tokens |
| `cache_write_per_mtok` | USD per 1M cache-creation tokens |
| `reasoning_per_mtok` | Usually NULL — see below |
| `currency` | `USD` (all storage is USD) |
| `source_note` | Provenance string |
| `user_override` | 1 for rows you created or edited |

Bundled seed rows (`src/lib/pricing/seed.ts`) are **starting values only**. They are inserted once by `seedPricingIfEmpty()` — which returns 0 and does nothing if the table is non-empty, so it can never overwrite your edits — and every seeded row is stamped:

> Bundled starting value — verify against your provider pricing page and edit in Settings › Pricing.

Verify them against your provider's current pricing page. They are user-verifiable defaults, not authoritative billing data.

## Model key normalisation

Before any lookup, both registered ids and incoming model strings pass through `normaliseModelKey()`:

```
trim
lowercase
strip a leading  anthropic/ | openai/ | google/ | models/
replace  .  and  _  with  -
strip a trailing 8-digit date stamp   (-20260115)
strip a trailing -latest
```

So `models/Gemini-3-Pro`, `gemini-3-pro`, and `claude-sonnet-5-20260115` → `claude-sonnet-5` all land on the intended row without needing an alias for every dated build.

## Resolution

`PricingRegistry.resolve(model, date)`:

1. **Index lookup.** The constructor indexes every canonical id **and** every alias, each normalised, to the rows that declare it. One `Map` lookup on the normalised model key.
2. **Prefix-family fallback.** If there is no exact key, the registry scans its keys for the **longest registered key that is a prefix of the incoming key**. An unseen dated or suffixed variant therefore still prices against its family — `gpt-5.5-codex-preview-x` falls back to `gpt-5.5-codex` if registered, else `gpt-5.5`, else `gpt-5` — while a longer, more specific registered key always wins over a shorter one.
3. **Date-effective filter.** Of the candidate rows, keep those where `effective_from <= t < effective_to` (`effective_to` NULL ⇒ `Infinity`). If the event timestamp is unparseable, all candidates stay eligible.
4. **Tie-break.** Sort user overrides first, then most-recent `effective_from` first. Take the head.
5. **No candidate survives ⇒ `null`.** The model is *unpriced*.

Because the windows are half-open, a price change on `2026-03-01` is expressed as one row ending `2026-03-01` and one starting `2026-03-01`, with no overlap and no gap. Events are priced at the rate in force on their own timestamp, so re-pricing history after a vendor price change does not retroactively distort old months.

## The per-component formula

For `M = 1_000_000`:

```
inputCost      = (inputTokens      / M) * input_per_mtok
outputCost     = (outputTokens     / M) * output_per_mtok
cacheReadCost  = (cacheReadTokens  / M) * cache_read_per_mtok
cacheWriteCost = (cacheWriteTokens / M) * cache_write_per_mtok
reasoningCost  = reasoning_per_mtok != null
                   ? (reasoningTokens / M) * reasoning_per_mtok
                   : 0

total = inputCost + outputCost + cacheReadCost + cacheWriteCost + reasoningCost
```

A NULL token counter contributes 0 to its own component (`?? 0`) — but note that this is a *component* default, not a *cost* default. If the model cannot be resolved at all, no component is computed and the result is NULL.

### Why reasoning cost is normally zero

In every verified source, reasoning tokens are already inside another counter:

- Codex: `reasoning_output_tokens` ⊂ `output_tokens`
- Gemini: `thoughts` ⊂ `total`, priced as output

So the seed rows leave `reasoning_per_mtok` NULL and reasoning tokens are reported without being billed twice. The column exists for a provider that genuinely bills reasoning separately; set it only if that is true of your provider, or you will double-count.

### Why input is the *uncached* count

The adapters have already subtracted the cached portion out of `inputTokens` for Codex and Gemini (see `docs/data-sources.md`). By the time the registry sees an event, `inputTokens` and `cacheReadTokens` are disjoint. Summing them gives total input, and each is priced at its own rate.

## Unpriceable models

```
cost(model, date, tokens) -> CostBreakdown | null
```

**A model that cannot be resolved yields `null`, never zero.** The distinction is enforced everywhere downstream:

| Where | Behaviour |
|---|---|
| `events.calculated_cost_usd` | NULL |
| `events.priced` | 0 |
| `events.pricing_id` | NULL |
| Token totals | The event's tokens **still count**. Usage is not lost, only cost. |
| Cost totals | The event is **excluded**. |
| Coverage | Surfaced as a warning. |

Coverage is quantified by `pricingCoverage(pricedTokens, totalTokens)` in `src/lib/roi/compute.ts`:

```
coverage = totalTokens <= 0 ? 1 : min(1, pricedTokens / totalTokens)
```

That 0–1 figure flows into the ROI confidence rating and applies a scoring penalty of up to −15 points (`docs/roi-methodology.md`). A dashboard showing "cost: $12.40" over 60% coverage is labelled as such rather than presented as a complete number.

Silently pricing an unknown model at zero would make an unmeasured project look maximally efficient. That failure mode is the reason for the null.

## Re-pricing

Editing prices does not require re-scanning source files. `repriceAll()` (`src/lib/scan/engine.ts`) reloads the registry and re-runs `cost()` over every `dataset = 'real'` event inside one transaction, updating `calculated_cost_usd`, `priced` and `pricing_id`, and returns `{ priced, unpriced }`. Run it after any pricing edit; the `unpriced` count tells you immediately whether the new row closed the gap.

## Currency

All money — pricing, subscriptions, value events, computed cost — is stored in **USD**. Display in another currency is a render-time multiplication by a manually entered rate (`general.usdToMyr`, default `4.70`). No exchange-rate service is contacted; nothing leaves the machine.
