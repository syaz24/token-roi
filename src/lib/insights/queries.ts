/**
 * Server-side aggregate queries feeding the Insights view.
 *
 * Everything here returns plain typed objects — no formatting, no rules. The
 * rules live in ./engine.ts and are pure, so they can be tested without a
 * database. Every statement filters on `dataset`.
 *
 * A "turn" is the set of rows sharing (session_id, turn_index). `is_turn_start`
 * marks the first row of a turn, so turn counts are SUM(is_turn_start) and
 * never COUNT(*).
 */

import { raw } from '@/db/client';
import type { Filters } from '../queries';
import { loadPricingRegistry } from '../scan/engine';
import type { InsightInput, SessionInput, TurnInput, WeekdayInput } from './engine';

function where(f: Filters, alias = 'e') {
  const clauses = [`${alias}.dataset = @dataset`, `${alias}.timestamp >= @from`, `${alias}.timestamp <= @to`];
  if (f.projectId) clauses.push(`${alias}.project_id = @projectId`);
  return clauses.join(' AND ');
}

function params(f: Filters) {
  return { dataset: f.dataset, from: f.from, to: f.to, projectId: f.projectId ?? null };
}

/* --------------------------- sessions --------------------------- */

export interface SessionStatRow {
  sessionId: string;
  projectName: string | null;
  /** The user's prompt that opened the session; null for sources without one. */
  firstPrompt: string | null;
  model: string | null;
  /** SUM(is_turn_start). */
  turns: number;
  /** Raw event rows in the session. */
  messages: number;
  tokens: number;
  /** null when nothing in the session could be priced. */
  cost: number | null;
  toolUses: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export function sessionStats(f: Filters, limit = 500): SessionStatRow[] {
  const rows = raw()
    .prepare(
      `SELECT e.session_id sessionId,
              MAX(p.name) projectName,
              COALESCE(SUM(e.is_turn_start),0) turns,
              COUNT(*) messages,
              COALESCE(SUM(e.total_tokens),0) tokens,
              SUM(e.calculated_cost_usd) cost,
              COALESCE(SUM(e.tool_uses),0) toolUses,
              MIN(e.timestamp) startedAt,
              MAX(e.timestamp) endedAt,
              (SELECT x.prompt_preview FROM events x
                WHERE x.dataset = e.dataset AND x.session_id = e.session_id
                  AND x.prompt_preview IS NOT NULL
                ORDER BY COALESCE(x.turn_index, 0), x.timestamp LIMIT 1) firstPrompt,
              (SELECT x.model FROM events x
                WHERE x.dataset = e.dataset AND x.session_id = e.session_id
                  AND x.model IS NOT NULL
                GROUP BY x.model ORDER BY COUNT(*) DESC, x.model LIMIT 1) model
         FROM events e LEFT JOIN projects p ON p.id = e.project_id
        WHERE ${where(f)}
        GROUP BY e.session_id
        ORDER BY tokens DESC, e.session_id
        LIMIT @limit`,
    )
    .all({ ...params(f), limit }) as Array<Omit<SessionStatRow, 'durationMs'>>;

  return rows.map((r) => ({
    ...r,
    durationMs: Math.max(0, Date.parse(r.endedAt) - Date.parse(r.startedAt) || 0),
  }));
}

/* ------------------------- turn curves -------------------------- */

export interface TurnCostPoint {
  turnIndex: number;
  cost: number | null;
  tokens: number;
  prompt: string | null;
}

export function turnCostCurve(f: Filters, sessionId: string): TurnCostPoint[] {
  return raw()
    .prepare(
      `SELECT e.turn_index turnIndex,
              SUM(e.calculated_cost_usd) cost,
              COALESCE(SUM(e.total_tokens),0) tokens,
              MAX(e.prompt_preview) prompt
         FROM events e
        WHERE ${where(f)} AND e.session_id = @sessionId AND e.turn_index IS NOT NULL
        GROUP BY e.turn_index
        ORDER BY e.turn_index`,
    )
    .all({ ...params(f), sessionId }) as TurnCostPoint[];
}

/* ---------------------- expensive prompts ----------------------- */

export interface ExpensivePromptRow {
  sessionId: string;
  turnIndex: number;
  prompt: string;
  model: string | null;
  tokens: number;
  cost: number | null;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** YYYY-MM-DD of the first row in the turn. */
  date: string;
}

export function expensivePrompts(f: Filters, limit = 20): ExpensivePromptRow[] {
  return raw()
    .prepare(
      `SELECT e.session_id sessionId, e.turn_index turnIndex,
              MAX(e.prompt_preview) prompt,
              MAX(e.model) model,
              COALESCE(SUM(e.total_tokens),0) tokens,
              SUM(e.calculated_cost_usd) cost,
              COALESCE(SUM(e.input_tokens),0) inputTokens,
              COALESCE(SUM(e.cache_read_tokens),0) cacheReadTokens,
              COALESCE(SUM(e.output_tokens),0) outputTokens,
              substr(MIN(e.timestamp),1,10) date
         FROM events e
        WHERE ${where(f)} AND e.turn_index IS NOT NULL AND e.prompt_preview IS NOT NULL
        GROUP BY e.session_id, e.turn_index
        ORDER BY tokens DESC, e.session_id, e.turn_index
        LIMIT @limit`,
    )
    .all({ ...params(f), limit }) as ExpensivePromptRow[];
}

/* -------------------------- engine feed ------------------------- */

function turnInputs(f: Filters): TurnInput[] {
  return raw()
    .prepare(
      `SELECT e.session_id sessionId, e.turn_index turnIndex,
              MAX(LENGTH(e.prompt_preview)) promptLength,
              SUM(e.calculated_cost_usd) cost,
              COALESCE(SUM(e.total_tokens),0) tokens,
              COALESCE(SUM(e.tool_uses),0) toolUses
         FROM events e
        WHERE ${where(f)} AND e.turn_index IS NOT NULL
        GROUP BY e.session_id, e.turn_index
        ORDER BY e.session_id, e.turn_index`,
    )
    .all(params(f)) as TurnInput[];
}

function sessionInputs(f: Filters): SessionInput[] {
  return raw()
    .prepare(
      `SELECT e.session_id sessionId,
              COALESCE(SUM(e.is_turn_start),0) turns,
              COALESCE(SUM(e.total_tokens),0) tokens,
              SUM(e.calculated_cost_usd) cost,
              COALESCE(SUM(e.tool_uses),0) toolUses
         FROM events e
        WHERE ${where(f)}
        GROUP BY e.session_id
        ORDER BY e.session_id`,
    )
    .all(params(f)) as SessionInput[];
}

/** Weekday is taken in the machine's local zone, matching what the user saw. */
function weekdayTokens(f: Filters): WeekdayInput[] {
  const rows = raw()
    .prepare(
      `SELECT CAST(strftime('%w', e.timestamp, 'localtime') AS INTEGER) weekday,
              COALESCE(SUM(e.total_tokens),0) tokens
         FROM events e
        WHERE ${where(f)}
        GROUP BY weekday ORDER BY weekday`,
    )
    .all(params(f)) as WeekdayInput[];
  return rows.filter((r) => r.weekday != null);
}

/**
 * Estimated USD saved by cache reads.
 *
 * For each (model, day) the saving is the cache-read volume valued at the
 * difference between the full input price and the cache-read price effective
 * that day. Models with no pricing row contribute nothing rather than a guessed
 * zero-cost saving. Returns null when nothing could be priced.
 */
export function cacheSavings(f: Filters): number | null {
  const rows = raw()
    .prepare(
      `SELECT e.model model, substr(e.timestamp,1,10) day,
              COALESCE(SUM(e.cache_read_tokens),0) cacheRead
         FROM events e
        WHERE ${where(f)} AND e.cache_read_tokens > 0
        GROUP BY e.model, day`,
    )
    .all(params(f)) as Array<{ model: string | null; day: string; cacheRead: number }>;
  if (!rows.length) return null;

  const registry = loadPricingRegistry();
  let saved = 0;
  let priced = 0;
  for (const r of rows) {
    const row = registry.resolve(r.model, `${r.day}T12:00:00.000Z`);
    if (!row) continue;
    const delta = row.inputPerMTok - row.cacheReadPerMTok;
    if (!Number.isFinite(delta) || delta <= 0) continue;
    saved += (r.cacheRead / 1_000_000) * delta;
    priced++;
  }
  if (!priced || !Number.isFinite(saved)) return null;
  return saved;
}

/** Everything buildInsights() needs, in one place. */
export function insightInputs(f: Filters): InsightInput {
  const totals = raw()
    .prepare(
      `SELECT COALESCE(SUM(e.total_tokens),0) totalTokens,
              COALESCE(SUM(e.output_tokens),0) outputTokens,
              COALESCE(SUM(e.cache_read_tokens),0) cacheReadTokens
         FROM events e WHERE ${where(f)}`,
    )
    .get(params(f)) as { totalTokens: number; outputTokens: number; cacheReadTokens: number };

  return {
    turns: turnInputs(f),
    sessions: sessionInputs(f),
    weekdayTokens: weekdayTokens(f),
    totalTokens: totals.totalTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheSavingsUsd: cacheSavings(f),
  };
}
