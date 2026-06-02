// Gate every non-public path on a valid signed role cookie. Verifies the HMAC
// — clients cannot forge a role by editing the cookie. Page + API routes
// re-derive role from this same cookie and enforce per-feature visibility.
//
// Edge-runtime safe: no Buffer, no __dirname, only imports from next/server
// and lib/auth (which uses Web Crypto SubtleCrypto + btoa).

import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, verifyRoleCookie } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/login') ||
    // Sign-in flow itself must be reachable without a session, otherwise
    // unauthenticated users get bounced back to /login in a loop the
    // moment they click Sign in with Google.
    pathname.startsWith('/api/auth/google') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/login') ||
    // The original standalone concept page uses representative data only (no
    // real metrics), so it's public. NOTE the trailing slash: this must NOT
    // match /concept2, which renders the REAL Dashboard with live exec data and
    // therefore stays auth-gated like every other diagnostic page.
    pathname.startsWith('/concept/') ||
    pathname.startsWith('/shop-photos') ||
    pathname.startsWith('/favicon') ||
    pathname === '/favicon.png' ||
    pathname === '/apple-touch-icon.png' ||
    pathname === '/logo.png'
  ) {
    return NextResponse.next();
  }
  const role = await verifyRoleCookie(req.cookies.get(COOKIE_NAME)?.value);
  if (!role) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
