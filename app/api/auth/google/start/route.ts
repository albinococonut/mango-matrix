// Begin Google OAuth sign-in flow for the dashboard.
//
// Sets a signed state cookie + ?next= cookie, then redirects to Google's
// consent screen. The `hd=mangoautomotive.com` hint asks Google to pre-
// filter the account chooser to that workspace — but it's only a HINT,
// not a security boundary. The real domain check happens server-side in
// /api/auth/google/callback by inspecting the returned id_token email.

import { NextRequest, NextResponse } from 'next/server';
import { ALLOWED_DOMAIN } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = ['openid', 'email', 'profile'];
const STATE_COOKIE = 'auth_google_state';
const NEXT_COOKIE = 'auth_google_next';

function getRedirectUri(req: NextRequest): string {
  if (process.env.GOOGLE_AUTH_REDIRECT_URI) return process.env.GOOGLE_AUTH_REDIRECT_URI;
  return `${new URL(req.url).origin}/api/auth/google/callback`;
}

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_AUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'GOOGLE_AUTH_CLIENT_ID not configured' }, { status: 500 });
  }
  const url = new URL(req.url);
  const next = url.searchParams.get('next') || '/';
  const state = randomState();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(req),
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    // Pre-filters Google's account chooser to our Workspace. Pure UX hint
    // — the callback still verifies the returned email's domain.
    hd: ALLOWED_DOMAIN,
    prompt: 'select_account',
    access_type: 'online',  // we don't need a refresh_token for auth
    include_granted_scopes: 'true',
  });
  const res = NextResponse.redirect(`${AUTH_BASE}?${params}`);
  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/api/auth', maxAge: 600 };
  res.cookies.set(STATE_COOKIE, state, cookieOpts);
  res.cookies.set(NEXT_COOKIE, next, cookieOpts);
  return res;
}
