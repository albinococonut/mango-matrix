// Proxy endpoint: fetches a WhatConverts call recording server-side (with
// Basic auth credentials) and streams the audio back to the browser.
// This is needed because WhatConverts recording URLs require authentication
// that can't be embedded in a browser <audio> src directly.
//
// GET /api/recording?leadId=<n>&shop=<shopNum>

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { readCache } from '@/lib/cache';
import { MISSED_CALLBACKS_KEY, type MissedCallbacksShopCache } from '@/lib/handlers/missedCallbacks';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  const leadId = parseInt(req.nextUrl.searchParams.get('leadId') || '', 10);
  const shop = req.nextUrl.searchParams.get('shop') || '';
  if (!Number.isFinite(leadId) || !shop) {
    return new NextResponse('Missing leadId or shop', { status: 400 });
  }

  const cached = await readCache<MissedCallbacksShopCache>(MISSED_CALLBACKS_KEY(shop));
  if (!cached) return new NextResponse('Shop cache not found', { status: 404 });

  const call = cached.calls.find(c => c.leadId === leadId);
  if (!call?.recording) return new NextResponse('No recording URL for this lead', { status: 404 });

  const creds = process.env[`WHATCONVERTS_${shop}`];
  if (!creds) return new NextResponse('WhatConverts not configured for this shop', { status: 503 });
  const [token, secret] = creds.split(':');
  const basic = Buffer.from(`${token}:${secret}`).toString('base64');

  let upstream: Response;
  try {
    upstream = await fetch(call.recording, {
      headers: { Authorization: `Basic ${basic}` },
      cache: 'no-store',
    });
  } catch (e: any) {
    console.error('[recording] upstream fetch failed:', e);
    return new NextResponse('Upstream fetch failed', { status: 502 });
  }

  if (!upstream.ok) {
    return new NextResponse(`WhatConverts returned ${upstream.status}`, { status: 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'audio/mpeg');
  headers.set('Cache-Control', 'private, max-age=3600');
  const cl = upstream.headers.get('Content-Length');
  if (cl) headers.set('Content-Length', cl);

  return new NextResponse(upstream.body, { status: 200, headers });
}
