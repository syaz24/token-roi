/**
 * Central cost engine. NOTHING else in the codebase may hardcode a token price.
 *
 * Pricing is resolved by (model, event date): the row whose [effectiveFrom,
 * effectiveTo) window contains the event timestamp wins, with user overrides
 * preferred over bundled defaults. A model with no matching row is UNPRICED —
 * its tokens are still counted, but its cost is null and it is excluded from
 * cost totals and surfaced as a coverage warning.
 */

export interface PriceRow {
  id: string;
  provider: string;
  modelId: string;
  aliases: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  reasoningPerMTok: number | null;
  userOverride: boolean;
}

export interface TokenCounts {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  reasoningCost: number;
  total: number;
  pricingId: string;
}

const M = 1_000_000;

export function normaliseModelKey(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(anthropic|openai|google|models)\//, '')
    .replace(/[._]/g, '-')
    .replace(/-\d{8}$/, '') // strip a trailing date stamp: claude-sonnet-5-20260115
    .replace(/-latest$/, '');
}

/** Build a lookup index: every canonical id AND alias -> candidate rows. */
export class PricingRegistry {
  private index = new Map<string, PriceRow[]>();

  constructor(rows: PriceRow[]) {
    for (const row of rows) {
      const keys = new Set([normaliseModelKey(row.modelId), ...row.aliases.map(normaliseModelKey)]);
      for (const k of keys) {
        const list = this.index.get(k);
        if (list) list.push(row);
        else this.index.set(k, [row]);
      }
    }
  }

  /** Resolve the price effective on `date` (ISO string) for `model`. */
  resolve(model: string | null | undefined, date: string): PriceRow | null {
    if (!model) return null;
    const key = normaliseModelKey(model);
    let candidates = this.index.get(key);

    // Fall back to the longest registered key that prefixes this model, so an
    // unseen dated/suffixed variant still prices against its family.
    if (!candidates) {
      let best: { k: string; rows: PriceRow[] } | null = null;
      for (const [k, rows] of this.index) {
        if (key.startsWith(k) && (!best || k.length > best.k.length)) best = { k, rows };
      }
      candidates = best?.rows;
    }
    if (!candidates?.length) return null;

    const t = Date.parse(date);
    const inWindow = candidates.filter((r) => {
      const from = Date.parse(r.effectiveFrom);
      const to = r.effectiveTo ? Date.parse(r.effectiveTo) : Infinity;
      return Number.isFinite(t) ? t >= from && t < to : true;
    });
    const pool = inWindow.length ? inWindow : [];
    if (!pool.length) return null;

    // Prefer user overrides, then the most recently effective row.
    pool.sort((a, b) => {
      if (a.userOverride !== b.userOverride) return a.userOverride ? -1 : 1;
      return Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom);
    });
    return pool[0];
  }

  /** Returns null when the model cannot be priced — never a silent zero. */
  cost(model: string | null | undefined, date: string, tokens: TokenCounts): CostBreakdown | null {
    const row = this.resolve(model, date);
    if (!row) return null;
    const inputCost = ((tokens.inputTokens ?? 0) / M) * row.inputPerMTok;
    const outputCost = ((tokens.outputTokens ?? 0) / M) * row.outputPerMTok;
    const cacheReadCost = ((tokens.cacheReadTokens ?? 0) / M) * row.cacheReadPerMTok;
    const cacheWriteCost = ((tokens.cacheWriteTokens ?? 0) / M) * row.cacheWritePerMTok;
    // Reasoning tokens are billed only when a distinct reasoning price exists;
    // in every verified source they are already inside the output count.
    const reasoningCost =
      row.reasoningPerMTok != null ? ((tokens.reasoningTokens ?? 0) / M) * row.reasoningPerMTok : 0;
    const total = inputCost + outputCost + cacheReadCost + cacheWriteCost + reasoningCost;
    return { inputCost, outputCost, cacheReadCost, cacheWriteCost, reasoningCost, total, pricingId: row.id };
  }
}
