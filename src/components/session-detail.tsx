'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { Badge, Button, Empty, cn } from './ui';
import { TurnCostChart } from './charts';
import type { SessionRow, TurnRow } from '@/lib/queries';
import { compactNumber, dateTime, fullNumber, money } from '@/lib/format';

/** Turn-by-turn breakdown of one conversation, loaded on demand. */
export function SessionDetail({ session, onClose }: { session: SessionRow; onClose: () => void }) {
  const [turns, setTurns] = React.useState<TurnRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  React.useEffect(() => {
    let live = true;
    fetch(`/api/session?id=${encodeURIComponent(session.sessionId)}`)
      .then((r) => r.json())
      .then((d) => live && setTurns(d.turns ?? []))
      .catch(() => live && setError('Could not load the turn breakdown.'));
    return () => {
      live = false;
    };
  }, [session.sessionId]);

  const priced = (turns ?? []).filter((t) => t.cost != null && t.cost > 0);
  const costs = priced.map((t) => t.cost as number).sort((a, b) => a - b);
  const median = costs.length ? costs[Math.floor(costs.length / 2)] : 0;
  const peak = priced.reduce<TurnRow | null>((a, b) => ((b.cost ?? 0) > (a?.cost ?? 0) ? b : a), null);
  const spike = peak && median > 0 ? (peak.cost as number) / median : null;

  return (
    <AnimatePresence>
      <motion.div
        key="scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.14 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]"
      />
      <motion.aside
        key="drawer"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="panel fixed right-0 top-0 z-50 flex h-full w-full max-w-[620px] flex-col rounded-none border-y-0 border-r-0 border-l"
      >
        <header className="flex items-start justify-between gap-3 border-b border-hair px-4 py-3">
          <div className="min-w-0">
            <h2 className="label-xs">Conversation</h2>
            <p className="mt-1 line-clamp-2 text-[12px] font-medium text-ink">
              {session.firstPrompt ?? <span className="text-ink3">No prompt recorded</span>}
            </p>
            <p className="mono mt-1 truncate text-[10px] text-ink3">
              {dateTime(session.startedAt)} · {session.model ?? 'unknown model'} ·{' '}
              {session.turns > 0 ? `${session.turns} turns · ` : ''}
              {compactNumber(session.tokens)} tokens
            </p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <X size={13} />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3.5">
          <section>
            <h3 className="label-xs mb-1.5 border-b border-hair pb-1">Cost per turn</h3>
            <p className="mb-2 text-[10px] leading-relaxed text-ink3">
              Each point is one turn — your message plus the full response, including every tool step it
              triggered. The y-axis is API-equivalent cost; on a subscription you do not pay this directly, but
              it shows how much work each turn required.
            </p>
            {turns == null && !error && <div className="h-[200px] animate-pulse rounded bg-white/[0.03]" />}
            {error && <Empty title={error} />}
            {turns && turns.length > 0 && (
              <TurnCostChart
                data={turns.map((t) => ({
                  turnIndex: t.turnIndex,
                  cost: t.cost,
                  prompt: t.prompt,
                  tokens: t.tokens,
                }))}
              />
            )}
            {turns && turns.length === 0 && (
              <Empty title="This source does not record turn boundaries." hint="Turn-level detail is available for Claude Code sessions." />
            )}
          </section>

          {spike && spike > 3 && peak && (
            <div className="rounded-md border border-warn/25 bg-warn/10 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-warn">
                <AlertTriangle size={11} />
                Turn {peak.turnIndex} cost {money(peak.cost)} — {spike.toFixed(0)}× the median turn
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-ink2">
                Median turn cost here is {money(median)}. Cost climbs as the context grows, because the whole
                conversation is re-sent with every turn. Starting a fresh session before a big new task resets
                that and brings the per-turn cost back down.
              </p>
            </div>
          )}

          <section>
            <h3 className="label-xs mb-1.5 border-b border-hair pb-1">Totals</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
              <KV label="Turns" value={session.turns > 0 ? fullNumber(session.turns) : '—'} />
              <KV label="Requests" value={fullNumber(session.requests)} />
              <KV label="Tool calls" value={session.toolUses > 0 ? fullNumber(session.toolUses) : '—'} />
              <KV label="API cost" value={session.cost == null ? 'unpriced' : money(session.cost)} />
              <KV label="Input" value={fullNumber(session.inputTokens)} />
              <KV label="Output" value={fullNumber(session.outputTokens)} />
              <KV label="Cache read" value={fullNumber(session.cacheReadTokens)} />
              <KV label="Cache write" value={fullNumber(session.cacheWriteTokens)} />
              <KV label="Total tokens" value={fullNumber(session.tokens)} />
              <KV label="Project" value={session.projectName ?? 'unassigned'} />
            </dl>
          </section>

          <section>
            <h3 className="label-xs mb-1.5 border-b border-hair pb-1">Turns</h3>
            <ol className="space-y-1.5">
              {(turns ?? []).map((t) => (
                <li key={t.turnIndex} className="rounded border border-hair bg-black/20 p-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="num shrink-0 text-[10px] text-ink3">#{t.turnIndex}</span>
                    <p className="line-clamp-3 flex-1 text-[10.5px] leading-relaxed text-ink2">
                      {t.prompt ?? <span className="text-ink3">no prompt recorded</span>}
                    </p>
                    <span className="num shrink-0 text-[10.5px] text-ink">{money(t.cost)}</span>
                  </div>
                  <div className="mt-1 flex gap-3 text-[9.5px] text-ink3">
                    <span className="num">{compactNumber(t.tokens)} tokens</span>
                    <span className="num">{t.requests} requests</span>
                    {t.toolUses > 0 && <span className="num">{t.toolUses} tool calls</span>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <p className="mono truncate text-[9.5px] text-ink3">session {session.sessionId}</p>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hair pb-1">
      <dt className="shrink-0 text-ink3">{label}</dt>
      <dd className="num truncate text-right text-ink2">{value}</dd>
    </div>
  );
}
