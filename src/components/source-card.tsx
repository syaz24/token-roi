'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, CircleSlash, RefreshCw, Trash2 } from 'lucide-react';
import { Badge, Button, Panel, SegmentBar } from './ui';
import { clearSourceData, scanSource, toggleSource } from '@/app/actions';
import { fullNumber, shortDate } from '@/lib/format';

export function SourceCard(props: {
  id: string;
  name: string;
  verifiedNote: string;
  status: string;
  rootPath: string | null;
  reason?: string;
  fileCount: number | null;
  recordsIndexed: number;
  earliest: string | null;
  latest: string | null;
  lastScan: string | null;
  enabled: boolean;
  fields: string[];
  missing: string[];
  percentage: number;
  caveats: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);

  const verified = props.status === 'verified';

  async function run(kind: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(kind);
    setMsg(null);
    try {
      setMsg(await fn());
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title={props.name}
      subtitle={props.rootPath ?? 'no location detected'}
      right={
        verified ? (
          <Badge tone="pos">
            <CheckCircle2 size={9} /> verified
          </Badge>
        ) : props.status === 'detected-unverified' ? (
          <Badge tone="warn">
            <AlertTriangle size={9} /> unverified
          </Badge>
        ) : (
          <Badge>
            <CircleSlash size={9} /> {props.status}
          </Badge>
        )
      }
    >
      <p className="text-[10.5px] leading-relaxed text-ink3">{props.verifiedNote}</p>
      {props.reason && <p className="mt-1 text-[10.5px] text-warn">{props.reason}</p>}

      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <Row label="Files present" value={props.fileCount != null ? fullNumber(props.fileCount) : '—'} />
        <Row label="Records indexed" value={fullNumber(props.recordsIndexed)} />
        <Row label="Earliest event" value={shortDate(props.earliest)} />
        <Row label="Latest event" value={shortDate(props.latest)} />
        <Row label="Last scan" value={shortDate(props.lastScan)} />
        <Row label="Adapter status" value={props.status} />
      </dl>

      <div className="mt-2.5">
        <div className="flex items-baseline justify-between">
          <span className="label-xs">Field completeness</span>
          <span className="num text-[11px] text-ink2">{props.percentage}%</span>
        </div>
        <SegmentBar
          className="mt-1"
          segments={[
            { value: props.percentage, color: 'var(--pos)', label: 'available' },
            { value: 100 - props.percentage, color: 'rgba(255,255,255,0.06)', label: 'not in this format' },
          ]}
        />
        <div className="mt-1.5 flex flex-wrap gap-1">
          {props.fields.slice(0, 8).map((f) => (
            <span key={f} className="rounded border border-hair px-1 py-px text-[9.5px] text-ink3">
              {f}
            </span>
          ))}
          {props.missing.length > 0 && (
            <span className="rounded border border-warn/25 bg-warn/10 px-1 py-px text-[9.5px] text-warn">
              {props.missing.length} fields not in this format
            </span>
          )}
        </div>
      </div>

      {props.caveats.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {props.caveats.map((c, i) => (
            <li key={i} className="flex gap-1.5 text-[10px] leading-relaxed text-ink3">
              <span className="text-warn">•</span>
              {c}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button
          variant="primary"
          disabled={!verified || busy != null}
          onClick={() => run('scan', () => scanSource(props.id))}
          title={verified ? 'Scan incrementally' : 'This source has not been verified locally'}
        >
          <RefreshCw size={10} className={busy === 'scan' ? 'animate-spin' : ''} />
          {busy === 'scan' ? 'Scanning…' : 'Rescan'}
        </Button>

        <Button
          disabled={busy != null}
          onClick={() => run('toggle', () => toggleSource(props.id, !props.enabled))}
        >
          {props.enabled ? 'Disable' : 'Enable'}
        </Button>

        {confirmClear ? (
          <>
            <Button
              variant="danger"
              disabled={busy != null}
              onClick={() =>
                run('clear', async () => {
                  const r = await clearSourceData(props.id);
                  setConfirmClear(false);
                  return r;
                })
              }
            >
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="danger" disabled={busy != null || !props.recordsIndexed} onClick={() => setConfirmClear(true)}>
            <Trash2 size={10} />
            Remove records
          </Button>
        )}
      </div>

      {msg && <p className={`mt-2 text-[10.5px] ${msg.ok ? 'text-pos' : 'text-warn'}`}>{msg.message}</p>}
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink3">{label}</dt>
      <dd className="num truncate text-ink2">{value}</dd>
    </div>
  );
}
