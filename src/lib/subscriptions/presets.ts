/**
 * Common AI coding subscriptions, offered as one-click starting points.
 *
 * These prices are INDICATIVE DEFAULTS, not authoritative billing data. Plans
 * and prices change often and vary by region, tax and currency. Every field is
 * editable after you pick a preset, and you should confirm the amount against
 * your own invoice — the same rule the model pricing registry follows.
 */
export interface SubscriptionPreset {
  id: string;
  provider: string;
  planName: string;
  /** USD per billing cycle, before seats, tax and discount. */
  price: number;
  cycle: 'monthly' | 'annual' | 'one_time';
  /** True when the price is charged per seat rather than per account. */
  perSeat?: boolean;
  note?: string;
}

export const SUBSCRIPTION_PRESETS: SubscriptionPreset[] = [
  { id: 'claude-pro', provider: 'Anthropic', planName: 'Claude Pro', price: 20, cycle: 'monthly' },
  { id: 'claude-max-5', provider: 'Anthropic', planName: 'Claude Max (5×)', price: 100, cycle: 'monthly' },
  { id: 'claude-max-20', provider: 'Anthropic', planName: 'Claude Max (20×)', price: 200, cycle: 'monthly' },
  { id: 'chatgpt-plus', provider: 'OpenAI', planName: 'ChatGPT Plus', price: 20, cycle: 'monthly' },
  { id: 'chatgpt-pro', provider: 'OpenAI', planName: 'ChatGPT Pro', price: 200, cycle: 'monthly' },
  { id: 'chatgpt-team', provider: 'OpenAI', planName: 'ChatGPT Team', price: 30, cycle: 'monthly', perSeat: true },
  { id: 'copilot-pro', provider: 'GitHub', planName: 'Copilot Pro', price: 10, cycle: 'monthly' },
  { id: 'copilot-pro-plus', provider: 'GitHub', planName: 'Copilot Pro+', price: 39, cycle: 'monthly' },
  { id: 'cursor-pro', provider: 'Cursor', planName: 'Pro', price: 20, cycle: 'monthly' },
  { id: 'cursor-ultra', provider: 'Cursor', planName: 'Ultra', price: 200, cycle: 'monthly' },
  { id: 'gemini-pro', provider: 'Google', planName: 'Gemini AI Pro', price: 20, cycle: 'monthly' },
  { id: 'windsurf-pro', provider: 'Windsurf', planName: 'Pro', price: 15, cycle: 'monthly' },
  {
    id: 'openrouter-credits',
    provider: 'OpenRouter',
    planName: 'Credit purchase',
    price: 50,
    cycle: 'one_time',
    note: 'A one-time top-up is charged only in the month you bought it.',
  },
];

export const CUSTOM_PRESET_ID = '__custom__';

export function findPreset(id: string): SubscriptionPreset | undefined {
  return SUBSCRIPTION_PRESETS.find((p) => p.id === id);
}
