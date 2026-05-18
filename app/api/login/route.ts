// Login + logout, both POST to keep us under Hobby's 12-function cap.
//   POST {password}              → validate, sign role cookie, set
//   POST {logout: true}          → clear cookie
//
// Generic error on wrong password. Passwords compared server-side against env
// vars only — never shipped to the client.

import { NextResponse } from 'next/server';
import { COOKIE_NAME, roleForPassword, signRoleCookie } from '@/lib/auth';

export const runtime = 'edge';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.logout) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
    return res;
  }
  const role = roleForPassword(String(body?.password || ''));
  if (!role) {
    return NextResponse.json({ ok: false, error: 'Incorrect password' }, { status: 401 });
  }
  const { value, maxAge } = await signRoleCookie(role);
  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  });
  return res;
}
