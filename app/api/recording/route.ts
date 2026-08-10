// Proxy endpoint: fetches a RingCentral call recording server-side (using
// JWT Bearer auth) and streams the audio back to the browser.
// RingCentral contentUri requires a Bearer token that can't be embedded
// in a browser <audio> src directly.
//
// GET /api/recording?leadId=<n>&shop=<shopNum>

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { readCache } from '@/lib/cache';
import { MISSED_CALLBACKS_KEY, type MissedCallbacksShopCache } from '@/lib/handlers/missedCallbacks';
import { SE_GRADE_CACHE_KEY, type SalesGrade } from '@/lib/salesEffectiveness';
import { CR_URIS_KEY } from '@/lib/handlers/callRecordings';
import { getRCToken } from '@/lib/ringcentral';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  // SE mode: ?callId=<rcCallId>
  const seCallId = req.nextUrl.searchParams.get('callId');
  if (seCallId) {
    const grade = await readCache<SalesGrade>(SE_GRADE_CACHE_KEY(seCallId));
    if (!grade?.contentUri) return new NextResponse('No recording for this call', { status: 404 });

    let rcToken: string;
    try { rcToken = await getRCToken(); } catch {
      return new NextResponse('RingCentral not configured', { status: 503 });
    }
    const up = await fetch(grade.contentUri, { headers: { Authorization: `Bearer ${rcToken}` }, cache: 'no-store' }).catch(() => null);
    if (!up?.ok) return new NextResponse('Upstream fetch failed', { status: 502 });
    const h = new Headers();
    h.set('Content-Type', up.headers.get('Content-Type') || 'audio/mpeg');
    h.set('Cache-Control', 'private, max-age=3600');
    const cl = up.headers.get('Content-Length');
    if (cl) h.set('Content-Length', cl);
    return new NextResponse(up.body, { status: 200, headers: h });
  }

  // Call Recordings mode: ?rcId=<callId>&shop=<shopNum>
  const rcId = req.nextUrl.searchParams.get('rcId');
  const rcShop = req.nextUrl.searchParams.get('shop');
  if (rcId && rcShop) {
    const uris = await readCache<Record<string, string>>(CR_URIS_KEY(rcShop));
    const uri = uris?.[rcId];
    if (!uri) return new NextResponse('No recording for this call', { status: 404 });

    let rcToken: string;
    try { rcToken = await getRCToken(); } catch {
      return new NextResponse('RingCentral not configured', { status: 503 });
    }
    const up = await fetch(uri, { headers: { Authorization: `Bearer ${rcToken}` }, cache: 'no-store' }).catch(() => null);
    if (!up?.ok) return new NextResponse('Upstream fetch failed', { status: 502 });
    const h = new Headers();
    h.set('Content-Type', up.headers.get('Content-Type') || 'audio/mpeg');
    h.set('Cache-Control', 'private, max-age=3600');
    const cl = up.headers.get('Content-Length');
    if (cl) h.set('Content-Length', cl);
    return new NextResponse(up.body, { status: 200, headers: h });
  }

  const leadId = parseInt(req.nextUrl.searchParams.get('leadId') || '', 10);
  const shop = req.nextUrl.searchParams.get('shop') || '';
  if (!Number.isFinite(leadId) || !shop) {
    return new NextResponse('Missing leadId or shop', { status: 400 });
  }

  const cached = await readCache<MissedCallbacksShopCache>(MISSED_CALLBACKS_KEY(shop));
  if (!cached) return new NextResponse('Shop cache not found', { status: 404 });

  const call = cached.calls.find(c => c.leadId === leadId);
  if (!call?.recording) return new NextResponse('No recording URL for this lead', { status: 404 });

  let rcToken: string;
  try {
    rcToken = await getRCToken();
  } catch (e: any) {
    console.error('[recording] RC token fetch failed:', e);
    return new NextResponse('RingCentral not configured', { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(call.recording, {
      headers: { Authorization: `Bearer ${rcToken}` },
      cache: 'no-store',
    });
  } catch (e: any) {
    console.error('[recording] upstream fetch failed:', e);
    return new NextResponse('Upstream fetch failed', { status: 502 });
  }

  if (!upstream.ok) {
    return new NextResponse(`RingCentral returned ${upstream.status}`, { status: 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'audio/mpeg');
  headers.set('Cache-Control', 'private, max-age=3600');
  const cl = upstream.headers.get('Content-Length');
  if (cl) headers.set('Content-Length', cl);

  return new NextResponse(upstream.body, { status: 200, headers });
}
