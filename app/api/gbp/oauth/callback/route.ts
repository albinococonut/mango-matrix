// OAuth callback. Google redirects here with ?code=... &state=...
//
// We verify the state cookie matches (CSRF guard), exchange the code for
// tokens, persist them in KV, then call /accounts + /locations once to
// stash a snapshot of what Google sees so /admin/gbp can show it without
// making API calls on every page load. Finally redirect the admin back to
// /admin/gbp with a success/error query param.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifyRoleCookie } from '@/lib/auth';
import { exchangeCodeForTokens, persistFreshTokens } from '@/lib/gbpAuth';
import { runDiscovery } from '@/lib/gbpDiscovery';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const STATE_COOKIE = 'gbp_oauth_state';

export async function GET(req: NextRequest) {
  const session = cookies().get(COOKIE_NAME)?.value;
  const role = await verifyRoleCookie(session);
  if (role !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const stateCookie = cookies().get(STATE_COOKIE)?.value;
  const back = (qs: string) => NextResponse.redirect(new URL(`/admin/gbp?${qs}`, req.url));

  if (error) return back(`error=${encodeURIComponent(error)}`);
  if (!code || !state) return back('error=missing_code_or_state');
  if (!stateCookie || stateCookie !== state) return back('error=state_mismatch');

  try {
    const tokens = await exchangeCodeForTokens(code);
    await persistFreshTokens(tokens);
    // Best-effort discovery — failure here doesn't roll back the token save;
    // the admin can retry from /admin/gbp via the Refresh button. Surface
    // the error so they know what went wrong.
    let discoveryError: string | undefined;
    try {
      await runDiscovery();
    } catch (e: any) {
      discoveryError = e?.message || String(e);
    }
    const res = back(discoveryError ? `connected=1&discover_err=${encodeURIComponent(discoveryError)}` : 'connected=1');
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (e: any) {
    return back(`error=${encodeURIComponent(e?.message || 'exchange_failed')}`);
  }
}
