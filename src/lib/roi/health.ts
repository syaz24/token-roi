/**
 * Deterministic Project Health insights.
 *
 * Every insight is produced by an explicit rule over numbers we already hold.
 * No external model is consulted. Each carries the evidence that triggered it
 * so the user can check the reasoning rather than trust a black box.
 */

export type InsightTone = 'positive' | 'negative' | 'warning' | 'info';

export interface Insight {
  tone: InsightTone;
  title: string;
  detail: string;
}

export interface HealthInput {
  tokens: number;
  prevTokens: number;
  cost: number;
  prevCost: number;
  apiCost: number;
  cashCost: number;
  value: number;
  prevValue: number;
  realisedValue: number;
  estimatedValue: number;
  pricingCoverage: number;
  topModelShare: number;
  topModelName: string | null;
  breakEvenPassed: boolean;
  breakEvenRemaining: number;
  commits: number;
  prevCostPerCommit: number | null;
  costPerCommit: number | null;
  valueEntries: number;
}

const pctStr = (n: number) => `${(n * 100).toFixed(0)}%`;
const usd = (n: number) => `$${n < 1000 ? n.toFixed(2) : `${(n / 1000).toFixed(1)}k`}`;

export function projectHealth(i: HealthInput): Insight[] {
  const out: Insight[] = [];

  if (i.valueEntries === 0) {
    out.push({
      tone: 'warning',
      title: 'No project value recorded',
      detail:
        'Return cannot be assessed until you record realised or estimated value on the Value tab. Cost is being tracked regardless.',
    });
  }

  const tokenGrowth = i.prevTokens > 0 ? i.tokens / i.prevTokens : null;
  const valueGrowth = i.prevValue > 0 ? i.value / i.prevValue : null;

  if (tokenGrowth != null && tokenGrowth > 1.2 && (valueGrowth == null || valueGrowth < 1.05)) {
    out.push({
      tone: 'negative',
      title: 'Token usage rose while project value stayed flat',
      detail: `Tokens grew ${((tokenGrowth - 1) * 100).toFixed(0)}% versus the previous period, but recorded value did not follow.`,
    });
  }

  if (i.apiCost > 0 && i.cashCost > 0 && i.cashCost < i.apiCost * 0.6) {
    out.push({
      tone: 'positive',
      title: 'High API-equivalent spend but low cash cost',
      detail: `List pricing would have been ${usd(i.apiCost)}, while your allocated subscription cost is ${usd(
        i.cashCost,
      )} — a saving of ${usd(i.apiCost - i.cashCost)} from subscription utilisation.`,
    });
  }

  if (i.apiCost > 0 && i.cashCost > i.apiCost * 1.3) {
    out.push({
      tone: 'warning',
      title: 'Subscription costs more than the API equivalent',
      detail: `You are paying ${usd(i.cashCost)} in allocated subscription cost for usage worth ${usd(
        i.apiCost,
      )} at list prices. Consider whether the plan is being fully used.`,
    });
  }

  if (i.topModelShare > 0.7 && i.topModelName) {
    out.push({
      tone: 'info',
      title: 'Spend is concentrated in one model',
      detail: `${pctStr(i.topModelShare)} of this project's tokens went through ${i.topModelName}. A pricing change to that model would move the whole project's cost.`,
    });
  }

  if (i.pricingCoverage < 0.9) {
    out.push({
      tone: 'warning',
      title: 'A large share of records cannot be priced',
      detail: `Only ${pctStr(i.pricingCoverage)} of tokens matched a pricing record, so cost and ROI figures understate the true total. Add the missing models in Settings › Pricing.`,
    });
  }

  if (i.costPerCommit != null && i.prevCostPerCommit != null && i.prevCostPerCommit > 0) {
    const ratio = i.costPerCommit / i.prevCostPerCommit;
    if (ratio > 1.25) {
      out.push({
        tone: 'negative',
        title: 'Token cost per commit is increasing',
        detail: `Cost per commit rose from ${usd(i.prevCostPerCommit)} to ${usd(i.costPerCommit)} (${((ratio - 1) * 100).toFixed(0)}% higher).`,
      });
    } else if (ratio < 0.8) {
      out.push({
        tone: 'positive',
        title: 'Token cost per commit is falling',
        detail: `Cost per commit improved from ${usd(i.prevCostPerCommit)} to ${usd(i.costPerCommit)}.`,
      });
    }
  }

  if (i.value > 0 || i.cost > 0) {
    if (i.breakEvenPassed) {
      out.push({
        tone: 'positive',
        title: 'Project has passed break-even',
        detail: `Recorded value of ${usd(i.value)} exceeds AI cost of ${usd(i.cost)} on the selected cost basis.`,
      });
    } else if (i.cost > 0) {
      out.push({
        tone: 'warning',
        title: 'Project is still below break-even',
        detail: `A further ${usd(i.breakEvenRemaining)} of value is needed to cover ${usd(i.cost)} of AI cost.`,
      });
    }
  }

  if (i.value > 0 && i.estimatedValue > i.realisedValue) {
    out.push({
      tone: 'warning',
      title: 'Most value remains estimated rather than realised',
      detail: `${usd(i.estimatedValue)} is estimated against ${usd(
        i.realisedValue,
      )} realised. Treat the ROI figure as provisional until more value is confirmed.`,
    });
  }

  if (i.commits > 0 && i.tokens > 0) {
    const tokensPerCommit = i.tokens / i.commits;
    if (tokensPerCommit > 2_000_000) {
      out.push({
        tone: 'info',
        title: 'High token volume per commit',
        detail: `Roughly ${(tokensPerCommit / 1e6).toFixed(1)}M tokens per commit. This may indicate heavy exploration, long context windows, or work that has not landed yet.`,
      });
    }
  }

  if (!out.length) {
    out.push({
      tone: 'info',
      title: 'No notable signals',
      detail: 'Cost, usage and value are all within ordinary ranges for the selected period.',
    });
  }

  return out;
}
