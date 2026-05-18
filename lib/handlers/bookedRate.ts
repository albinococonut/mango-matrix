import { NextRequest, NextResponse } from 'next/server';
import { computeWtdBookedRate } from '@/lib/whatconverts';
import { readCache, writeCache, isFresh } from '@/lib/cache';

// Read-only endpoint. Refreshes happen via /api/cron/booked-rate-refresh.
// If no cached snapshot exists, computes synchronously (slow first call).
const BASELINE_KEY = 'booked_rate_wtd';
const STRICT_KEY = 'booked_rate_wtd_strict';
const FRESH_MS = 60 * 60 * 1000; // 1 hour

export async function handle(req: NextRequest) {
  const wantStrict = req.nextUrl.searchParams.get('strict') === '1';
  try {
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
