// Presence for the To Do page.
//
// POST body: { action: 'heartbeat' | 'leave', shopNum?: string }
//   - heartbeat: refresh this user's presence, return active-user list
//   - leave:     remove this user's entry immediately (fired by the
//                client on visibilitychange→hidden via sendBeacon)
//
// Auth: derived from the signed session cookie. No email = no presence.
// Anonymous heartbeats are silently ignored (200 with empty list) so a
// password-fallback session doesn't 401 a polling client.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { SHOP_BY_NUM } from '@/lib/shops';
import { heartbeat, leave, readPresence } from '@/lib/todoPresence';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const email = session.email;

  let body: any = {};
  try { body = await req.json(); } catch {}
  // sendBeacon can also send text/plain; try parsing whatever came in.
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const action = String(body?.action || 'heartbeat');

  // Password-fallback sessions don't carry an email; just return the
  // current list without recording a presence entry.
  if (!email) {
    const active = await readPresence();
    return NextResponse.json({ active });
  }

  if (action === 'leave') {
    await leave(email);
    return NextResponse.json({ ok: true });
  }

  // heartbeat
  const shopNum = String(body?.shopNum || '').trim();
  if (!SHOP_BY_NUM[shopNum as keyof typeof SHOP_BY_NUM]) {
    // Shop is required but unknown — still return the list so the client
    // gets up-to-date presence; just don't record this user's entry.
    const active = await readPresence();
    return NextResponse.json({ active });
  }
  const active = await heartbeat(email, shopNum);
  return NextResponse.json({ active });
}
