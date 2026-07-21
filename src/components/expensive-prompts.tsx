'use client';

import * as React from 'react';
import { Badge, Empty, Panel, SERIES_PALETTE } from './ui';
import { SessionDetail } from './session-detail';
import type { ExpensivePromptRow } from '@/lib/insights/queries';
import type { SessionRow } from '@/lib/queries';
import { compactNumber, money, shortDate } from '@/lib/format';

/**
 * Turns ranked by token volume, showing the prompt that started each one.
 *
 * The bar is scaled against the most expensive turn, so the shape of the
 * distribution is visible at a glance — usually a very steep drop-off.
 */
export function ExpensivePrompts({ rows }: { rows: ExpensivePromptRow[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const max = rows.length ? Math.max(...rows.map((r) => r.tokens)) : 1;

  const openSession: SessionRow | null = React.useMemo(() => {
    const hit = rows.find((r) => r.sessionId === openId);
    if (!hit) return null;
    // The drawer refetches full detail by id; this seeds the header.
    return {
      sessionId: hit.sessionId,
      projectId: null,
      projectName: null,
      source: 'claude-code',
      model: hit.model,
      firstPrompt: hit.prompt,
      requests: 0,
      turns: 0,
      toolUses: 0,
      tokens: hit.tokens,
      inputTokens: hit.inputTokens,
      outputTokens: hit.outputTokens,
      cacheReadTokens: hit.cacheReadTokens,
      cacheWriteTokens: 0,
      cost: hit.cost,
      startedAt: hit.date,
      endedAt: hit.date,
    };
  }, [openId, rows]);

  return (
    <>
      <Panel
        title="Most expensive prompts"
        subtitle="Single turns ranked by tokens consumed"
        bodyClassName="p-0"
      >
        {rows.length === 0 ? (
          <Empty
            title="No prompts recorded in this range."
            hint="Prompt text is only captured for sources that expose it, and only under your prompt-storage policy in Settings › Privacy."
          />
        ) : (
          <ol className="divide-y divide-hair">
            {rows.map((r, i) => (
              <li key={`${r.sessionId}-${r.turnIndex}`}>
                <button
                  onClick={() => setOpenId(r.sessionId)}
                  className="w-full px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold text-ink"
                      style={{ background: `${SERIES_PALETTE[i % SERIES_PALETTE.length]}33` }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[11px] leading-relaxed text-ink">{r.prompt}</p>
                      <p className="mono mt-1 text-[10px] text-ink3">
                        {shortDate(r.date)} · {r.model ?? 'unknown'} · turn {r.turnIndex}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-[12px] font-semibold text-roi">{compactNumber(r.tokens)}</div>
                      <div className="num text-[10px] text-ink3">
                        {r.cost == null ? 'unpriced' : money(r.cost)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (r.tokens / max) * 100)}%`,
                        background: SERIES_PALETTE[i % SERIES_PALETTE.length],
                      }}
                    />
                  </div>

                  <div className="mt-1 flex gap-3 text-[9.5px] text-ink3">
                    <span className="num">{compactNumber(r.inputTokens)} in</span>
                    <span className="num">{compactNumber(r.cacheReadTokens)} cached</span>
                    <span className="num">{compactNumber(r.outputTokens)} out</span>
                  </div>
                </button>
              </li>
            ))}
          </ol>
        )}

        <p className="border-t border-hair px-3.5 py-2 text-[10px] leading-relaxed text-ink3">
          A turn is expensive mostly because of what was already in the context, not because the prompt itself
          was long — the whole conversation is re-sent each time.
        </p>
      </Panel>

      {openSession && <SessionDetail session={openSession} onClose={() => setOpenId(null)} />}
    </>
  );
}
