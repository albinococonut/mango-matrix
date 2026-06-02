// Re-run Google Business Profile location discovery using the already-saved
// OAuth tokens. Exec-only. Used by the "Refresh locations" button on
// /admin/gbp so the admin can retry without going through OAuth again when
// the initial discovery is throttled by per-minute quota (very common on
// freshly approved My Business API projects).
//
// Accepts both GET (form action) and POST so we can render a simple <form>
// in the admin page without needing client-side JS.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifyRoleCookie } from '@/lib/auth';
import { runDiscovery } from '@/lib/gbpDiscovery';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const role = await verifyRoleCookie(cookies().get(COOKIE_NAME)?.value);
  if (role !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const back = (qs: string) => NextResponse.redirect(new URL(`/admin/gbp?${qs}`, req.url));
  try {
    const snapshot = await runDiscovery();
    return back(`refreshed=1&n=${snapshot.accounts.length}`);
  } catch (e: any) {
    return back(`discover_err=${encodeURIComponent(e?.message || 'discovery_failed')}`);
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
