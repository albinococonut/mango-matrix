// One-time (resumable) backfill of the permanent Tekmetric weekly archive.
//
//   GET                      → current archive status (week count, range, cursor)
//   POST  ?weeks=N&reset=1   → process the next N older weeks (Bearer auth)
//
// Auth mirrors /api/cron/run-syncs: Bearer ${CRON_SECRET} or ${CRON_SECRET_ADMIN}.
// Designed to be called repeatedly (small batches) until { done: true }. Kept
// OFF the main 15-min sweep on purpose — that sweep is duration-sensitive.

import { NextRequest, NextResponse } from 'next/server';
import { backfillNextBatch, resetBackfillCursor, readArchiveStatus, ARCHIVE_FLOOR_WEEK } from '@/lib/historyArchive';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function authorized(req: NextRequest): boolean {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = process.env.CRON_SECRET, b = process.env.CRON_SECRET_ADMIN;
  return (!!a && !!token && constEq(token, a)) || (!!b && !!token && constEq(token, b));
}

export async function GET() {
  const status = await readArchiveStatus();
  return NextResponse.json({ floor: ARCHIVE_FLOOR_WEEK, ...status });
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET && !process.env.CRON_SECRET_ADMIN) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = req.nextUrl;
  if (url.searchParams.get('reset') === '1') await resetBackfillCursor();
  const weeks = Math.max(1, Math.min(25, Number(url.searchParams.get('weeks')) || 10));

  const { processed, cursor } = await backfillNextBatch(weeks);
  const status = await readArchiveStatus();
  return NextResponse.json({
    processed,
    done: cursor.done,
    nextWeek: cursor.next,
    totalProcessed: cursor.processed,
    weekCount: status.weekCount,
    oldest: status.oldest,
    newest: status.newest,
    years: status.years,
  });
}
