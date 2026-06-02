// Google OAuth callback for dashboard sign-in.
//
// Verifies the state cookie matches (CSRF guard), exchanges the auth code
// for tokens, decodes the id_token's email claim, hard-rejects any email
// not under @mangoautomotive.com (server-side check; the hd= hint sent at
// /start is just UX), then signs a 30-day session cookie carrying role +
// email and redirects to the original ?next= target.

import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, isAllowedDomain, roleForEmail, signSessionCookie, ALLOWED_DOMAIN } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const TOKEN_BASE = 'https://oauth2.googleapis.com/token';
const STATE_COOKIE = 'auth_google_state';
const NEXT_COOKIE = 'auth_google_next';

function getRedirectUri(): string {
  if (process.env.GOOGLE_AUTH_REDIRECT_URI) return process.env.GOOGLE_AUTH_REDIRECT_URI;
  return 'https://mango-matrix.vercel.app/api/auth/google/callback';
}

/**
 * Decode the email claim from a Google id_token. We trust Google's signature
 * because we obtained the token via a server-to-server code exchange — no
 * untrusted client touched it. Verifying JWT signatures here would require
 * pulling Google's JWKS, which adds latency for no real security gain.
 */
function decodeEmail(idToken?: string): { email?: string; verified?: boolean } {
  if (!idToken) return {};
  const parts = idToken.split('.');
  if (parts.length !== 3) return {};
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parts[1].length + 3) % 4);
    const bin = atob(padded);
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    return {
      email: typeof json.email === 'string' ? json.email : undefined,
      verified: json.email_verified === true || json.email_verified === 'true',
    };
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error');

  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;
  const next = req.cookies.get(NEXT_COOKIE)?.value || '/';

  const back = (qs: string) => {
    const r = NextResponse.redirect(new URL(`/login?${qs}`, req.url));
    // Clear the short-lived OAuth cookies on every exit (success or error).
    r.cookies.delete(STATE_COOKIE);
    r.cookies.delete(NEXT_COOKIE);
    return r;
  };

  if (oauthErr) return back(`error=${encodeURIComponent(oauthErr)}`);
  if (!code || !state) return back('error=missing_code_or_state');
  if (!stateCookie || stateCookie !== state) return back('error=state_mismatch');

  const clientId = process.env.GOOGLE_AUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return back('error=not_configured');

  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
    });
    const tokRes = await fetch(TOKEN_BASE, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!tokRes.ok) {
      return back(`error=token_exchange_failed`);
    }
    const tokens = await tokRes.json() as { id_token?: string };
    const { email, verified } = decodeEmail(tokens.id_token);
    if (!email) return back('error=no_email_in_token');
    if (verified === false) return back('error=email_not_verified');
    if (!isAllowedDomain(email)) {
      return back(`error=domain&attempted=${encodeURIComponent(email)}`);
    }

    const role = roleForEmail(email);
    const { value, maxAge } = await signSessionCookie(role, email);

    // Redirect to the original landing target (default /). Whitelist to
    // same-origin paths to prevent open-redirect via the next cookie.
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    const res = NextResponse.redirect(new URL(safeNext, req.url));
    res.cookies.set(COOKIE_NAME, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge,
    });
    res.cookies.delete(STATE_COOKIE);
    res.cookies.delete(NEXT_COOKIE);
    return res;
  } catch (e: any) {
    return back(`error=${encodeURIComponent(e?.message || 'callback_failed')}`);
  }
}

// Silence unused warning for the constant — it's documented in the file
// header and exported by lib/auth, but we want it visible here too in case
// someone re-reads only this file.
void ALLOWED_DOMAIN;
