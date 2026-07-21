'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Empty, Select } from './ui';
import { assignSessionToProject } from '@/app/actions';
import { compactNumber, money, shortDate, truncateMid } from '@/lib/format';

export interface Orphan {
  sessionId: string;
  workingDirectory: string | null;
  source: string;
  events: number;
  tokens: number;
  cost: number;
  firstSeen: string;
  lastSeen: string;
}

export function UnassignedList({
  sessions,
  projects,
}: {
  sessions: Orphan[];
  projects: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [choice, setChoice] = React.useState<Record<string, string>>({});
  const [remember, setRemember] = React.useState(true);

  if (!sessions.length) {
    return <Empty title="Every indexed session maps to a registered project." />;
  }
  if (!projects.length) {
    return <Empty title="Register a project first, then you can assign these sessions to it." />;
  }

  async function assign(sessionId: string) {
    const projectId = choice[sessionId];
    if (!projectId) return;
    setPending(sessionId);
    try {
      await assignSessionToProject(sessionId, projectId, remember);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <label className="mb-2 flex items-center gap-1.5 text-[11px] text-ink2">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-3 w-3 accent-[#A78BFA]"
        />
        Remember this folder mapping for future scans
      </label>

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[760px] text-[11px]">
          <thead className="sticky top-0 bg-[rgba(17,17,23,0.98)]">
            <tr className="border-b border-hair text-left">
              <th className="label-xs py-1.5 pr-2 font-medium">Working directory</th>
              <th className="label-xs px-2 py-1.5 font-medium">Source</th>
              <th className="label-xs px-2 py-1.5 text-right font-medium">Tokens</th>
              <th className="label-xs px-2 py-1.5 text-right font-medium">Cost</th>
              <th className="label-xs px-2 py-1.5 font-medium">Last seen</th>
              <th className="label-xs px-2 py-1.5 font-medium">Assign to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hair">
            {sessions.map((s) => (
              <tr key={s.sessionId} className="hover:bg-white/[0.03]">
                <td className="mono max-w-[280px] truncate py-1.5 pr-2 text-ink2" title={s.workingDirectory ?? ''}>
                  {s.workingDirectory ? truncateMid(s.workingDirectory, 42) : <span className="text-ink3">not recorded</span>}
                  <div className="mono text-[10px] text-ink3">{truncateMid(s.sessionId, 22)}</div>
                </td>
                <td className="px-2 py-1.5 text-ink3">{s.source}</td>
                <td className="num px-2 py-1.5 text-right text-ink">{compactNumber(s.tokens)}</td>
                <td className="num px-2 py-1.5 text-right text-ink2">{money(s.cost)}</td>
                <td className="mono px-2 py-1.5 text-ink3">{shortDate(s.lastSeen)}</td>
                <td className="px-2 py-1.5">
                  <div className="flex gap-1">
                    <Select
                      value={choice[s.sessionId] ?? ''}
                      onChange={(e) => setChoice((c) => ({ ...c, [s.sessionId]: e.target.value }))}
                      className="max-w-[130px]"
                    >
                      <option value="">Choose…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="xs"
                      variant="primary"
                      disabled={!choice[s.sessionId] || pending === s.sessionId}
                      onClick={() => assign(s.sessionId)}
                    >
                      {pending === s.sessionId ? '…' : 'Assign'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
