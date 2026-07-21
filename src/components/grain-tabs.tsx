'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from './ui';

const GRAINS = ['hour', 'day', 'week', 'month'] as const;

export function GrainTabs({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-hair p-0.5">
      {GRAINS.map((g) => (
        <button
          key={g}
          onClick={() => {
            const next = new URLSearchParams(sp.toString());
            next.set('grain', g);
            router.push(`${pathname}?${next.toString()}`);
          }}
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium capitalize transition-colors',
            current === g ? 'bg-white/[0.09] text-ink' : 'text-ink3 hover:text-ink2',
          )}
        >
          {g}
        </button>
      ))}
    </div>
  );
}
