# Subscription allocation

A subscription is a **fixed cash cost for a billing period**. Token events, by contrast, are per-request. Reconciling the two requires an explicit, user-chosen rule for spreading a flat fee across projects. That rule is the allocation method.

Implementation: `src/lib/roi/allocation.ts`.

The engine never pretends the whole plan price belongs to one project unless that is literally what you configured (`direct`).

---

## Recurring versus one-time

A plan is either **recurring** (`monthly`, `quarterly`, `annual`) or a **one-time
purchase** (`one_time`) such as a credit top-up.

| | Recurring | One-time |
|---|---|---|
| Months charged | Every month from `billing_start` until `billing_end` (or indefinitely) | Only the month containing `billing_start` |
| Cost spread | An annual price is divided across the 12 months it covers | Never spread — the full amount lands in its single month |
| Counted in the monthly run rate | Yes | No; shown separately as a one-time purchase |

`chargesInMonth(sub, month)` in `src/lib/roi/allocation.ts` is the single place
this is decided, and `allocatedCash` consults it before charging any month.

The **Common plans** picker in Settings › Subscriptions seeds provider, plan
name, price and cycle from a small catalogue of well-known plans
(`src/lib/subscriptions/presets.ts`). Those prices are indicative starting
values only — the same convention the model pricing registry uses. Confirm them
against your own invoice; every field stays editable, and "Custom plan…" leaves
them all blank.

## Monthly cash cost

Before any allocation, the plan is reduced to an effective monthly figure in USD:

```
base        = monthly_price * max(1, seats)

perMonth    = billing_cycle == 'annual'    ? base / 12
            : billing_cycle == 'quarterly' ? base / 3
            :                                base   // 'monthly' and 'one_time'

monthlyCash = perMonth * (1 - discount_pct/100) * (1 + tax_pct/100)
```

Order matters: **seats multiply, the cycle divides, the discount comes off, then tax goes on the discounted amount.** Tax is applied last because that is how it is actually invoiced.

| Input | Column | Notes |
|---|---|---|
| `monthly_price` | `subscriptions.monthly_price` | Price of one seat for one billing period as billed |
| `seats` | `subscriptions.seats` | Floored at 1; a 0 or missing value is treated as 1 |
| `billing_cycle` | `subscriptions.billing_cycle` | `monthly` (default) / `quarterly` / `annual` / `one_time` |
| `discount_pct` | `subscriptions.discount_pct` | Percentage, e.g. `20` for 20% off |
| `tax_pct` | `subscriptions.tax_pct` | Percentage, e.g. `6` for 6% |

Example: an annual team plan at $200/seat/period, 3 seats, 10% discount, 6% tax:

```
base       = 200 * 3            = 600
perMonth   = 600 / 12           = 50
afterDisc  = 50 * 0.90          = 45
monthlyCash= 45 * 1.06          = 47.70
```

The value passed into `allocate()` is the cash cost of the **period being analysed**, with tax, discount and seats already applied. A non-finite or non-positive period cost short-circuits: empty allocation, zero unallocated, confidence 1.

---

## The six allocation methods

| Method | Driver | Unallocated arises when |
|---|---|---|
| `token_share` | total tokens per project | usage exists that maps to no project |
| `session_share` | distinct sessions per project | as above |
| `active_day_share` | days with activity per project | as above |
| `equal` | none — even split | never (but nothing is allocated if there are no projects) |
| `manual_pct` | your percentages | percentages sum below 100 |
| `direct` | none — one project | no project was selected |

### `token_share` / `session_share` / `active_day_share`

Usage-proportional. Let `d(p)` be the driver metric for project `p`, and `outside` the same metric for usage that belongs to **no** project (unassigned sessions).

```
assigned = Σ max(0, d(p))
denom    = assigned + outside

share(p)     = periodCost * d(p) / denom      (only for d(p) > 0)
unallocated  = periodCost * outside / denom
confidence   = assigned / denom
```

The unassigned usage sits **in the denominator**. That is the whole point: if 30% of your tokens came from directories you have not registered as projects, 30% of the plan cost is `unallocated`, and the remaining projects are not inflated to absorb it.

If `denom <= 0` — no usage at all in the period — the full plan cost is unallocated, confidence 0, with the warning *"No usage recorded in this period; the full plan cost is unallocated."*

Choosing between the three drivers:

- `token_share` tracks consumption most directly and is the default (`subscriptions.allocation_method` defaults to `token_share`).
- `session_share` is fairer when one project runs a few enormous sessions and another runs many small ones.
- `active_day_share` approximates "how many days did this plan actually serve this project", useful for seat-priced plans where volume is not what you are buying.

### `equal`

Splits `periodCost` evenly across the projects supplied in `usage`, regardless of how much each used. Unallocated is 0 and confidence 1. If the project list is empty, the entire cost is unallocated with confidence 0.

Appropriate for a plan bought to serve a fixed set of projects where usage volume is not the cost driver.

### `manual_pct`

You supply `allocation_config.percentages` as `{ projectId: pct }`.

```
share(p)    = periodCost * pct(p) / 100
sum         = Σ pct
unallocated = periodCost * (100 - sum) / 100        when sum <= 100
confidence  = sum / 100
```

Negative and non-finite percentages are coerced to 0. If `sum > 100`, every share is scaled by `100 / sum` and a warning is emitted — *"Manual percentages total X%; scaled down to 100%"* — because **the tool will never bill out more than was actually paid**. In that case unallocated is 0 and confidence 1.

If `sum < 100`, the remainder is unallocated with the warning *"X% of this plan is unallocated."*

### `direct`

`allocation_config.projectId` carries the whole `periodCost`. Unallocated 0, confidence 1. If no project id is configured, the entire cost is unallocated with confidence 0 and the warning *"Direct allocation has no project selected; full cost left unallocated."*

Use this for a plan bought explicitly for one project.

---

## What `unallocated` means

`unallocated` is the portion of real money you paid that the tool **cannot honestly attribute to any project**. It is returned as a first-class field of `AllocationResult` alongside `byProject`, `confidence` and `warnings`.

It has exactly three causes:

1. Usage that maps to no registered project (unassigned sessions).
2. Manual percentages summing below 100.
3. A degenerate configuration — `direct` with no project, `equal` with no projects, or zero usage in the period.

**It is never silently redistributed.** Redistributing it would mean spreading the cost of untracked work over your tracked projects, which makes every tracked project look more expensive than it is, degrades every ROI figure by an unknown amount, and — worst — hides the fact that attribution is incomplete. Leaving it visible turns a data-quality problem into something you can see and fix (register the missing project, or add a mapping rule).

`confidence` is the companion signal: the share of the driver metric that *was* attributable, in 0–1. An allocation at confidence 0.62 is telling you 38% of the plan's usage came from somewhere unregistered.

To reduce `unallocated`: register the projects behind the unassigned sessions, add `mapping_rules` for directories that will not become projects, then re-run `remapProjects()`. See `docs/troubleshooting.md`.

---

## The three cost bases

`costForBasis(basis, apiCost, cashCost, uncoveredApiCost)` in `src/lib/roi/compute.ts`. Selected by the `costBasis` setting (default `api_equivalent`).

| Basis | Formula | Answers |
|---|---|---|
| `api_equivalent` | `apiCost` | "What would this usage have cost at list API prices?" |
| `allocated_cash` | `cashCost` | "What share of the money I actually paid belongs here?" |
| `blended` | `cashCost <= 0 ? apiCost : cashCost + max(0, uncoveredApiCost)` | "What did this genuinely cost me out of pocket, counting usage no plan covered?" |

**API Equivalent** is the counterfactual. It is the right basis for "was the subscription worth it versus paying per token", and it is the only basis available before you have entered any subscription. It ignores what you actually paid.

**Allocated Cash** is real money only. It is the right basis for budget reconciliation — the sum across projects plus `unallocated` equals what left your bank account. It treats usage outside any subscription (a pay-as-you-go API key) as free, which it is not.

**Blended** is the honest out-of-pocket-equivalent. It takes the cash actually paid and **adds** the API-list price of usage that no subscription covered. It neither ignores the money actually spent nor treats uncovered usage as free. When there is no cash cost at all it degrades gracefully to `apiCost`. `uncoveredApiCost` defaults to 0, and a negative value is clamped, so blended can never fall below the cash paid.

The three bases will disagree, often substantially. That disagreement is information: a project cheap on `allocated_cash` but expensive on `api_equivalent` is one that is extracting a lot of value from a flat-fee plan.
