/**
 * Deterministic conversation insights.
 *
 * Same shape and spirit as src/lib/roi/health.ts: every insight is produced by
 * an explicit rule over numbers we already hold, no model is consulted, and the
 * evidence that triggered each rule travels with it so the user can check the
 * reasoning instead of trusting a black box.
 *
 * Every rule returns null when its inputs are missing or too thin. Nothing here
 * reads the clock, the network or a random source, so the same input always
 * produces byte-identical output.
 */

import { compactNumber, fullNumber, money } from '../format';

export type InsightTone = 'positive' | 'negative' | 'warning' | 'info';

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  evidence?: string[];
}

/** One turn = the rows sharing (sessionId, turnIndex), already aggregated. */
export interface TurnInput {
  sessionId: string;
  turnIndex: number;
  /** Characters in the user's prompt, or null when the source exposes none. */
  promptLength: number | null;
  /** USD, or null when the model could not be priced. Never a silent zero. */
  cost: number | null;
  tokens: number;
  toolUses: number;
}

export interface SessionInput {
  sessionId: string;
  /** SUM(is_turn_start), not a row count. */
  turns: number;
  tokens: number;
  cost: number | null;
  toolUses: number;
}

export interface WeekdayInput {
  /** 0 = Sunday .. 6 = Saturday, local time. */
  weekday: number;
  tokens: number;
}

export interface InsightInput {
  turns: TurnInput[];
  sessions: SessionInput[];
  weekdayTokens: WeekdayInput[];
  totalTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Estimated USD saved by cache reads, or null when it cannot be computed. */
  cacheSavingsUsd: number | null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const fin = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/** One decimal, and no trailing ".0" — avoids reading as fake precision. */
const mult = (n: number) => {
  const s = n.toFixed(1);
  return `${s.endsWith('.0') ? s.slice(0, -2) : s}x`;
};

const pctStr = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function mean(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Turns of one session, ordered, deterministic tie-break on turn index. */
function bySession(turns: TurnInput[]): Map<string, TurnInput[]> {
  const map = new Map<string, TurnInput[]>();
  for (const t of turns) {
    const list = map.get(t.sessionId);
    if (list) list.push(t);
    else map.set(t.sessionId, [t]);
  }
  for (const list of map.values()) list.sort((a, b) => a.turnIndex - b.turnIndex);
  return map;
}

/* ----------------------------- rules ----------------------------- */

/** 1. Short, vague prompts tend to cost the most. */
function shortPromptCost(i: InsightInput): Insight | null {
  const priced = i.turns.filter((t) => fin(t.cost) && t.promptLength != null);
  const short = priced.filter((t) => (t.promptLength as number) < 30).map((t) => t.cost as number);
  const long = priced.filter((t) => (t.promptLength as number) >= 30).map((t) => t.cost as number);
  if (short.length < 5 || long.length < 5) return null;

  const ms = median(short);
  const ml = median(long);
  if (!fin(ms) || !fin(ml) || ml <= 0) return null;
  const ratio = ms / ml;
  if (!Number.isFinite(ratio) || ratio < 1.25) return null;

  return {
    id: 'short-prompts-cost-more',
    tone: 'warning',
    title: 'Short prompts tend to cost more than detailed ones',
    detail: `The median turn started by a prompt under 30 characters cost ${money(
      ms,
    )}, against ${money(ml)} for longer prompts — ${mult(ratio)} as much.`,
    evidence: [
      `${fullNumber(short.length)} turns with a prompt under 30 characters`,
      `${fullNumber(long.length)} turns with a prompt of 30 characters or more`,
      'Medians used, so a single runaway turn cannot drive this',
    ],
  };
}

/** 2. Cost per turn climbs as a conversation grows. */
function costGrowsWithConversation(i: InsightInput): Insight | null {
  const early: number[] = [];
  const late: number[] = [];
  let sessions = 0;

  for (const [, turns] of [...bySession(i.turns)].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const priced = turns.filter((t) => fin(t.cost));
    if (priced.length < 6) continue;
    const third = Math.floor(priced.length / 3);
    if (third < 1) continue;
    sessions++;
    for (const t of priced.slice(0, third)) early.push(t.cost as number);
    for (const t of priced.slice(priced.length - third)) late.push(t.cost as number);
  }
  if (sessions < 2 || !early.length || !late.length) return null;

  const a = mean(early);
  const b = mean(late);
  if (!fin(a) || !fin(b) || a <= 0) return null;
  const ratio = b / a;
  if (!Number.isFinite(ratio) || ratio < 1.25) return null;

  return {
    id: 'cost-rises-with-conversation-length',
    tone: 'warning',
    title: 'Cost per turn rises as a conversation grows',
    detail: `Across ${fullNumber(sessions)} sessions of six or more turns, turns in the last third averaged ${money(
      b,
    )} against ${money(a)} in the first third — ${mult(ratio)} the cost.`,
    evidence: [
      `${fullNumber(early.length)} early turns and ${fullNumber(late.length)} late turns compared`,
      'Growing context is re-sent with every turn, so later turns carry more input',
    ],
  };
}

/** 3. A handful of conversations dominate total usage. */
function tokenConcentration(i: InsightInput): Insight | null {
  const sessions = i.sessions.filter((s) => Number.isFinite(s.tokens) && s.tokens > 0);
  if (sessions.length < 5) return null;
  const total = sessions.reduce((sum, s) => sum + s.tokens, 0);
  if (!(total > 0)) return null;

  const ranked = sessions.slice().sort((a, b) => b.tokens - a.tokens || (a.sessionId < b.sessionId ? -1 : 1));
  let acc = 0;
  let n = 0;
  for (const s of ranked) {
    acc += s.tokens;
    n++;
    if (acc / total >= 0.8) break;
  }
  const share = n / ranked.length;
  if (!Number.isFinite(share) || share > 0.5) return null;

  return {
    id: 'usage-concentrated-in-few-sessions',
    tone: 'info',
    title: 'A small number of conversations account for most tokens',
    detail: `${fullNumber(n)} of ${fullNumber(ranked.length)} sessions (${pctStr(
      share,
    )}) account for 80% of the ${compactNumber(total)} tokens in this period.`,
    evidence: [
      `Largest session used ${compactNumber(ranked[0].tokens)} tokens`,
      `Median session used ${compactNumber(median(ranked.map((s) => s.tokens)) ?? 0)} tokens`,
    ],
  };
}

/** 4. How much of the token bill is actual generated output. */
function outputShare(i: InsightInput): Insight | null {
  if (!(i.totalTokens > 0) || !Number.isFinite(i.outputTokens)) return null;
  const share = i.outputTokens / i.totalTokens;
  if (!Number.isFinite(share)) return null;

  return {
    id: 'output-token-share',
    tone: 'info',
    title: 'Most tokens are context, not generated output',
    detail: `${pctStr(share, 1)} of tokens in this period were output (${compactNumber(
      i.outputTokens,
    )} of ${compactNumber(i.totalTokens)}). That ratio is normal — input, cache reads and cache writes make up the rest.`,
    evidence: [`Cache reads alone accounted for ${compactNumber(i.cacheReadTokens)} tokens`],
  };
}

/** 5. Which weekday carries the most volume. */
function busiestWeekday(i: InsightInput): Insight | null {
  const rows = i.weekdayTokens.filter(
    (w) => Number.isInteger(w.weekday) && w.weekday >= 0 && w.weekday <= 6 && Number.isFinite(w.tokens) && w.tokens > 0,
  );
  if (rows.length < 2) return null;
  const total = rows.reduce((s, w) => s + w.tokens, 0);
  if (!(total > 0)) return null;

  const ranked = rows.slice().sort((a, b) => b.tokens - a.tokens || a.weekday - b.weekday);
  const top = ranked[0];
  const share = top.tokens / total;
  if (!Number.isFinite(share)) return null;

  return {
    id: 'busiest-weekday',
    tone: 'info',
    title: `${WEEKDAYS[top.weekday]} is the busiest day for token use`,
    detail: `${WEEKDAYS[top.weekday]} accounts for ${compactNumber(top.tokens)} tokens, ${pctStr(
      share,
    )} of the ${compactNumber(total)} recorded across ${fullNumber(rows.length)} active weekdays.`,
    evidence: ranked
      .slice(0, 3)
      .map((w) => `${WEEKDAYS[w.weekday]}: ${compactNumber(w.tokens)} tokens`),
  };
}

/** 6. Conversations that are mostly tool traffic. */
function toolHeavySessions(i: InsightInput): Insight | null {
  const eligible = i.sessions.filter((s) => s.turns >= 3 && Number.isFinite(s.toolUses));
  if (eligible.length < 3) return null;
  const heavy = eligible.filter((s) => s.toolUses >= s.turns * 5);
  if (!heavy.length) return null;

  const ranked = heavy
    .slice()
    .sort((a, b) => b.toolUses / b.turns - a.toolUses / a.turns || (a.sessionId < b.sessionId ? -1 : 1));
  const top = ranked[0];
  const topRatio = top.toolUses / top.turns;
  if (!Number.isFinite(topRatio)) return null;

  return {
    id: 'tool-heavy-sessions',
    tone: 'info',
    title: 'Some conversations are dominated by tool calls',
    detail: `${fullNumber(heavy.length)} of ${fullNumber(
      eligible.length,
    )} sessions ran at least five tool calls per turn. The heaviest averaged ${mult(topRatio)} — ${fullNumber(
      top.toolUses,
    )} tool calls across ${fullNumber(top.turns)} turns.`,
    evidence: ranked
      .slice(0, 3)
      .map((s) => `${s.sessionId}: ${fullNumber(s.toolUses)} tool calls over ${fullNumber(s.turns)} turns`),
  };
}

/** 7. What prompt caching saved, at real per-model prices. */
function cacheSavings(i: InsightInput): Insight | null {
  if (!fin(i.cacheSavingsUsd) || !(i.cacheReadTokens > 0)) return null;
  if (i.cacheSavingsUsd <= 0) return null;

  return {
    id: 'cache-savings',
    tone: 'positive',
    title: 'Prompt caching is reducing your input cost',
    detail: `${compactNumber(i.cacheReadTokens)} tokens were served from cache. At the cache-read prices for the models involved, that is an estimated ${money(
      i.cacheSavingsUsd,
    )} less than paying full input price for the same tokens. Treat it as an estimate, not a billed figure.`,
    evidence: [
      'Priced per model and per day from the pricing registry',
      'Unpriced models are excluded rather than assumed to be free',
    ],
  };
}

/** 8. Where a fresh conversation would likely have been cheaper. */
function clearPoint(i: InsightInput): Insight | null {
  const points: number[] = [];
  for (const [, turns] of [...bySession(i.turns)].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const priced = turns.filter((t) => fin(t.cost));
    if (priced.length < 6) continue;
    const third = Math.floor(priced.length / 3);
    if (third < 1) continue;
    const base = median(priced.slice(0, third).map((t) => t.cost as number));
    if (!fin(base) || base <= 0) continue;
    const hit = priced.slice(third).find((t) => (t.cost as number) > base * 2);
    if (hit) points.push(hit.turnIndex);
  }
  if (points.length < 3) return null;
  const at = median(points);
  if (!fin(at)) return null;

  return {
    id: 'suggested-clear-point',
    tone: 'info',
    title: 'Cost per turn typically doubles around a predictable point',
    detail: `Across ${fullNumber(points.length)} sessions, cost per turn first passed twice the session's early-turn median at turn ${fullNumber(
      at,
    )} on average. If a conversation has moved on to a new task by then, starting a fresh one may be cheaper.`,
    evidence: [
      `Earliest doubling seen at turn ${fullNumber(Math.min(...points))}`,
      `Latest doubling seen at turn ${fullNumber(Math.max(...points))}`,
      'Median used across sessions, so one long outlier cannot set the figure',
    ],
  };
}

/** 9. How much of the period can actually be attributed to a prompt. */
function promptCoverage(i: InsightInput): Insight | null {
  if (i.turns.length < 20) return null;
  const withPrompt = i.turns.filter((t) => t.promptLength != null).length;
  const share = withPrompt / i.turns.length;
  if (!Number.isFinite(share) || share >= 0.95 || share === 0) return null;

  return {
    id: 'prompt-coverage',
    tone: 'warning',
    title: 'Some turns have no recorded prompt',
    detail: `${pctStr(share)} of ${fullNumber(
      i.turns.length,
    )} turns carry a prompt (${fullNumber(withPrompt)}). Prompt-based findings above are drawn only from those turns; sources that do not expose prompts are excluded rather than guessed at.`,
  };
}

/** 10. A single conversation carrying an outsized share of the bill. */
function dominantSession(i: InsightInput): Insight | null {
  const priced = i.sessions.filter((s) => fin(s.cost) && (s.cost as number) > 0);
  if (priced.length < 5) return null;
  const total = priced.reduce((sum, s) => sum + (s.cost as number), 0);
  if (!(total > 0)) return null;

  const ranked = priced
    .slice()
    .sort((a, b) => (b.cost as number) - (a.cost as number) || (a.sessionId < b.sessionId ? -1 : 1));
  const top = ranked[0];
  const share = (top.cost as number) / total;
  if (!Number.isFinite(share) || share < 0.25) return null;

  return {
    id: 'single-session-dominates-cost',
    tone: 'warning',
    title: 'One conversation carries much of the cost',
    detail: `Session ${top.sessionId} cost ${money(top.cost)}, ${pctStr(
      share,
    )} of the ${money(total)} priced total across ${fullNumber(priced.length)} sessions.`,
    evidence: [
      `${fullNumber(top.turns)} turns and ${compactNumber(top.tokens)} tokens in that session`,
    ],
  };
}

const RULES: Array<(i: InsightInput) => Insight | null> = [
  shortPromptCost,
  costGrowsWithConversation,
  tokenConcentration,
  outputShare,
  busiestWeekday,
  toolHeavySessions,
  cacheSavings,
  clearPoint,
  promptCoverage,
  dominantSession,
];

/**
 * Build the insight list. Rules run in a fixed order and each one omits itself
 * when its inputs are absent, so an empty result means "nothing could be said",
 * never "nothing is wrong".
 */
export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  for (const rule of RULES) {
    const insight = rule(input);
    if (insight && !hasBrokenNumber(insight)) out.push(insight);
  }
  return out;
}

/** Last line of defence: never ship "NaN" or "Infinity" into the UI. */
function hasBrokenNumber(i: Insight): boolean {
  const text = [i.title, i.detail, ...(i.evidence ?? [])].join(' ');
  return /NaN|Infinity|undefined|null/.test(text);
}
