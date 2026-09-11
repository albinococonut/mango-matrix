// GET /api/google-ads/calls?weeks=N
// Returns cached weekly phone-call data for the last N weeks (default 12).
// Historical weeks are stored permanently in Redis by the backfill endpoint.
// The most recent 4 weeks are re-read live if a ?refresh=1 param is passed
// and CRON_SECRET is provided.

import { NextRequest, NextResponse } from 'next/server';
import { readMultiWeekCalls } from '@/lib/googleAdsHistory';
import { startOfWeek, addWeeks, format, subWeeks } from 'date-fns';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function getWeekISOs(n: number): string[] {
  const now = new Date();
  const thisWeek = startOfWeek(now, { weekStartsOn: 1 }); // Monday
  const weeks: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    weeks.push(format(subWeeks(thisWeek, i), 'yyyy-MM-dd'));
  }
  return weeks;
}

export async function GET(req: NextRequest) {
  const n = Math.min(52, Math.max(1, Number(req.nextUrl.searchParams.get('weeks') ?? '12')));
  const weekISOs = getWeekISOs(n);
  const data = await readMultiWeekCalls(weekISOs);

  return NextResponse.json({
    weeks: weekISOs,
    data,  // { [weekISO]: { all: N, "001": N, ... } | null }
  });
}
