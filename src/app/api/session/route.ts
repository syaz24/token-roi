import { NextResponse } from 'next/server';
import { sessionMeta, sessionTurns, type Dataset } from '@/lib/queries';
import { getSetting } from '@/lib/settings';
import { bootstrap } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

/** GET /api/session?id=<sessionId> — turn-by-turn breakdown for one conversation. */
export async function GET(req: Request) {
  bootstrap();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing session id' }, { status: 400 });

  const dataset = (getSetting('dataset') ?? 'real') as Dataset;
  const meta = sessionMeta(dataset, id);
  if (!meta) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  return NextResponse.json({ session: meta, turns: sessionTurns(dataset, id) });
}
