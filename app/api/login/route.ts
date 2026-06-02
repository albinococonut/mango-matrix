// Logout endpoint (legacy path name — kept as /api/login because the
// existing Sign Out buttons in EmployeeShell / ExecShell / ExecSidebar
// all POST here with {logout: true}).
//
// Shared-password sign-in has been retired in favor of Google OAuth
// (/api/auth/google/start → /api/auth/google/callback). A password POST
// here returns 410 Gone with a pointer to the Google flow.

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

export const runtime = 'edge';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.logout) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
    return res;
  }
  return NextResponse.json(
    { ok: false, error: 'Password sign-in has been retired. Use Sign in with Google at /login.' },
    { status: 410 },
  );
}
