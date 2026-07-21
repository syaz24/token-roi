'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Lightbulb } from 'lucide-react';
import { Empty, Panel, cn } from './ui';
import type { Insight } from '@/lib/insights/engine';

const ICONS = {
  positive: { Icon: CheckCircle2, tone: 'text-pos', ring: 'bg-pos/10 border-pos/25' },
  negative: { Icon: AlertTriangle, tone: 'text-neg', ring: 'bg-neg/10 border-neg/25' },
  warning: { Icon: AlertTriangle, tone: 'text-warn', ring: 'bg-warn/10 border-warn/25' },
  info: { Icon: Lightbulb, tone: 'text-info', ring: 'bg-info/10 border-info/25' },
} as const;

export function InsightsList({ insights }: { insights: Insight[] }) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  return (
    <Panel
      title="Insights"
      subtitle={`${insights.length} pattern${insights.length === 1 ? '' : 's'} found in your usage`}
      bodyClassName="p-0"
    >
      {insights.length === 0 ? (
        <Empty
          title="No patterns met their evidence threshold."
          hint="Each rule needs a minimum number of samples before it will make a claim. Widen the date range and check again."
        />
      ) : (
        <ul className="divide-y divide-hair">
          {insights.map((i) => {
            const { Icon, tone, ring } = ICONS[i.tone] ?? ICONS.info;
            const isOpen = !!open[i.id];
            return (
              <li key={i.id}>
                <button
                  onClick={() => setOpen((s) => ({ ...s, [i.id]: !s[i.id] }))}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <span className={cn('mt-px shrink-0 rounded-md border p-1', ring)}>
                    <Icon size={11} className={tone} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium leading-snug text-ink">{i.title}</span>
                    {!isOpen && (
                      <span className="mt-0.5 line-clamp-1 block text-[10.5px] text-ink3">{i.detail}</span>
                    )}
                  </span>
                  <ChevronDown
                    size={12}
                    className={cn('mt-0.5 shrink-0 text-ink3 transition-transform', isOpen && 'rotate-180')}
                  />
                </button>

                {isOpen && (
                  <div className="animate-[panel-rise_180ms_cubic-bezier(0.22,1,0.36,1)_both] px-3.5 pb-3 pl-[46px]">
                    <p className="text-[11px] leading-relaxed text-ink2">{i.detail}</p>
                    {i.evidence && i.evidence.length > 0 && (
                      <ul className="mt-2 space-y-0.5 border-l border-hair pl-2.5">
                        {i.evidence.map((e, n) => (
                          <li key={n} className="text-[10.5px] leading-relaxed text-ink3">
                            {e}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="border-t border-hair px-3.5 py-2 text-[10px] leading-relaxed text-ink3">
        <Info size={9} className="mr-1 inline" />
        Each insight is produced by a fixed rule with a minimum evidence threshold, so the same data always
        gives the same result. Rules that lack enough samples stay silent rather than guessing.
      </p>
    </Panel>
  );
}
