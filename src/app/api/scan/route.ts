import { NextResponse } from 'next/server';
import { ADAPTERS } from '@/lib/adapters/registry';
import { cancelScan, runScan } from '@/lib/scan/engine';
import { bootstrap } from '@/lib/bootstrap';
import { raw } from '@/db/client';

export const dynamic = 'force-dynamic';

/** POST /api/scan  { source?: string }  — scans one source, or all enabled+verified ones. */
export async function POST(req: Request) {
  bootstrap();
  let body: { source?: string; cancel?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  if (body.cancel) {
    return NextResponse.json({ cancelled: cancelScan(body.cancel) });
  }

  const enabled = new Set(
    (raw().prepare(`SELECT id FROM sources WHERE enabled = 1`).all() as any[]).map((r) => r.id as string),
  );

  const targets: string[] = [];
  if (body.source) {
    targets.push(body.source);
  } else {
    for (const a of ADAPTERS) {
      // Only scan sources the user explicitly enabled, or that are verified and
      // not explicitly disabled. Nothing is ever scanned without local presence.
      const det = await a.detect();
      if (det.status !== 'verified') continue;
      if (a.id.startsWith('generic-') && !enabled.has(a.id)) continue;
      targets.push(a.id);
    }
  }

  const reports = [];
  for (const id of targets) reports.push(await runScan(id));

  return NextResponse.json({
    reports,
    totals: {
      added: reports.reduce((s, r) => s + r.recordsAdded, 0),
      files: reports.reduce((s, r) => s + r.filesScanned, 0),
      errors: reports.reduce((s, r) => s + r.errors.length, 0),
    },
  });
}
