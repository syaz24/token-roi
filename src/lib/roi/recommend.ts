/**
 * Deterministic project recommendation scoring.
 *
 * No LLM is involved. Every classification is a pure function of the numbers
 * below, and the contributing factors are returned so the UI can always show
 * exactly why a project landed where it did.
 *
 * This is a bookkeeping heuristic, not financial advice.
 */

export type Recommendation =
  | 'Double Down'
  | 'Maintain'
  | 'Validate Further'
  | 'Reduce Spend'
  | 'Pause'
  | 'Insufficient Data';

export interface ScoreInput {
  roiPct: number | null;
  netValue: number | null;
  /** Value added in the recent window vs the previous window, as a ratio. */
  recentValueGrowth: number | null;
  /** Cost in recent window vs previous window, as a ratio. */
  costTrend: number | null;
  /** Value produced per million tokens. */
  valuePerMTok: number | null;
  /** 0..1 share of tokens that could be priced. */
  pricingCoverage: number;
  /** 0..1 share of value that is realised rather than estimated. */
  realisedShare: number;
  daysSinceValueUpdate: number | null;
  totalTokens: number;
  hasValueData: boolean;
}

export interface Factor {
  label: string;
  detail: string;
  points: number;
}

export interface ScoreResult {
  recommendation: Recommendation;
  score: number;
  confidence: 'low' | 'medium' | 'high';
  factors: Factor[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function scoreProject(i: ScoreInput): ScoreResult {
  const factors: Factor[] = [];

  // Not enough signal to say anything responsible.
  if (!i.hasValueData || i.totalTokens < 1000) {
    return {
      recommendation: 'Insufficient Data',
      score: 0,
      confidence: 'low',
      factors: [
        {
          label: 'Insufficient data',
          detail: !i.hasValueData
            ? 'No project value has been recorded, so return cannot be assessed.'
            : 'Too little token usage recorded to judge efficiency.',
          points: 0,
        },
      ],
    };
  }

  let score = 0;

  if (i.roiPct != null) {
    const pts = clamp(i.roiPct / 25, -20, 35);
    score += pts;
    factors.push({
      label: 'Realised ROI',
      detail: `${i.roiPct >= 0 ? '+' : ''}${i.roiPct.toFixed(0)}% return on the selected cost basis.`,
      points: round(pts),
    });
  }

  if (i.netValue != null) {
    const pts = clamp(Math.sign(i.netValue) * Math.log10(1 + Math.abs(i.netValue)) * 4, -15, 20);
    score += pts;
    factors.push({
      label: 'Net value',
      detail: `${i.netValue >= 0 ? 'Net positive' : 'Net negative'} of ${fmt(i.netValue)}.`,
      points: round(pts),
    });
  }

  if (i.recentValueGrowth != null) {
    const pts = clamp((i.recentValueGrowth - 1) * 15, -12, 18);
    score += pts;
    factors.push({
      label: 'Recent value growth',
      detail:
        i.recentValueGrowth >= 1
          ? `Value added grew ${((i.recentValueGrowth - 1) * 100).toFixed(0)}% versus the previous period.`
          : `Value added fell ${((1 - i.recentValueGrowth) * 100).toFixed(0)}% versus the previous period.`,
      points: round(pts),
    });
  }

  if (i.costTrend != null) {
    // Rising cost is only a negative when value is not rising with it.
    const valueKeepingUp = (i.recentValueGrowth ?? 0) >= i.costTrend;
    const pts = valueKeepingUp ? 0 : clamp(-(i.costTrend - 1) * 12, -15, 0);
    score += pts;
    factors.push({
      label: 'Cost trend',
      detail: valueKeepingUp
        ? 'Spend is growing no faster than value.'
        : `Spend rose ${((i.costTrend - 1) * 100).toFixed(0)}% while value did not keep pace.`,
      points: round(pts),
    });
  }

  if (i.valuePerMTok != null) {
    const pts = clamp(Math.log10(1 + Math.max(0, i.valuePerMTok)) * 5, 0, 12);
    score += pts;
    factors.push({
      label: 'Token efficiency',
      detail: `${fmt(i.valuePerMTok)} of value per million tokens.`,
      points: round(pts),
    });
  }

  const dataPenalty = clamp(-(1 - i.pricingCoverage) * 15, -15, 0);
  if (dataPenalty < -0.5) {
    score += dataPenalty;
    factors.push({
      label: 'Data confidence',
      detail: `Only ${(i.pricingCoverage * 100).toFixed(0)}% of tokens could be priced.`,
      points: round(dataPenalty),
    });
  }

  const estimatePenalty = clamp(-(1 - i.realisedShare) * 12, -12, 0);
  if (estimatePenalty < -0.5) {
    score += estimatePenalty;
    factors.push({
      label: 'Value quality',
      detail: `${(i.realisedShare * 100).toFixed(0)}% of recorded value is realised; the rest is estimated.`,
      points: round(estimatePenalty),
    });
  }

  if (i.daysSinceValueUpdate != null && i.daysSinceValueUpdate > 90) {
    const pts = clamp(-(i.daysSinceValueUpdate - 90) / 30, -10, 0);
    score += pts;
    factors.push({
      label: 'Stale value data',
      detail: `No value update for ${i.daysSinceValueUpdate} days.`,
      points: round(pts),
    });
  }

  const confidence: ScoreResult['confidence'] =
    i.pricingCoverage > 0.9 && i.realisedShare > 0.6
      ? 'high'
      : i.pricingCoverage > 0.6
        ? 'medium'
        : 'low';

  return { recommendation: classify(score, i), score: round(score), confidence, factors };
}

function classify(score: number, i: ScoreInput): Recommendation {
  if (confidenceTooLow(i)) return 'Validate Further';
  if (score >= 30) return 'Double Down';
  if (score >= 10) return 'Maintain';
  if (score >= -5) return 'Validate Further';
  if (score >= -20) return 'Reduce Spend';
  return 'Pause';
}

function confidenceTooLow(i: ScoreInput): boolean {
  // Strong-looking numbers built mostly on estimates should not read as a
  // confident "double down".
  return i.realisedShare < 0.25 && i.pricingCoverage < 0.5;
}

const round = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) =>
  `$${Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(2)}`;
