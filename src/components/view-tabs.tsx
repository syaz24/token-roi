'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from './ui';

/** Small segmented control that drives a single URL search param. */
export function ViewTabs({
  param,
  current,
  options,
}: {
  param: string;
  current: string;
  options: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-hair p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => {
            const next = new URLSearchParams(sp.toString());
            next.set(param, o.value);
            next.delete('cursor'); // paging is per-view
            router.push(`${pathname}?${next.toString()}`);
          }}
          className={cn(
            'rounded px-2 py-1 text-[10.5px] font-medium transition-colors',
            current === o.value ? 'bg-white/[0.09] text-ink' : 'text-ink3 hover:text-ink2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
