/**
 * Seed pricing rows (USD per 1M tokens).
 *
 * These are STARTING VALUES ONLY. They are inserted once, are fully editable in
 * Settings -> Pricing, and every row is stamped with a source note so it is
 * obvious they are user-verifiable defaults rather than authoritative billing
 * data. Any model with no matching row is reported as "Unpriced" and excluded
 * from cost totals rather than silently priced at zero.
 */
export interface SeedPrice {
  provider: string;
  modelId: string;
  aliases: string[];
  effectiveFrom: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number | null;
}

export const SEED_PRICING: SeedPrice[] = [
  // --- Anthropic ---
  { provider: 'anthropic', modelId: 'claude-opus-4-8', aliases: ['claude-opus-4-8-20260115', 'opus-4.8', 'claude-opus-4.8'], effectiveFrom: '2020-01-01', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { provider: 'anthropic', modelId: 'claude-opus-4-1', aliases: ['claude-opus-4-1-20250805', 'opus-4.1'], effectiveFrom: '2020-01-01', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  { provider: 'anthropic', modelId: 'claude-sonnet-5', aliases: ['claude-sonnet-5-20260115', 'sonnet-5'], effectiveFrom: '2020-01-01', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { provider: 'anthropic', modelId: 'claude-sonnet-4-5', aliases: ['claude-sonnet-4-5-20250929', 'sonnet-4.5'], effectiveFrom: '2020-01-01', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { provider: 'anthropic', modelId: 'claude-haiku-4-5', aliases: ['claude-haiku-4-5-20251001', 'haiku-4.5'], effectiveFrom: '2020-01-01', input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  { provider: 'anthropic', modelId: 'claude-3-5-haiku', aliases: ['claude-3-5-haiku-20241022'], effectiveFrom: '2020-01-01', input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  { provider: 'anthropic', modelId: 'claude-fable-5', aliases: ['fable-5'], effectiveFrom: '2020-01-01', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },

  // --- OpenAI ---
  { provider: 'openai', modelId: 'gpt-5.5', aliases: ['gpt-5.5-codex', 'gpt-5.5-turbo'], effectiveFrom: '2020-01-01', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  { provider: 'openai', modelId: 'gpt-5', aliases: ['gpt-5-codex'], effectiveFrom: '2020-01-01', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  { provider: 'openai', modelId: 'gpt-5-mini', aliases: [], effectiveFrom: '2020-01-01', input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  { provider: 'openai', modelId: 'o3', aliases: [], effectiveFrom: '2020-01-01', input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  { provider: 'openai', modelId: 'gpt-4.1', aliases: [], effectiveFrom: '2020-01-01', input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },

  // --- Google ---
  { provider: 'google', modelId: 'gemini-3-pro', aliases: ['gemini-3-pro-preview'], effectiveFrom: '2020-01-01', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  { provider: 'google', modelId: 'gemini-3-flash', aliases: ['gemini-3-flash-preview'], effectiveFrom: '2020-01-01', input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  { provider: 'google', modelId: 'gemini-2.5-pro', aliases: [], effectiveFrom: '2020-01-01', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  { provider: 'google', modelId: 'gemini-2.5-flash', aliases: [], effectiveFrom: '2020-01-01', input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
];

export const SEED_NOTE =
  'Bundled starting value — verify against your provider pricing page and edit in Settings › Pricing.';
