// Manager actions on a missed-callback row.
//
// POST body: { action: 'resolve' | 'not_salvageable' | 'reopen' | 'note' | 'log_attempt',
//              note?: string }
//
// Actor (`resolvedBy`) is derived server-side from the signed session
// cookie — clients can no longer spoof someone else by sending their own
// `resolvedBy` field. Untrusted body input on that field is ignored.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { readResolution, writeResolution, logAttempt, type CallbackStatus } from '@/lib/callbackStore';
import { recordRecovery, removeRecovery } from '@/lib/recoveredLedger';
import { SHOPS } from '@/lib/shops';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { leadId: string } }) {
  const leadId = parseInt(params.leadId, 10);
  if (!Number.isFinite(leadId)) {
    return NextResponse.json({ error: 'leadId must be numeric' }, { status: 400 });
  }
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const resolvedBy = session.email;        // undefined for legacy password sessions

  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = String(body.action || '');
  const note = body.note ? String(body.note).slice(0, 1000) : undefined;

  if (action === 'log_attempt') {
    const r = await logAttempt(leadId, resolvedBy);
    return NextResponse.json({ ok: true, resolution: r });
  }

  let nextStatus: CallbackStatus | null = null;
  if (action === 'resolve') nextStatus = 'resolved';
  else if (action === 'not_salvageable') nextStatus = 'not_salvageable';
  else if (action === 'reopen') nextStatus = 'open';
  else if (action === 'note') nextStatus = null;       // note-only update, status unchanged
  else return NextResponse.json({ error: `unknown action ${action}` }, { status: 400 });

  const existing = await readResolution(leadId);
  const now = new Date().toISOString();
  await writeResolution({
    leadId,
    status: nextStatus ?? existing?.status ?? 'open',
    note: note ?? existing?.note,
    // Stamp the actor on every write so reopen/note also record who did it.
    // Fall back to the prior actor only for sessions without an email.
    resolvedBy: resolvedBy ?? existing?.resolvedBy,
    resolvedAt: nextStatus === 'resolved' || nextStatus === 'not_salvageable' ? now : existing?.resolvedAt,
    attemptCount: existing?.attemptCount,
    lastAttemptAt: existing?.lastAttemptAt,
    updatedAt: now,
  });

  // Durable "recovered this week" ledger (independent of the rolling feed +
  // 12h auto-reopen). 'resolve' = a win → record; 'reopen'/'not_salvageable'
  // = no longer a win → remove. shopNum comes from the client and is validated.
  const shopNum = String(body.shopNum || '');
  if (SHOPS.some(s => s.num === shopNum)) {
    if (action === 'resolve') await recordRecovery(shopNum, 'cb', leadId);
    else if (action === 'reopen' || action === 'not_salvageable') await removeRecovery(shopNum, 'cb', leadId);
  }
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params }: { params: { leadId: string } }) {
  const leadId = parseInt(params.leadId, 10);
  if (!Number.isFinite(leadId)) return NextResponse.json({ error: 'leadId must be numeric' }, { status: 400 });
  const r = await readResolution(leadId);
  return NextResponse.json({ resolution: r });
}
