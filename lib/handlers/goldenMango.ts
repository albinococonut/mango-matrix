// Read handler for the locked Golden Mango champion. Dispatched via
// /api/extras?view=golden-mango so it doesn't consume a serverless function
// slot (Hobby 12-function cap). Normally the GH-Actions cron does all the
// work and this just serves the cache.
//
// Self-heal strategy — keep the read FAST:
//   - cache is empty (no crown at all): block on compute once, then serve
//     (otherwise the UI is stuck on "Awaiting" forever if the cron missed)
//   - cache exists but periodStart OR categoryVersion is stale: serve the
//     stale crown IMMEDIATELY and fire-and-forget a background recompute so
//     the next read picks up the corrected payload
// Blocking the request on the recompute (which does 25+ cache reads +
// chainKpi + techProduction over a week of ROs) made the Employee page feel
// hung; this restores the previous instant-read behavior and only the very
// first hit after a cron miss / version bump pays the compute cost.

import { NextResponse } from 'next/server';
import { readGoldenMango, readLatestGoldenMango, crownPeriodStart, nextCrownAt, CURRENT_CATEGORY_VERSION } from '@/lib/goldenMango';
import { writeCache } from '@/lib/cache';
import type { GoldenMango } from '@/lib/goldenMango';

// ── ONE-TIME MANUAL OVERRIDE ────────────────────────────────────────────────
// My force-recompute logic clobbered the legitimate Friday May 29 6 PM MT
// crown that the production cron had locked. The user confirmed The Valley
// (shop 009) was the actual winner of May 25-29. This override pins that
// result for the affected period; the next cron at Friday June 5 6 PM MT
// will roll the next legitimate ceremony naturally (different periodStart →
// override doesn't apply). Removing this hardcode after the June 5 lock.
const OVERRIDE_PERIOD_ISO = '2026-05-30T00:00:00.000Z'; // Friday May 29 6 PM MT
const OVERRIDE_VALLEY: GoldenMango = {
  periodStart: OVERRIDE_PERIOD_ISO,
  crownedAt: '2026-05-30T00:00:00.000Z',
  shopNum: '009',
  shopName: 'The Valley',
  score: 200,
  medals: { gold: 2, silver: 0, bronze: 0 },
  revenue: 0, gpPct: 0, cars: 0,
  rankMovement: null,
  defendingSince: OVERRIDE_PERIOD_ISO,
  isNewChampion: true,
  previousChampionShopNum: null,
  isTie: false,
  tiedShopNames: ['The Valley'],
  standings: [{ shopNum: '009', shopName: 'The Valley', score: 200, rank: 1 }],
  categoryVersion: CURRENT_CATEGORY_VERSION,
};

export async function handle() {
  let champ = await readGoldenMango();
  const period = crownPeriodStart();
  const periodISO = period.toISOString();

  // ── One-time override for the corrupted May 29 period ──────────────────
  // Pins The Valley as the legitimate winner of May 25-29 (Friday 6 PM MT
  // ceremony). Writes through to both caches THE FIRST TIME the cache
  // doesn't match, then on every subsequent request just returns the stored
  // override constant — no recompute, no rewrite. Once Friday June 5 6 PM MT
  // rolls over, `periodISO` advances and this whole branch never runs again;
  // the next cron writes the new legitimate crown.
  if (periodISO === OVERRIDE_PERIOD_ISO) {
    const cacheAlreadyMatches = !!champ
      && champ.shopNum === '009'
      && champ.periodStart === OVERRIDE_PERIOD_ISO
      && champ.categoryVersion === OVERRIDE_VALLEY.categoryVersion;
    if (!cacheAlreadyMatches) {
      // First-time seed (or cache eviction recovery). Both caches get the
      // override so the read path can serve from either fast slot.
      try { await writeCache('golden_mango', OVERRIDE_VALLEY); } catch { /* swallow */ }
      try { await writeCache('golden_mango_latest', OVERRIDE_VALLEY); } catch { /* swallow */ }
    }
    const next = nextCrownAt(period);
    return NextResponse.json({ champion: OVERRIDE_VALLEY, nextCrownAt: next.toISOString(), manualOverride: true });
  }

  // ── PERMANENT ROLLBACK: handler is now READ-ONLY ──────────────────────
  // All self-heal / force-recompute paths are REMOVED. The cron at Friday 6
  // PM MT is the ONLY legitimate writer of the crown. Any mid-week recompute
  // (cache-empty fallback, version-stale, period-stale, etc.) was producing
  // garbage winners because the data sources the recompute relies on (FBR
  // WTD cache, Conversion WTD cache) auto-reset every Monday morning. Once
  // a Friday lock is overwritten, the legitimate data is gone — and we lost
  // The Valley's crown chasing that. From here on: the cron writes, the
  // handler reads. If the cron misses a Friday, the prior crown holds.
  const next = nextCrownAt(period);

  // Period-stamped cache OR permanent "latest" mirror — whichever has data.
  // The latest mirror is only written by legitimate cron-driven locks (see
  // the `isLegitimateLock` guard in lib/goldenMango.ts maybeCrown), so it
  // can't be corrupted by accidental recomputes anymore.
  if (!champ) {
    const latest = await readLatestGoldenMango();
    if (latest) {
      return NextResponse.json({ champion: latest, nextCrownAt: next.toISOString(), servedFromLatest: true });
    }
    return NextResponse.json({ champion: null, nextCrownAt: next.toISOString() });
  }
  return NextResponse.json({ champion: champ, nextCrownAt: next.toISOString() });
}
