// POST /api/google-ads/calls-backfill
// Pulls Google Ads phone call data from 2022-01-01 to today, quarterly chunks,
// and stores each week permanently in Redis. Idempotent — safe to re-run.
// Protected by CRON_SECRET or CRON_SECRET_ADMIN bearer token.
//
// Optional body: { startYear?: number } to begin from a different year.

import { NextRequest, NextResponse } from 'next/server';
import { backfillRange } from '@/lib/googleAdsHistory';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function constEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Quarter start dates from startYear to today
function quarterChunks(startYear: number): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  const now = new Date();
  for (let y = startYear; y <= now.getFullYear(); y++) {
    for (let q = 0; q < 4; q++) {
      const start = new Date(y, q * 3, 1);
      if (start > now) break;
      const end = new Date(y, q * 3 + 3, 0); // last day of quarter
      const endClamped = end > now ? now : end;
      chunks.push({
        start: start.toISOString().slice(0, 10),
        end: endClamped.toISOString().slice(0, 10),
      });
    }
  }
  return chunks;
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? process.env.CRON_SECRET_ADMIN ?? '';
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!secret || !constEq(token, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const customerIds = (process.env.GOOGLE_ADS_CUSTOMER_IDS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (customerIds.length === 0) {
    return NextResponse.json({ error: 'GOOGLE_ADS_CUSTOMER_IDS not configured' }, { status: 503 });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const startYear = Number(body.startYear ?? 2022);

  const chunks = quarterChunks(startYear);
  let totalWeeks = 0;
  const log: string[] = [];

  for (const { start, end } of chunks) {
    try {
      const written = await backfillRange(customerIds, start, end);
      totalWeeks += written;
      log.push(`${start}–${end}: ${written} weeks written`);
    } catch (e: any) {
      log.push(`${start}–${end}: ERROR — ${e.message}`);
    }
  }

  return NextResponse.json({ totalWeeks, log });
}
