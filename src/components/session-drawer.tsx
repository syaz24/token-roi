'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, X } from 'lucide-react';
import { Badge, Button, Portal, cn } from './ui';
import type { EventRow } from '@/lib/queries';
import { compactNumber, dateTime, duration, fullNumber, money } from '@/lib/format';

export function SessionDrawer({ row, onClose }: { row: EventRow; onClose: () => void }) {
  const [showPrompt, setShowPrompt] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  let metadata: Record<string, unknown> = {};
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    metadata = { _parseError: 'metadata is not valid JSON' };
  }

  const tokenRows: Array<[string, number | null]> = [
    ['Input', row.inputTokens],
    ['Output', row.outputTokens],
    ['Cache read', row.cacheReadTokens],
    ['Cache write', row.cacheWriteTokens],
    ['Reasoning', row.reasoningTokens],
  ];

  return (
    <Portal>
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
        transition={{ type: 'tween', duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="panel fixed right-0 top-0 z-50 flex h-full w-full max-w-[440px] flex-col rounded-none border-l border-y-0 border-r-0"
      >
        <header className="flex items-start justify-between gap-3 border-b border-hair px-4 py-3">
          <div className="min-w-0">
            <h2 className="label-xs">Trace detail</h2>
            <p className="mono mt-1 truncate text-[11px] text-ink">{row.eventId}</p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <X size={13} />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3.5">
          <Section title="Session metadata">
            <KV label="Timestamp" value={dateTime(row.timestamp)} mono />
            <KV label="Session ID" value={row.sessionId} mono />
            <KV label="Source" value={row.source} />
            <KV label="Provider" value={row.provider ?? '—'} />
            <KV label="Model" value={row.model ?? '—'} mono />
            <KV label="Duration" value={duration(row.durationMs)} />
            <KV
              label="Status"
              value={<Badge tone={row.status === 'ok' ? 'neutral' : 'neg'}>{row.status}</Badge>}
            />
          </Section>

          <Section title="Token breakdown">
            {tokenRows.map(([label, v]) => (
              <KV
                key={label}
                label={label}
                value={v == null ? <span className="text-ink3">not reported</span> : fullNumber(v)}
                mono
              />
            ))}
            <div className="mt-1.5 flex items-baseline justify-between border-t border-hair pt-1.5">
              <span className="label-xs">Total</span>
              <span className="mono text-[12px] font-semibold text-ink">{fullNumber(row.totalTokens)}</span>
            </div>
          </Section>

          <Section title="Cost calculation">
            {row.priced ? (
              <>
                <KV label="API-equivalent cost" value={money(row.calculatedCostUsd)} mono />
                <KV label="Pricing record" value={row.pricingId ?? '—'} mono />
                <p className="mt-1.5 text-[10px] leading-relaxed text-ink3">
                  Calculated from the pricing effective on this event&apos;s date. Editable in Settings › Pricing.
                </p>
              </>
            ) : (
              <div className="rounded-md border border-warn/25 bg-warn/10 p-2.5">
                <p className="text-[11px] font-medium text-warn">Unpriced model</p>
                <p className="mt-1 text-[10px] leading-relaxed text-ink2">
                  No pricing record matches <span className="mono">{row.model ?? 'unknown'}</span> on this date. Its{' '}
                  {compactNumber(row.totalTokens)} tokens are counted but excluded from cost totals.
                </p>
              </div>
            )}
          </Section>

          <Section title="Project mapping">
            <KV label="Project" value={row.projectName ?? <span className="text-ink3">unassigned</span>} />
            <KV label="Method" value={row.mappingMethod ?? <span className="text-ink3">no match</span>} />
            <KV label="Working directory" value={row.workingDirectory ?? '—'} mono wrap />
          </Section>

          <Section title="Prompt preview">
            {row.promptPreview ? (
              <>
                <Button size="xs" variant="ghost" onClick={() => setShowPrompt((v) => !v)}>
                  {showPrompt ? <EyeOff size={10} /> : <Eye size={10} />}
                  {showPrompt ? 'Hide' : 'Reveal'} preview
                </Button>
                <p
                  className={cn(
                    'mono mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-hair bg-black/30 p-2 text-[10.5px] leading-relaxed text-ink2',
                    !showPrompt && 'select-none blur-sm',
                  )}
                >
                  {row.promptPreview}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-ink3">
                No prompt text stored for this event (per your privacy policy, or unavailable in this format).
              </p>
            )}
          </Section>

          <Section title="Source reference">
            <KV label="File" value={row.sourceFile ?? '—'} mono wrap />
            <KV label="Line" value={row.sourceLine != null ? String(row.sourceLine) : '—'} mono />
          </Section>

          <Section title="Raw normalised metadata">
            <pre className="mono max-h-48 overflow-auto rounded border border-hair bg-black/30 p-2 text-[10px] leading-relaxed text-ink2">
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </Section>
        </div>
      </motion.aside>
      </AnimatePresence>
    </Portal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="label-xs mb-1.5 border-b border-hair pb-1">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function KV({
  label,
  value,
  mono,
  wrap,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className={cn('flex gap-3 text-[11px]', wrap ? 'flex-col' : 'items-baseline justify-between')}>
      <span className="shrink-0 text-ink3">{label}</span>
      <span className={cn('text-ink2', mono && 'mono', wrap ? 'break-all' : 'truncate text-right')}>{value}</span>
    </div>
  );
}
