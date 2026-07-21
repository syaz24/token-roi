'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, X } from 'lucide-react';
import { Button } from './ui';
import { dismissFirstRunNotice } from '@/app/actions';

/**
 * Shown once, on first launch, because indexing happens automatically. Users
 * should be told what was read before they discover it — not after.
 */
export function FirstRunNotice() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function dismiss() {
    setBusy(true);
    try {
      await dismissFirstRunNotice();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 pt-3 sm:px-4">
      <div className="panel panel-dotted flex flex-wrap items-start gap-3 border-info/25 bg-info/[0.06] p-3">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-info" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-ink">
            Your local AI history was indexed automatically.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink2">
            Project Token ROI read the session files of the AI coding tools already installed on this
            machine — Claude Code, Codex CLI and Gemini CLI — to count tokens and calculate costs. Those files
            were opened <span className="text-ink">read-only</span> and were not modified. Nothing was sent
            anywhere: there is no account, no telemetry and no network call. Everything stays in a local SQLite
            database.
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink3">
            You can turn automatic indexing off, or delete everything indexed, in{' '}
            <Link href="/settings?tab=Scanning" className="text-info hover:underline">
              Settings › Scanning
            </Link>
            . See what was read on the{' '}
            <Link href="/sources" className="text-info hover:underline">
              Data Sources
            </Link>{' '}
            page.
          </p>
        </div>
        <Button variant="ghost" onClick={dismiss} disabled={busy} aria-label="Dismiss" className="shrink-0">
          <X size={12} />
        </Button>
      </div>
    </div>
  );
}
