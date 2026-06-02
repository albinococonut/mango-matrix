// Begin Google Business Profile OAuth. Exec-only.
//
// Signs a short-lived state cookie (random nonce + admin role check) and
// redirects to Google's consent screen. The /callback route below verifies
// the state nonce matches before accepting any token exchange.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifyRoleCookie } from '@/lib/auth';
import { buildAuthorizeUrl } from '@/lib/gbpAuth';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'gbp_oauth_state';

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function GET(_req: NextRequest) {
  const session = cookies().get(COOKIE_NAME)?.value;
  const role = await verifyRoleCookie(session);
  if (role !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const state = randomState();
  const url = buildAuthorizeUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/gbp/oauth',
    maxAge: 600,    // 10 min
  });
  return res;
}
