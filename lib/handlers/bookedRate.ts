import { NextRequest, NextResponse } from 'next/server';
import { readCache } from '@/lib/cache';

// Read-only endpoint. The strict (Claude-classified) snapshot is written by
// the refreshBookedRate cron job. There is no longer a WhatConverts baseline
// fallback — RingCentral has no equivalent "Appointment Scheduled" outcome
// field, so Claude's classification is the only source.
const STRICT_KEY = 'booked_rate_wtd_strict';
const WTD_KEY = 'booked_rate_week_to_date_strict';

export async function handle(req: NextRequest) {
  const wantWtd = req.nextUrl.searchParams.get('wtd') === '1';
  try {
    if (wantWtd) {
      const wtd = await readCache(WTD_KEY);
      if (wtd) return NextResponse.json(wtd);
      return NextResponse.json({
        warming: true, shops: [], chain: { eligible: 0, booked: 0, bookedRatePct: 0 },
        note: 'Week-to-date Call Conversion will populate on the next cron tick.',
      });
    }
    const strict = await readCache(STRICT_KEY);
    if (strict) return NextResponse.json(strict);
    return NextResponse.json({
      warming: true, shops: [], chain: { eligible: 0, booked: 0, bookedRatePct: 0 },
      note: 'Call Conversion will populate on the next cron tick.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'booked-rate failed' }, { status: 500 });
  }
}
