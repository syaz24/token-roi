'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FolderTree, Info, Sparkles, X } from 'lucide-react';
import { Badge, Button, Empty, Panel, cn } from './ui';
import { applyProjectProposals, getProjectProposals } from '@/app/actions';
import type { ProjectProposal } from '@/lib/projects/wizard';
import { compactNumber, money, shortDate, truncateMid } from '@/lib/format';

/**
 * Proposes projects from the folders your indexed sessions actually ran in, so
 * a fresh install does not require registering every folder by hand.
 *
 * Nothing is created until you press the button, and every proposal is shown —
 * including the ones pre-unticked — so the roll-up is auditable rather than
 * magic.
 */
export function ProjectWizard({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [proposals, setProposals] = React.useState<ProjectProposal[] | null>(null);
  const [picked, setPicked] = React.useState<Record<string, boolean>>({});
  const [msg, setMsg] = React.useState<{ ok: boolean; message: string } | null>(null);

  async function load() {
    setOpen(true);
    setLoading(true);
    setMsg(null);
    try {
      const list = await getProjectProposals();
      setProposals(list);
      // Skipped proposals start unticked, but stay visible and selectable.
      setPicked(Object.fromEntries(list.map((p) => [p.pathNorm, !p.skip])));
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!proposals) return;
    setBusy(true);
    try {
      const chosen = proposals.map((p) => ({ ...p, skip: !picked[p.pathNorm] }));
      const r = await applyProjectProposals(chosen);
      setMsg(r);
      if (r.ok) {
        router.refresh();
        onDone?.();
        setTimeout(() => setOpen(false), 1200);
      }
    } finally {
      setBusy(false);
    }
  }

  const selected = proposals?.filter((p) => picked[p.pathNorm]) ?? [];

  if (!open) {
    return (
      <Button variant="primary" onClick={load}>
        <Sparkles size={11} />
        Detect projects
      </Button>
    );
  }

  return (
    <Panel
      title="Detected projects"
      subtitle="Built from the folders your indexed sessions actually ran in"
      className="mt-2.5"
      right={
        <Button variant="ghost" onClick={() => setOpen(false)} aria-label="Close wizard">
          <X size={12} />
        </Button>
      }
      bodyClassName="p-0"
    >
      <div className="flex items-start gap-2 border-b border-hair bg-info/[0.05] px-3.5 py-2.5">
        <Info size={12} className="mt-0.5 shrink-0 text-info" />
        <p className="text-[10.5px] leading-relaxed text-ink2">
          Subfolders are rolled up to their project root, so a worktree at{' '}
          <span className="mono">…\.claude\worktrees\x</span> or a package at{' '}
          <span className="mono">…\packages\api</span> counts toward the project itself. Scratch and temp
          locations are grouped into a single <span className="text-ink">Miscellaneous</span> project, since
          they are shared rather than belonging to any one piece of work. Nothing is created until you press
          Create.
        </p>
      </div>

      {loading && <div className="p-6 text-center text-[11px] text-ink3">Scanning indexed directories…</div>}

      {!loading && proposals && proposals.length === 0 && (
        <Empty
          title="Every indexed directory already belongs to a project."
          hint="Nothing left to detect. Add folders manually if you work somewhere that has no history yet."
        />
      )}

      {!loading && proposals && proposals.length > 0 && (
        <>
          <div className="max-h-[440px] overflow-auto">
            <table className="w-full min-w-[720px] text-[11px]">
              <thead className="sticky top-0 bg-[rgba(17,17,23,0.98)]">
                <tr className="border-b border-hair text-left">
                  <th className="w-8 px-3.5 py-1.5" />
                  <th className="label-xs px-2 py-1.5 font-medium">Project</th>
                  <th className="label-xs px-2 py-1.5 text-right font-medium">Tokens</th>
                  <th className="label-xs px-2 py-1.5 text-right font-medium">Cost</th>
                  <th className="label-xs px-2 py-1.5 font-medium">Active</th>
                  <th className="label-xs px-3.5 py-1.5 font-medium">Sources</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {proposals.map((p) => (
                  <tr key={p.pathNorm} className={cn('align-top', !picked[p.pathNorm] && 'opacity-55')}>
                    <td className="px-3.5 py-2">
                      <input
                        type="checkbox"
                        checked={!!picked[p.pathNorm]}
                        onChange={(e) => setPicked((s) => ({ ...s, [p.pathNorm]: e.target.checked }))}
                        className="h-3 w-3 accent-[#A78BFA]"
                        aria-label={`Create ${p.name}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-ink">{p.name}</span>
                        {p.isMisc && <Badge tone="info">shared</Badge>}
                        {p.skip && <Badge tone="warn">review</Badge>}
                      </div>
                      <div className="mono mt-0.5 truncate text-[10px] text-ink3" title={p.path}>
                        {truncateMid(p.path, 58)}
                      </div>
                      {p.reason && <div className="mt-0.5 text-[10px] text-warn">{p.reason}</div>}
                    </td>
                    <td className="num px-2 py-2 text-right text-ink">{compactNumber(p.tokens)}</td>
                    <td className="num px-2 py-2 text-right text-ink2">{money(p.cost)}</td>
                    <td className="mono px-2 py-2 text-[10px] text-ink3">
                      {shortDate(p.firstSeen)} → {shortDate(p.lastSeen)}
                    </td>
                    <td className="px-3.5 py-2 text-[10px] text-ink3">{p.sources.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hair p-2.5">
            <span className="text-[10.5px] text-ink3">
              <FolderTree size={10} className="mr-1 inline" />
              {selected.length} of {proposals.length} selected ·{' '}
              {compactNumber(selected.reduce((s, p) => s + p.tokens, 0))} tokens will be attributed
            </span>
            <div className="flex items-center gap-1.5">
              {msg && (
                <span className={cn('text-[10.5px]', msg.ok ? 'text-pos' : 'text-neg')}>{msg.message}</span>
              )}
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy || !selected.length} onClick={apply}>
                {busy ? 'Creating…' : `Create ${selected.length} project${selected.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
