import { NextRequest, NextResponse } from 'next/server';
import { computeWtdBookedRate } from '@/lib/whatconverts';
import { readCache, writeCache, isFresh } from '@/lib/cache';

// Read-only endpoint. Refreshes happen via /api/cron/booked-rate-refresh.
// If no cached snapshot exists, computes synchronously (slow first call).
const BASELINE_KEY = 'booked_rate_wtd';
const STRICT_KEY = 'booked_rate_wtd_strict';
// Mon→today subset, written alongside STRICT_KEY by the same cron job that
// classifies trailing-7 leads. Trophies read this; everything else still
// reads STRICT_KEY so trailing-7 behavior is unchanged.
// NOTE: STRICT_KEY 'booked_rate_wtd_strict' is a legacy misnomer (it stores
// trailing-7d data despite the "wtd" prefix — because the underlying
// computeWtdBookedRate() function uses last_7_days). The Mon→today key
// uses the explicit "week_to_date" prefix to avoid maintenance confusion.
const WTD_KEY = 'booked_rate_week_to_date_strict';
const FRESH_MS = 60 * 60 * 1000; // 1 hour

export async function handle(req: NextRequest) {
  const wantStrict = req.nextUrl.searchParams.get('strict') === '1';
  const wantWtd = req.nextUrl.searchParams.get('wtd') === '1';
  try {
    if (wantWtd) {
      // Mon→today cache: return whatever the cron has written. Never compute
      // on-demand (would re-classify all trailing-7 leads via Anthropic for no
      // marginal benefit — the cron already does it).
      const wtd = await readCache(WTD_KEY);
      if (wtd) return NextResponse.json(wtd);
      return NextResponse.json({
        warming: true, shops: [], chain: { eligible: 0, booked: 0, bookedRatePct: 0 },
        note: 'Week-to-date Call Conversion will populate on the next booked-rate cron tick.',
      });
    }
    if (wantStrict) {
      // Prefer the strict cache if it exists. Don't compute it on demand — it costs
      // money and time. Fall back to baseline if strict has never been run.
      const strict = await readCache(STRICT_KEY);
      if (strict) return NextResponse.json(strict);
    }
    if (await isFresh(BASELINE_KEY, FRESH_MS)) {
      const v = await readCache(BASELINE_KEY);
      if (v) return NextResponse.json(v);
    }
    const snap = await computeWtdBookedRate();
    await writeCache(BASELINE_KEY, snap);
    return NextResponse.json(snap);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'booked-rate failed' }, { status: 500 });
  }
}
