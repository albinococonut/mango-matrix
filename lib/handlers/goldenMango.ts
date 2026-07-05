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

// ── ONE-TIME MANUAL OVERRIDES ────────────────────────────────────────────────

// May 29 override: my force-recompute logic clobbered the legitimate Friday
// May 29 6 PM MT crown. The Valley (shop 009) was the actual winner of May
// 25-29. This override was active until the June 5 ceremony superseded it.
const OVERRIDE_MAY29_ISO = '2026-05-30T00:00:00.000Z'; // Friday May 29 6 PM MT
const OVERRIDE_VALLEY: GoldenMango = {
  periodStart: OVERRIDE_MAY29_ISO,
  crownedAt: '2026-05-30T00:00:00.000Z',
  shopNum: '009',
  shopName: 'The Valley',
  score: 200,
  medals: { gold: 2, silver: 0, bronze: 0 },
  // Actual stats from Tekmetric ROs posted May 25–29 (Mon–Fri) for shop 009.
  // Fetched 2026-06-02 via rosForShop(16116, {start: May25, end: May30}) →
  // shopKpi: 26 ROs, $23,267 revenue, 57.0% GP, 26 cars, $895 ARO.
  revenue: 23267, gpPct: 0.5700351571498814, cars: 26,
  rankMovement: null,
  defendingSince: OVERRIDE_MAY29_ISO,
  isNewChampion: true,
  previousChampionShopNum: null,
  isTie: false,
  tiedShopNames: ['The Valley'],
  standings: [{ shopNum: '009', shopName: 'The Valley', score: 200, rank: 1 }],
  categoryVersion: CURRENT_CATEGORY_VERSION,
};

// July 2 override: computeStandings() was reading `last_7_days` cache (starts
// June 26) instead of `this_week` cache (starts June 29 Monday). The two cache
// keys hold different Tekmetric query results. Heights (shop 002) was the
// legitimate winner of the June 30 – July 2 work week — it led the Trophy Tally
// all day — but Cottonwood was incorrectly crowned. Fixed the root cause (now
// reads `this_week`). This override corrects the displayed champion until the
// next ceremony (July 10) supersedes it.
const OVERRIDE_JULY2_ISO = '2026-07-03T00:00:00.000Z'; // Thursday July 2 6 PM MT
const OVERRIDE_HEIGHTS: GoldenMango = {
  periodStart: OVERRIDE_JULY2_ISO,
  crownedAt: OVERRIDE_JULY2_ISO,
  shopNum: '002',
  shopName: 'The Heights',
  score: 200,
  medals: { gold: 2, silver: 0, bronze: 0 },
  revenue: 0, gpPct: 0, cars: 0,
  rankMovement: null,
  defendingSince: OVERRIDE_JULY2_ISO,
  isNewChampion: true,
  previousChampionShopNum: '001',
  isTie: false,
  tiedShopNames: ['The Heights'],
  standings: [{ shopNum: '002', shopName: 'The Heights', score: 200, rank: 1 }],
  categoryVersion: CURRENT_CATEGORY_VERSION,
};

// June 5 override: Yuma's USPS fleet shop (Tekmetric ID 18346) opened May
// 2026 and was accidentally included in every Friday computeStandings() call,
// adding ~173 fleet cars/month at $137 ARO that inflated Yuma's revenue and
// car-count category rankings. The fleet-exclusion fix
// (tekmetricIdSecondaryFleetOnly: true) was deployed AFTER the June 5 6 PM MT
// ceremony ran, so the cached crown incorrectly shows Yuma as the winner.
// The user confirmed Cottonwood (shop 001) is the legitimate winner of the
// June 2-5 work week. Revenue/GP/cars stats are 0 here (displayed as "—" in
// the UI); update with real values once available via rosForShop(3785, ...).
// The June 12 cron will use fleet-clean data automatically — no further
// overrides should be needed.
const OVERRIDE_JUNE5_ISO = '2026-06-06T00:00:00.000Z'; // Friday June 5 6 PM MT
const OVERRIDE_COTTONWOOD: GoldenMango = {
  periodStart: OVERRIDE_JUNE5_ISO,
  crownedAt: OVERRIDE_JUNE5_ISO,
  shopNum: '001',
  shopName: 'Cottonwood',
  score: 300,
  medals: { gold: 3, silver: 0, bronze: 0 },
  // Stats TBD — fetch via rosForShop(3785, {start: 2026-06-02, end: 2026-06-06})
  // and update these fields. Displayed as "—" in the hero card until then.
  revenue: 0, gpPct: 0, cars: 0,
  rankMovement: null,
  defendingSince: OVERRIDE_JUNE5_ISO,
  isNewChampion: true,
  previousChampionShopNum: '009',
  isTie: false,
  tiedShopNames: ['Cottonwood'],
  standings: [{ shopNum: '001', shopName: 'Cottonwood', score: 300, rank: 1 }],
  categoryVersion: CURRENT_CATEGORY_VERSION,
};

export async function handle() {
  let champ = await readGoldenMango();
  const period = crownPeriodStart();
  const periodISO = period.toISOString();

  // ── One-time override for the corrupted May 29 period ──────────────────
  // The Valley (shop 009) was the legitimate winner. Expired once the June 5
  // ceremony ran (different periodStart → never matches again).
  if (periodISO === OVERRIDE_MAY29_ISO) {
    const cacheAlreadyMatches = !!champ
      && champ.shopNum === '009'
      && champ.periodStart === OVERRIDE_MAY29_ISO
      && champ.categoryVersion === OVERRIDE_VALLEY.categoryVersion
      && champ.revenue === OVERRIDE_VALLEY.revenue;
    if (!cacheAlreadyMatches) {
      try { await writeCache('golden_mango', OVERRIDE_VALLEY); } catch { /* swallow */ }
      try { await writeCache('golden_mango_latest', OVERRIDE_VALLEY); } catch { /* swallow */ }
    }
    const next = nextCrownAt(period);
    return NextResponse.json({ champion: OVERRIDE_VALLEY, nextCrownAt: next.toISOString(), manualOverride: true });
  }

  // ── One-time override for the July 2 wrong-cache-key period ─────────────
  // computeStandings() read `last_7_days` (starts June 26) instead of
  // `this_week` (starts June 29), so the Cottonwood was crowned instead of
  // Heights (shop 002). Root cause fixed; this override corrects the display.
  // Expires once the July 10 cron writes a new crown (different periodStart).
  if (periodISO === OVERRIDE_JULY2_ISO) {
    const cacheAlreadyMatches = !!champ
      && champ.shopNum === '002'
      && champ.periodStart === OVERRIDE_JULY2_ISO
      && champ.categoryVersion === OVERRIDE_HEIGHTS.categoryVersion;
    if (!cacheAlreadyMatches) {
      try { await writeCache('golden_mango', OVERRIDE_HEIGHTS); } catch { /* swallow */ }
      try { await writeCache('golden_mango_latest', OVERRIDE_HEIGHTS); } catch { /* swallow */ }
    }
    const next = nextCrownAt(period);
    return NextResponse.json({ champion: OVERRIDE_HEIGHTS, nextCrownAt: next.toISOString(), manualOverride: true });
  }

  // ── One-time override for the fleet-contaminated June 5 period ──────────
  // The cron ran before the Yuma fleet-exclusion fix deployed, so it locked
  // Yuma as winner when Cottonwood (shop 001) was the real winner of June 2-5.
  // Expires automatically once the June 12 cron writes the next crown
  // (different periodStart → this branch never matches again after that).
  if (periodISO === OVERRIDE_JUNE5_ISO) {
    const cacheAlreadyMatches = !!champ
      && champ.shopNum === '001'
      && champ.periodStart === OVERRIDE_JUNE5_ISO
      && champ.categoryVersion === OVERRIDE_COTTONWOOD.categoryVersion
      && champ.revenue === OVERRIDE_COTTONWOOD.revenue;
    if (!cacheAlreadyMatches) {
      try { await writeCache('golden_mango', OVERRIDE_COTTONWOOD); } catch { /* swallow */ }
      try { await writeCache('golden_mango_latest', OVERRIDE_COTTONWOOD); } catch { /* swallow */ }
    }
    const next = nextCrownAt(period);
    return NextResponse.json({ champion: OVERRIDE_COTTONWOOD, nextCrownAt: next.toISOString(), manualOverride: true });
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
