// Manager actions on a declined-job row. Mirrors /api/rebook/[roId].
//
// POST body: { action: 'won' | 'not_salvageable' | 'reopen' | 'note' |
//              'log_attempt', note? }
// Actor is derived from the signed session cookie, not from request body.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import {
  readDeclinedJobResolution,
  writeDeclinedJobResolution,
  logDeclinedJobAttempt,
  type DeclinedJobStatus,
} from '@/lib/declinedJobStore';
import { recordRecovery, removeRecovery } from '@/lib/recoveredLedger';
import { SHOPS } from '@/lib/shops';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { jobId: string } }) {
  const jobId = parseInt(params.jobId, 10);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: 'jobId must be numeric' }, { status: 400 });
  }
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const resolvedBy = session.email;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = String(body.action || '');
  const note = body.note ? String(body.note).slice(0, 1000) : undefined;

  if (action === 'log_attempt') {
    const r = await logDeclinedJobAttempt(jobId, resolvedBy);
    return NextResponse.json({ ok: true, resolution: r });
  }

  let nextStatus: DeclinedJobStatus | null = null;
  if (action === 'won') nextStatus = 'won';
  else if (action === 'not_salvageable') nextStatus = 'not_salvageable';
  else if (action === 'reopen') nextStatus = 'open';
  else if (action === 'note') nextStatus = null;
  else return NextResponse.json({ error: `unknown action ${action}` }, { status: 400 });

  const existing = await readDeclinedJobResolution(jobId);
  const now = new Date().toISOString();
  await writeDeclinedJobResolution({
    jobId,
    status: nextStatus ?? existing?.status ?? 'open',
    note: note ?? existing?.note,
    resolvedBy: resolvedBy ?? existing?.resolvedBy,
    resolvedAt: nextStatus === 'won' || nextStatus === 'not_salvageable' ? now : existing?.resolvedAt,
    attemptCount: existing?.attemptCount,
    lastAttemptAt: existing?.lastAttemptAt,
    updatedAt: now,
  });

  // Durable "recovered this week" ledger (see callback route). 'won' records;
  // 'reopen'/'not_salvageable' removes. shopNum is client-supplied + validated.
  const shopNum = String(body.shopNum || '');
  if (SHOPS.some(s => s.num === shopNum)) {
    if (action === 'won') await recordRecovery(shopNum, 'dj', jobId);
    else if (action === 'reopen' || action === 'not_salvageable') await removeRecovery(shopNum, 'dj', jobId);
  }
  return NextResponse.json({ ok: true });
}
