'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from './ui';

export function ProjectTabs({ tabs, current }: { tabs: string[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  return (
    <div className="panel flex gap-0.5 overflow-x-auto p-1">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => {
            const next = new URLSearchParams(sp.toString());
            next.set('tab', t);
            router.push(`${pathname}?${next.toString()}`);
          }}
          className={cn(
            'whitespace-nowrap rounded px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            current === t ? 'bg-white/[0.09] text-ink' : 'text-ink3 hover:bg-white/[0.04] hover:text-ink2',
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
