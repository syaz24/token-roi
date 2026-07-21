# ROI methodology

> **This is not financial advice.** Project Token ROI is a bookkeeping tool. It arithmetically compares numbers you entered (value) against numbers derived from your local usage files (cost). Correlation between AI token usage and business results **is not causation** — a project may earn money for reasons entirely unrelated to how many tokens it consumed, and the tool has no way to distinguish the two. Treat every output as a prompt for your own judgement, not a conclusion.

Implementation: `src/lib/roi/compute.ts` (mathematics) and `src/lib/roi/recommend.ts` (scoring).

Design rule for the whole module: **every function is total.** Zero cost, missing cost and negative inputs return an explicit null plus a reason flag, never `Infinity` or `NaN`. "No cost recorded" and "ROI of zero" are different answers and are never conflated.

---

## Core formulas

```
net value    = value - cost
ROI %        = ((value - cost) / cost) * 100
ROI multiple = value / cost
```

`roi({ value, cost, costKnown })` returns `{ netValue, roiPct, roiMultiple, note }` where `note` explains any null:

| Condition | `note` | netValue | roiPct | roiMultiple |
|---|---|---|---|---|
| Normal | `ok` | `value - cost` | `(net/cost)*100` | `value/cost` |
| `costKnown === false` | `cost_unknown` | null | null | null |
| cost ≤ 0 or non-finite | `no_cost` | `value` | **null** | **null** |
| value non-finite | `no_value` | null | null | null |

### Zero-cost handling

Value with no cost is **not "infinite ROI"**. Dividing by zero would produce `Infinity`, which sorts to the top of every leaderboard and would make the least-measured project look like the best one. Instead the app reports net value only and labels it `no_cost`.

### Missing-cost handling

`costKnown = false` is passed when the cost figure is known to be incomplete — most commonly because some of the project's models are unpriced (see `docs/cost-calculation.md`). In that case **all three ROI figures are null**, not "a low estimate". Publishing a ratio built on a partial denominator would overstate return by exactly the amount that is missing.

---

## Derived measures

### Break-even

```
breakEven(value, cost) = {
  requiredValue: max(0, cost),
  remaining:     max(0, cost - value),
  passed:        value >= cost && cost > 0
}
```

Break-even value is simply the cost. `passed` requires a positive cost, so a project with no cost never reads as "broken even" — it has nothing to break even against.

### Cumulative series and break-even date

`cumulative(series)` sorts by date and accumulates cost and value into `cumCost` / `cumValue`, recording `breakEvenDate` as the **first** date on which `cumCost > 0 && cumValue >= cumCost`. The condition requires positive cumulative cost, so a value entry preceding any spend does not mark a spurious break-even.

### Payback period

```
paybackDays(points) = round( (breakEvenDate - firstCostDate) / 86_400_000 )
```

`firstCostDate` is the first point with `cumCost > 0`; `breakEvenDate` is the first point where cumulative value catches cumulative cost. Returns **null** if either does not exist — a project that has not paid back has no payback period, not a large one. Clamped at ≥ 0.

### Value per million tokens

```
valuePerMillionTokens(value, tokens) = tokens > 0 ? value / (tokens / 1e6) : null
```

A cost-independent efficiency measure. It is useful precisely because it does not depend on the pricing registry: it stays meaningful even when coverage is poor. Zero or non-finite tokens return null.

### Revenue-to-cost ratio

```
revenueToCostRatio(value, cost) = cost > 0 ? value / cost : null
```

Numerically the ROI multiple, exposed separately for reporting.

---

## Value events

Value is user-entered. The tool has no way to observe it, and it does not try.

### Recurring value expansion

`expandValueEvent(ev, from, to)` turns a recurring entry into one occurrence per period inside the reporting window:

| `recurrencePeriod` | Step |
|---|---|
| `weekly` | +7 days |
| `monthly` (default) | +1 month |
| `quarterly` | +3 months |
| `yearly` | +12 months |

Iteration starts at `ev.date` and stops at `min(recurrenceEnd ?? to, to)`, with a hard guard of 2000 iterations. Occurrences before `from` are skipped, not clipped, so a retainer that started two years ago contributes exactly its in-window occurrences. A non-recurring event contributes once, and only if its date falls inside the window. An unparseable date yields no occurrences.

This is what stops a $500/month retainer entered once from appearing as a single $500 spike on its start date.

### Realised vs estimated

Each value event carries `realised` (boolean) and `confidence` (`low` / `medium` / `high`).

- **Realised** — money or benefit that actually landed: an invoice paid, a contract signed, hours measurably saved.
- **Estimated** — a projection.

Both are stored and both are shown, but the *share* that is realised (`realisedShare`, 0–1) is fed into the recommendation engine as a penalty and as a confidence gate. A project whose apparent ROI rests almost entirely on estimates can never be classified as a confident "Double Down". This is the single most important honesty mechanism in the tool, because value is the only fully user-supplied input in the whole pipeline.

---

## Cost basis

ROI is computed against one of three cost bases (`api_equivalent`, `allocated_cash`, `blended`) selected by the `costBasis` setting. The same value figure against different bases will give different ROI, and that difference is meaningful. See `docs/subscription-allocation.md`.

---

## Recommendation scoring

**No LLM is involved.** Every classification is a pure function of the inputs below, and each contributing factor is returned with its label, detail string and point value so the UI can always show exactly why a project landed where it did.

### Gate: Insufficient Data

Before any scoring:

```
if (!hasValueData || totalTokens < 1000) -> 'Insufficient Data', score 0, confidence 'low'
```

with the reason spelled out — either "No project value has been recorded, so return cannot be assessed" or "Too little token usage recorded to judge efficiency."

### Scoring dimensions

`clamp(n, lo, hi)` bounds every contribution so no single dimension can dominate.

| Dimension | Points | Range |
|---|---|---|
| **Realised ROI** | `roiPct / 25` | −20 … +35 |
| **Net value** | `sign(net) * log10(1 + abs(net)) * 4` | −15 … +20 |
| **Recent value growth** | `(recentValueGrowth − 1) * 15` | −12 … +18 |
| **Cost trend** | 0 if value keeps pace, else `−(costTrend − 1) * 12` | −15 … 0 |
| **Token efficiency** | `log10(1 + max(0, valuePerMTok)) * 5` | 0 … +12 |
| **Data confidence** | `−(1 − pricingCoverage) * 15` | −15 … 0 |
| **Value quality** | `−(1 − realisedShare) * 12` | −12 … 0 |
| **Stale value data** | `−(daysSinceValueUpdate − 90) / 30`, only past 90 days | −10 … 0 |

Notes on the deliberate asymmetries:

- **ROI dominates** (+35 max) because it is the question being asked, but it is capped so a single freak month cannot pin a project at the top.
- **Net value is logarithmic**, so a $50k project scores higher than a $5k one without being ten times more emphatic. Absolute size matters, but sub-linearly.
- **Cost trend is one-sided.** Rising spend scores 0 — not a penalty — whenever `recentValueGrowth >= costTrend`. Growing spend is only a problem when value is *not* growing with it. The detail string states which case applied.
- **Data confidence and value quality are penalties only.** Good data never earns points; it simply does not cost you any. They are the mechanism by which weak evidence pulls a project toward the middle rather than the extremes.
- **Staleness** only engages after 90 days without a value update, then costs roughly 1 point per additional month.
- The last three are only added to the score and shown as factors when they exceed 0.5 points in magnitude, so a clean dataset produces no noise factors.

### Confidence rating

```
high    if pricingCoverage > 0.9 && realisedShare > 0.6
medium  if pricingCoverage > 0.6
low     otherwise
```

### Classification

```
if (realisedShare < 0.25 && pricingCoverage < 0.5)  -> 'Validate Further'   // confidence gate
if (score >= 30)   -> 'Double Down'
if (score >= 10)   -> 'Maintain'
if (score >= -5)   -> 'Validate Further'
if (score >= -20)  -> 'Reduce Spend'
else               -> 'Pause'
```

| Classification | Reading |
|---|---|
| **Double Down** | Strong return on well-evidenced data. More spend here is likely to be productive. |
| **Maintain** | Positive but not exceptional. The current level of investment is justified. |
| **Validate Further** | Either genuinely borderline, or the numbers look fine but rest on thin evidence. Get better data before acting. |
| **Reduce Spend** | Cost is outrunning demonstrated value. Cut consumption before cutting the project. |
| **Pause** | Sustained negative return with adequate evidence. Stop spending until something changes. |
| **Insufficient Data** | Cannot say. No value recorded, or under 1000 tokens of usage. |

The confidence gate is applied **before** the score thresholds, so a project whose value is mostly estimates *and* whose tokens are mostly unpriced is forced to "Validate Further" no matter how good its arithmetic looks. Strong-looking numbers built on estimates must not read as a confident recommendation.

### What the scoring cannot see

- Whether the value was caused by the AI usage, or would have happened anyway.
- Work with real value that you did not record.
- Strategic value: learning, optionality, risk reduction, morale.
- Token spend on one project that produced value credited to another.
- Anything in a directory you have not registered as a project — that usage is unassigned and shows up as `unallocated` cost instead.

Every classification is a summary of the numbers you gave it. It is not a judgement about the project.
