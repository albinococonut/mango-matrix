// The Golden Mango — the weekly shop championship.
//
// A winner is "crowned" every Friday at 6:00 PM America/Denver (Mountain) and
// frozen for the whole following week, even if live standings change. The
// winner is the #1 shop in a weekly trophy tally computed from data the
// lightweight cron already warms (Tekmetric revenue / GP% / top-tech + the
// cached Re-Book leaderboard). No heavy deps — Hobby-tier safe.
//
// Persistence is the same file cache the rest of the dashboard uses (key
// `golden_mango`). The cron calls maybeCrown() every tick; it only re-locks
// when the Friday-6pm boundary has rolled over.

import { rosForChainCached } from '@/lib/dataAccess';
import { chainKpi, techProduction, isCountedRO } from '@/lib/metrics';
import { resolveRange, CHAIN_TZ } from '@/lib/dates';
import { workingDaysBetween } from '@/lib/goals';
import { readCache, writeCache } from '@/lib/cache';
import { SHOPS, SHOP_BY_TEKMETRIC_ID } from '@/lib/shops';
import { recoveredCountsByWindow } from '@/lib/recoveredLedger';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

export interface GoldenMango {
  periodStart: string;        // ISO of the Friday 18:00 MT this crown is locked for
  crownedAt: string;          // ISO when the cron set this crown
  shopNum: string;
  shopName: string;
  score: number;              // gold*100 + silver*10 + bronze
  medals: { gold: number; silver: number; bronze: number };
  revenue: number;
  gpPct: number;
  cars: number;
  rankMovement: number | null; // change in this champion's standing vs prior crown (+ = climbed); null = brand new
  defendingSince: string;      // periodStart when this shop's current streak began
  isNewChampion: boolean;      // winner differs from the previous period's winner
  previousChampionShopNum: string | null;
  isTie: boolean;              // ≥2 shops tied on gold/silver/bronze at the top
  tiedShopNames: string[];     // all co-champions (length 1 when no tie)
  standings: Array<{ shopNum: string; shopName: string; score: number; rank: number }>;
  categoryVersion?: string;    // tracks the category-set rules used to compute this crown — bump on rule changes so stale caches get re-computed by the self-heal handler
}

const CACHE_KEY = 'golden_mango';
// Permanent "last successfully computed crown" mirror — never period-checked.
// Whenever maybeCrown writes the period-stamped CACHE_KEY, it also writes
// this key. The read handler falls back to it when CACHE_KEY is missing,
// guaranteeing the page always renders a real champion rather than the
// "Crown loading…" empty state once the chain has been crowned at least once.
const LATEST_KEY = 'golden_mango_latest';
// Bumped to 'v2' when the crown's category set was aligned with Trophy Tally
// Week (added Comebacks + Call Conversion, dropped Return Customers, switched
// window to this_week). Any cached crown without categoryVersion === CURRENT
// is treated as stale and re-computed by the read handler.
export const CURRENT_CATEGORY_VERSION = 'v6';

/**
 * Most recent Friday 18:00 America/Denver at or before `now`. Everything is
 * computed in Mountain wall-clock then converted back to a UTC instant so the
 * boundary is stable regardless of the server's timezone or DST.
 */
export function crownPeriodStart(now: Date = new Date()): Date {
  const mtn = toZonedTime(now, CHAIN_TZ);
  // JS: 0=Sun … 5=Fri … 6=Sat
  const dow = mtn.getDay();
  // Build this calendar week's Friday 18:00 in Mountain wall-clock.
  const friday = new Date(mtn);
  const deltaToFri = 5 - dow; // days from today to Friday (can be negative)
  friday.setDate(mtn.getDate() + deltaToFri);
  friday.setHours(18, 0, 0, 0);
  // If we haven't reached this week's Friday 6pm yet, the active crown is last week's.
  let periodMtn = friday;
  if (mtn.getTime() < friday.getTime()) {
    periodMtn = new Date(friday);
    periodMtn.setDate(friday.getDate() - 7);
  }
  // Convert the Mountain wall-clock instant back to a real UTC Date.
  return fromZonedTime(periodMtn, CHAIN_TZ);
}

/** Next Friday 18:00 MT strictly after the given period start. */
export function nextCrownAt(periodStart: Date): Date {
  const mtn = toZonedTime(periodStart, CHAIN_TZ);
  mtn.setDate(mtn.getDate() + 7);
  return fromZonedTime(mtn, CHAIN_TZ);
}

interface Standing { shopNum: string; shopName: string; score: number; gold: number; silver: number; bronze: number; revenue: number; gpPct: number; cars: number }

/**
 * Weekly trophy tally — now aligned 1:1 with the Trophy Tally Week board so
 * the crown's medal counts agree exactly with the on-page tally for the same
 * window. Categories (6): Revenue, GP%, Top Tech, Most Re-Books, Fewest
 * Comebacks, Highest Call Conversion. Reviews stays paused (Google Business
 * Profile API access pending) — auto-resumes here once it returns to the
 * tally. Return Customers was removed (Trophy Tally doesn't count it, so
 * including it created the divergence the user flagged).
 *
 * Window: `this_week` (Mon→now MT). At the Friday 6 PM MT crown boundary the
 * compute runs against Mon→Fri 6 PM — the exact same window the live Trophy
 * Tally is showing on the page at that moment, so the medals match.
 *
 * Data sources are the EXACT same caches/keys the Tally reads through its
 * API endpoints, so the medal counts agree by construction:
 *   - Re-Book          → per-shop cache `fbr_shop_wtd_${num}` (the
 *                        leaderboard_wtd view assembles from these)
 *   - Call Conversion  → cache `booked_rate_week_to_date_strict`
 *   - Comebacks        → computed inline from this window's ROs (same
 *                        heuristic as the comebacks handler)
 *   - Top Tech         → ranked per-tech by efficiency, matching Trophy
 *                        Tally's `[...techs].sort((a,b) => b.efficiency -
 *                        a.efficiency).map(x => x.shopNum)` exactly. A shop
 *                        with the top two techs in the chain gets BOTH gold
 *                        and silver in this category, same as the Tally.
 */
async function computeStandings(period?: Date): Promise<Standing[]> {
  // The crown represents the work week ENDING at the Friday-6pm-MT period
  // boundary. Window = Monday-of-period's-week → period itself. Without this,
  // calling computeStandings after the boundary rolled over (e.g. Monday
  // morning) was producing a "this_week" window of just today, which gave
  // whichever shop opened first this morning the crown — exactly the
  // Downtown bug the user just hit. Period-anchored windowing locks the
  // compute to the correct historical week regardless of when it runs.
  let windowStartMs: number;
  let windowEndMs: number;
  if (period) {
    const periodMtn = toZonedTime(period, CHAIN_TZ);
    // Monday-of-period's-week in chain wall-clock, then convert back to UTC
    const periodDow = periodMtn.getDay(); // 0=Sun..6=Sat
    const daysSinceMonday = (periodDow + 6) % 7; // Mon=0
    const mondayMtn = new Date(periodMtn);
    mondayMtn.setDate(periodMtn.getDate() - daysSinceMonday);
    mondayMtn.setHours(0, 0, 0, 0);
    windowStartMs = fromZonedTime(mondayMtn, CHAIN_TZ).getTime();
    windowEndMs = period.getTime();
  } else {
    // Fallback for ad-hoc callers — current "this week so far" as before.
    const w = resolveRange('this_week');
    windowStartMs = w.start.getTime();
    windowEndMs = w.end.getTime();
  }
  // Cache-only read using last_7_days as the source (cron-warmed). We then
  // filter to the period window so the standings reflect Mon-Fri of the
  // week ending at the period boundary — not a stale or partial window.
  const lw = resolveRange('last_7_days');
  const { ros: rosBroad } = await rosForChainCached({ startISO: lw.startISO, endISO: lw.endISO });
  const ros = rosBroad.filter((o: any) => {
    const pd = o.postedDate ? new Date(o.postedDate).getTime() : 0;
    return pd >= windowStartMs && pd <= windowEndMs;
  });
  const w = { start: new Date(windowStartMs), end: new Date(windowEndMs), startISO: new Date(windowStartMs).toISOString(), endISO: new Date(windowEndMs).toISOString(), label: 'crown-period' } as const;
  const kpi = chainKpi(ros);
  const workingHours = Math.max(8, workingDaysBetween(w.start, w.end) * 8);
  const techs = techProduction(ros, workingHours);

  // Top-tech ranking — per-tech, sorted DESC by efficiency, NOT deduped by
  // shop. Matches Trophy Tally exactly (a shop's two top techs can take two
  // medal slots in the Top Tech category). award() handles duplicate shopNums
  // by incrementing the right medal counter each time the same shop appears.
  const topTechRanking = [...techs]
    .filter(t => t.efficiency > 0)
    .sort((a, b) => b.efficiency - a.efficiency)
    .map(t => ({ shopNum: t.shopNum, v: t.efficiency }));

  // Re-Book + Call Conversion — these caches are KEYED BY "this week" (Mon→
  // now). They auto-reset every Monday when the warm-fbr / warm-booked-rate
  // crons see a new startOfWeek and overwrite the per-shop entries with
  // fresh Monday-morning data. So they're VALID only when computing for the
  // current week's ceremony (within ~2h of the period boundary). For a
  // past-period recompute (e.g. Monday-morning force-recompute of last
  // Friday's lock), they hold THIS week's stale-for-the-period data — which
  // is exactly how the wrong Las Cruces winner kept getting computed. Skip
  // these categories entirely when the period being computed isn't current.
  const periodAgeMs = period ? (Date.now() - period.getTime()) : 0;
  const periodIsCurrent = !period || (periodAgeMs >= 0 && periodAgeMs < 2 * 60 * 60 * 1000);
  const rebookByShop = new Map<string, number>();
  const conversionByShop = new Map<string, number>();
  if (periodIsCurrent) {
    // Read the SAME per-shop WTD caches the Trophy Tally reads via
    // /api/fbr?view=leaderboard_wtd — these ARE valid at the lock moment.
    for (const s of SHOPS) {
      const v = await readCache<{ fbr?: { fbrPct?: number } }>(`fbr_shop_wtd_${s.num}`);
      if (v?.fbr?.fbrPct != null) rebookByShop.set(s.num, v.fbr.fbrPct);
    }
    const convCache = await readCache<{ shops?: Array<{ shopNum: string; bookedRatePct?: number }> }>('booked_rate_week_to_date_strict');
    for (const s of convCache?.shops ?? []) conversionByShop.set(s.shopNum, s.bookedRatePct ?? 0);
  }
  // else: leave both maps empty so award() drops the categories. The crown
  // for a past period is computed from the 5 categories whose data IS
  // period-anchored (Revenue, GP%, Top Tech, Comebacks, To-Do).

  // To-Do List Items Checked Off — for the week that ENDS at the period
  // boundary. We pass the period as the "now" anchor to recoveredCountsByWindow
  // so the recovery count maps to the same Mon-Fri window the rest of the
  // crown represents.
  const todoByShop = new Map<string, number>();
  try {
    const anchor = period ?? new Date();
    const { byShop: todoCounts } = await recoveredCountsByWindow('this_week', anchor);
    for (const [num, count] of Object.entries(todoCounts)) todoByShop.set(num, count);
  } catch (e) {
    console.warn('[golden-mango] todo-recoveries read failed:', (e as any)?.message);
  }

  // Comebacks — same heuristic as lib/handlers/comebacks.ts: an authorized
  // job with laborHours ≥ 0.25 charged ≤ $20 OR a job categorized as
  // re-inspect counts. Ranked ASCENDING (fewer comebacks = better).
  const comebacksByShop = new Map<string, number>();
  for (const s of SHOPS) comebacksByShop.set(s.num, 0); // default 0 so every shop is in the rank
  const COMEBACK_MIN_HOURS = 0.25;
  const COMEBACK_MAX_CHARGE = 20.00;
  for (const o of ros) {
    if (!isCountedRO(o)) continue;
    const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
    if (!meta) continue;
    for (const j of o.jobs || []) {
      const hours = j.laborHours || 0;
      const isReinspect = /re-?inspect|reins/i.test(j.jobCategoryName || '');
      const customerCharge = (j.subtotal || 0) / 100;
      const heuristicHit = j.authorized && hours >= COMEBACK_MIN_HOURS && customerCharge <= COMEBACK_MAX_CHARGE;
      if (!isReinspect && !heuristicHit) continue;
      comebacksByShop.set(meta.num, (comebacksByShop.get(meta.num) ?? 0) + 1);
    }
  }

  const base = new Map<string, Standing>();
  for (const s of SHOPS) {
    const k = kpi.byShop.find(x => x.shopNum === s.num);
    base.set(s.num, {
      shopNum: s.num, shopName: s.name, score: 0, gold: 0, silver: 0, bronze: 0,
      revenue: k?.revenue ?? 0, gpPct: k?.gpPct ?? 0, cars: k?.cars ?? 0,
    });
  }

  /**
   * Award top 3 in a category. `order: 'desc'` (default) ranks higher = better
   * and drops zero/missing entries (e.g. a shop with no conversion data doesn't
   * back into bronze with "0%"). `order: 'asc'` ranks lower = better — used for
   * Fewest Comebacks where 0 IS the best possible value, so zeros are kept.
   */
  function award(values: Array<{ shopNum: string; v: number }>, order: 'desc' | 'asc' = 'desc') {
    const filtered = order === 'desc' ? values.filter(x => x.v > 0) : values;
    const ranked = order === 'desc'
      ? filtered.sort((a, b) => b.v - a.v)
      : filtered.sort((a, b) => a.v - b.v);
    ranked.slice(0, 3).forEach((row, i) => {
      const st = base.get(row.shopNum);
      if (!st) return;
      if (i === 0) { st.gold++; st.score += 100; }
      else if (i === 1) { st.silver++; st.score += 10; }
      else { st.bronze++; st.score += 1; }
    });
  }

  award(kpi.byShop.map(x => ({ shopNum: x.shopNum, v: x.revenue })));
  award(kpi.byShop.map(x => ({ shopNum: x.shopNum, v: x.gpPct })));
  award(topTechRanking);
  award([...rebookByShop].map(([shopNum, v]) => ({ shopNum, v })));
  award([...comebacksByShop].map(([shopNum, v]) => ({ shopNum, v })), 'asc');
  award([...conversionByShop].map(([shopNum, v]) => ({ shopNum, v })));
  // To-Do List Items Checked Off — ranked DESC (more recoveries = better).
  // Same award() function so duplicate shops aren't possible (the source
  // map already dedupes by shop).
  award([...todoByShop].map(([shopNum, v]) => ({ shopNum, v })));

  // Champion order: most gold, then most silver, then most bronze. Revenue is
  // only a final display tiebreak for the lower ranks — it does NOT decide the
  // crown (a true gold/silver/bronze tie at the top is declared a shared title).
  return [...base.values()].sort((a, b) =>
    b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || b.revenue - a.revenue);
}

/**
 * Called by the cron every tick. Re-locks the champion only when the
 * Friday-6pm-MT boundary has rolled past the stored crown; otherwise leaves
 * the frozen winner untouched. Returns a short status string for the log.
 *
 * `force: true` bypasses BOTH the "same period → frozen" early-return AND
 * the 2-hour grace check. Used by the read handler's self-heal when the
 * cached crown was computed under a prior category-rule version
 * (categoryVersion ≠ CURRENT_CATEGORY_VERSION), so a stale crown locked in
 * by a cron tick that ran before the rule deploy can be replaced without
 * waiting for the next Friday boundary.
 */
// `force` was REMOVED — every caller that used it was producing corrupt
// mid-week crowns by recomputing against the FBR/Conversion WTD caches that
// auto-reset every Monday. The cron is now the ONLY caller and it never
// passes force, so the signature itself can refuse the flag and earlier-me
// can't be tempted to re-introduce the bug. The frozen check + 2-hour
// boundary gate below are therefore the ONLY entry conditions for an actual
// re-crown.
export async function maybeCrown(now: Date = new Date()): Promise<string> {
  const period = crownPeriodStart(now);
  const periodISO = period.toISOString();
  const existing = await readCache<GoldenMango>(CACHE_KEY);

  if (existing && existing.periodStart === periodISO) {
    return `golden mango frozen — ${existing.shopName} holds (period ${periodISO.slice(0, 10)})`;
  }

  // Only crown AT the Friday 6 PM MT boundary (the cron runs every 15 min, so
  // a 2-hour window reliably catches the transition). Outside that window with
  // no champion yet, stay uncrowned so the hero shows "Awaiting the First
  // Crown" until a real Friday crowning — never a mid-week placeholder.
  const sincePeriodMs = now.getTime() - period.getTime();
  if (!existing && sincePeriodMs > 2 * 60 * 60 * 1000) {
    return 'golden mango: awaiting the first crown (will crown at Friday 6 PM MT)';
  }

  // Pass `period` so the standings reflect the work week ENDING at that
  // Friday boundary — not "now's this_week" which on Monday morning would
  // give the crown to whichever shop happens to have opened first today.
  const standings = await computeStandings(period);
  if (standings.length === 0) return 'golden mango: no standings computed (no RO data)';
  const winner = standings[0];
  // Co-champions: every shop matching the leader's exact gold/silver/bronze.
  const coChamps = standings.filter(s =>
    s.gold === winner.gold && s.silver === winner.silver && s.bronze === winner.bronze);
  const isTie = coChamps.length > 1;
  const tiedShopNames = coChamps.map(s => s.shopName);

  const prevWinnerNum = existing?.shopNum ?? null;
  const isNewChampion = prevWinnerNum !== winner.shopNum;

  // Rank movement = how far the new champion climbed vs the prior crown's
  // standings snapshot (positive = climbed; null = no prior data / brand new).
  let rankMovement: number | null = null;
  if (existing?.standings) {
    const priorRank = existing.standings.find(s => s.shopNum === winner.shopNum)?.rank;
    if (priorRank) rankMovement = priorRank - 1; // they're rank 1 now
  }

  const defendingSince = !isNewChampion && existing?.defendingSince
    ? existing.defendingSince
    : periodISO;

  const payload: GoldenMango = {
    periodStart: periodISO,
    crownedAt: now.toISOString(),
    shopNum: winner.shopNum,
    shopName: winner.shopName,
    score: winner.score,
    medals: { gold: winner.gold, silver: winner.silver, bronze: winner.bronze },
    revenue: winner.revenue,
    gpPct: winner.gpPct,
    cars: winner.cars,
    rankMovement,
    defendingSince,
    isNewChampion,
    previousChampionShopNum: prevWinnerNum,
    isTie,
    tiedShopNames,
    standings: standings.map((s, i) => ({ shopNum: s.shopNum, shopName: s.shopName, score: s.score, rank: i + 1 })),
    categoryVersion: CURRENT_CATEGORY_VERSION,
  };
  await writeCache(CACHE_KEY, payload);
  // Mirror only when this looks like a legitimate boundary lock (called at
  // or shortly after the period start). Skips writes from force-recomputes
  // (e.g. version-stale or first-crown self-heal) so a buggy recompute can't
  // permanently corrupt the "last known good" fallback. Cron at Friday 6 PM
  // MT runs within seconds of `period`, easily within the 2h window.
  const sinceBoundaryMs = now.getTime() - period.getTime();
  const isLegitimateLock = sinceBoundaryMs >= 0 && sinceBoundaryMs < 2 * 60 * 60 * 1000;
  if (isLegitimateLock) {
    await writeCache(LATEST_KEY, payload);
  }
  return `golden mango ${isTie ? `TIE between ${tiedShopNames.join(', ')}` : `crowned ${winner.shopName}`} (g${winner.gold}/s${winner.silver}/b${winner.bronze}) period ${periodISO.slice(0, 10)}${isNewChampion ? ' — NEW' : ' — defended'}`;
}

/** Read the current locked champion (or null if never crowned yet). */
export async function readGoldenMango(): Promise<GoldenMango | null> {
  return readCache<GoldenMango>(CACHE_KEY);
}

/**
 * Read the last successfully computed crown — period-agnostic. Falls back
 * here when CACHE_KEY is missing (e.g. cache eviction, cron miss, partial
 * compute) so the UI always has SOMETHING to render once the chain has been
 * crowned at least once. The returned crown's `periodStart` tells the UI
 * which Friday it was locked for.
 */
export async function readLatestGoldenMango(): Promise<GoldenMango | null> {
  return readCache<GoldenMango>(LATEST_KEY);
}
