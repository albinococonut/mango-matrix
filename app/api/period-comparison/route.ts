import { NextRequest, NextResponse } from 'next/server';
import { rosForChain, rosForShopNum } from '@/lib/dataAccess';
import { SHOP_BY_NUM, ShopNum } from '@/lib/shops';
import { chainKpi, isCountedRO } from '@/lib/metrics';
import { c2d } from '@/lib/tekmetric';
import { ComparisonMode, customRange, resolveComparisonRange, resolveRange, RangeKey, CHAIN_TZ } from '@/lib/dates';
import { getRole } from '@/lib/serverAuth';
import { readCache, writeCache, isFresh } from '@/lib/cache';
import { metricSnapshotMap } from '@/lib/metricSnapshots';
import { SHOPS } from '@/lib/shops';
// (SHOPS imported above for the per-shop WTD FBR warm-patch; SHOP_BY_NUM/ShopNum added for shop filter)
import type { RepairOrder } from '@/lib/tekmetric';
import { startOfWeek } from 'date-fns';

// Inlined (not imported from syncJobs) so this route's bundle stays free of
// the Anthropic SDK that syncJobs pulls in.
const fbrShopWtdKey = (num: string) => `fbr_shop_wtd_${num}`;
import { toZonedTime } from 'date-fns-tz';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
// Period comparison can span ~10 months × 8 shops (this_year vs last_year) —
// far too heavy to recompute on every refresh. Cache in durable Redis and
// serve stale on failure so the section is never empty once computed.
const PC_FRESH_MS = 6 * 60 * 60 * 1000; // 6h

// Static frozen backfill of historical weekly Re-Book % / Call-Conversion %
// (same file the heatmap uses). Used as the fallback for weeks that predate
// the live weekly snapshots.
interface WeekExtra { weekStart: string; rebook: Record<string, number>; conversion: Record<string, number>; }
function loadExtras(): Map<string, WeekExtra> {
  const m = new Map<string, WeekExtra>();
  try {
    const f = path.join(process.cwd(), 'data', 'heatmapExtras.json');
    if (existsSync(f)) {
      const j = JSON.parse(readFileSync(f, 'utf8'));
      for (const w of j.weeks || []) m.set(w.weekStart, w);
    }
  } catch {}
  return m;
}

// Mean of the present per-shop values (unweighted — the snapshots/backfill
// only store percentages, not the underlying counts, so a weighted chain rate
// isn't reconstructable. Good enough for a trend line).
function chainAvg(perShop: Record<string, number> | undefined): number | null {
  if (!perShop) return null;
  const vals = Object.values(perShop).filter(v => typeof v === 'number' && v >= 0);
  if (!vals.length) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
}

interface WeekBucket {
  weekStart: string;
  revenue: number; gpDollars: number; gpPct: number; cars: number; aro: number;
  closeRate: number; comebacks: number; hours: number;
  conversion: number | null; rebook: number | null;
}
interface PeriodMetrics {
  label: string;
  weeks: WeekBucket[];
  totals: {
    revenue: number; gpDollars: number; gpPct: number; cars: number; aro: number;
    closeRate: number; comebacks: number; hours: number;
    conversion: number | null; rebook: number | null;
  };
}

function mondayOf(postedDate: string): string {
  const z = toZonedTime(new Date(postedDate), CHAIN_TZ);
  return startOfWeek(z, { weekStartsOn: 1 }).toISOString().slice(0, 10);
}

// Granularity-aware bucket key. Daily = MT calendar date. Weekly = Monday of
// that week. Monthly = first of that month. All chain-TZ anchored so buckets
// align with how the dashboard counts every other "this week / this month."
type Granularity = 'daily' | 'weekly' | 'monthly';
function bucketKeyFor(granularity: Granularity, postedDate: string): string {
  const z = toZonedTime(new Date(postedDate), CHAIN_TZ);
  if (granularity === 'daily') return z.toISOString().slice(0, 10);
  if (granularity === 'monthly') {
    const y = z.getFullYear(), m = String(z.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  }
  return startOfWeek(z, { weekStartsOn: 1 }).toISOString().slice(0, 10);
}

// Comebacks + authorized billed hours from a set of ROs (same heuristic the
// Shop Performance heatmap uses).
function comebacksAndHours(ros: RepairOrder[]): { comebacks: number; hours: number } {
  let comebacks = 0, hours = 0;
  for (const o of ros) {
    if (!isCountedRO(o)) continue;
    for (const j of o.jobs || []) {
      const h = j.laborHours || 0;
      if (j.authorized) hours += h;
      const isReins = /re-?inspect|reins/i.test(j.jobCategoryName || '');
      const charge = c2d(j.subtotal || 0);
      if (isReins || (j.authorized && h >= 0.25 && charge <= 20)) comebacks++;
    }
  }
  return { comebacks: Math.round(comebacks), hours: Math.round(hours * 10) / 10 };
}

function buildPeriod(
  ros: RepairOrder[],
  label: string,
  convRebookByWeek: Map<string, { conversion: number | null; rebook: number | null }>,
  granularity: Granularity = 'weekly',
): PeriodMetrics {
  // Bucket ROs at the requested granularity. weekStart field still carries
  // the bucket-anchor date (YYYY-MM-DD) — for daily it IS the day, for
  // weekly it's the Monday, for monthly it's the 1st of the month.
  const byBucket = new Map<string, RepairOrder[]>();
  for (const o of ros) {
    if (!o.postedDate) continue;
    const bk = bucketKeyFor(granularity, o.postedDate);
    const arr = byBucket.get(bk) ?? [];
    arr.push(o);
    byBucket.set(bk, arr);
  }
  const weeks: WeekBucket[] = [];
  for (const [weekStart, bkRos] of [...byBucket.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const k = chainKpi(bkRos);
    const { comebacks, hours } = comebacksAndHours(bkRos);
    // Call Conversion + Re-Book are only tracked at WEEKLY granularity (the
    // snapshots are weekly-keyed). For daily, set to null — they'd be
    // misleading at sub-week resolution. For monthly, mean the matching
    // weeks' values into the month bucket.
    let cr: { conversion: number | null; rebook: number | null } = { conversion: null, rebook: null };
    if (granularity === 'weekly') {
      cr = convRebookByWeek.get(weekStart) || { conversion: null, rebook: null };
    } else if (granularity === 'monthly') {
      const month = weekStart.slice(0, 7);
      const matching = [...convRebookByWeek.entries()]
        .filter(([wk]) => wk.startsWith(month))
        .map(([, v]) => v);
      const convs = matching.map((v) => v.conversion).filter((v): v is number => v != null);
      const rebs = matching.map((v) => v.rebook).filter((v): v is number => v != null);
      cr = {
        conversion: convs.length ? Math.round((convs.reduce((s, v) => s + v, 0) / convs.length) * 10) / 10 : null,
        rebook: rebs.length ? Math.round((rebs.reduce((s, v) => s + v, 0) / rebs.length) * 10) / 10 : null,
      };
    }
    weeks.push({
      weekStart,
      revenue: Math.round(k.totalRevenue),
      gpDollars: Math.round(k.byShop.reduce((s, sh) => s + (sh.gpDollars || 0), 0)),
      gpPct: (() => { const rev = k.byShop.reduce((s, sh) => s + sh.revenue, 0); const gp = k.byShop.reduce((s, sh) => s + (sh.gpDollars || 0), 0); return rev ? Math.round((gp / rev) * 1000) / 10 : 0; })(),
      cars: k.totalCars,
      aro: Math.round(k.averageAro),
      closeRate: Math.round(k.closeRate * 1000) / 10,
      comebacks, hours,
      conversion: cr.conversion, rebook: cr.rebook,
    });
  }
  // Period totals computed from the full RO set (not summed from weekly
  // ratios, which would be wrong for GP%/ARO/Close Rate).
  const full = chainKpi(ros);
  const totalRev = full.byShop.reduce((s, sh) => s + sh.revenue, 0);
  const totalGp = full.byShop.reduce((s, sh) => s + (sh.gpDollars || 0), 0);
  const { comebacks: totCb, hours: totHrs } = comebacksAndHours(ros);
  const convVals = weeks.map(w => w.conversion).filter((v): v is number => v != null);
  const rebookVals = weeks.map(w => w.rebook).filter((v): v is number => v != null);
  return {
    label,
    weeks,
    totals: {
      revenue: Math.round(full.totalRevenue),
      gpDollars: Math.round(totalGp),
      gpPct: totalRev ? Math.round((totalGp / totalRev) * 1000) / 10 : 0,
      cars: full.totalCars,
      aro: Math.round(full.averageAro),
      closeRate: Math.round(full.closeRate * 1000) / 10,
      comebacks: totCb, hours: totHrs,
      conversion: convVals.length ? Math.round((convVals.reduce((s, v) => s + v, 0) / convVals.length) * 10) / 10 : null,
      rebook: rebookVals.length ? Math.round((rebookVals.reduce((s, v) => s + v, 0) / rebookVals.length) * 10) / 10 : null,
    },
  };
}

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const range = (req.nextUrl.searchParams.get('range') as RangeKey) || 'this_year';
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');
  const compMode = (req.nextUrl.searchParams.get('compare') as ComparisonMode) || 'same_period_last_year';
  const compStart = req.nextUrl.searchParams.get('compStart');
  const compEnd = req.nextUrl.searchParams.get('compEnd');
  // Granularity: daily | weekly | monthly. Defaults to weekly (the original
  // behavior) so existing callers keep working without code changes.
  const rawGran = req.nextUrl.searchParams.get('granularity');
  const granularity: Granularity = rawGran === 'daily' || rawGran === 'monthly' ? rawGran : 'weekly';

  // Shop filter: 'all' (default) or a specific shopNum like '001'.
  // When a single shop is selected, only that shop's ROs are included so
  // every metric (revenue, GP, cars, etc.) reflects that shop alone.
  // Conversion / Re-Book are still suppressed for single-shop since the
  // snapshot store only holds chain averages.
  const rawShop = req.nextUrl.searchParams.get('shop') || 'all';
  const shopFilter: ShopNum | 'all' = rawShop !== 'all' && SHOP_BY_NUM[rawShop as ShopNum] ? rawShop as ShopNum : 'all';

  const currWindow = range === 'custom' && start && end ? customRange(start, end) : resolveRange(range);
  const prevWindow = resolveComparisonRange(currWindow, compMode, compStart || undefined, compEnd || undefined);

  // Cache key: bumped to pc_v4 (2026-06-03) after the Yuma fleet-only fix.
  // Old pc_v2/pc_v3 entries included Yuma fleet shop 18346 in chain metrics —
  // v4 forces a clean recompute so stale fleet-inclusive data is never served.
  const cachePrefix = 'pc_v4';
  const respKey = `${cachePrefix}_${granularity}_${shopFilter}_${range}_${compMode}_${start || ''}_${end || ''}_${compStart || ''}_${compEnd || ''}`;
  if (await isFresh(respKey, PC_FRESH_MS)) {
    const cached = await readCache<any>(respKey);
    // Patch the current week's chain Re-Book/Conversion live even on a cache
    // hit (the response is cached 6h but the current week must match the
    // Employee view, which reads these caches live).
    if (cached) return NextResponse.json({ ...(await patchCurrentWeekLive(cached)), cached: true });
  }

  try {
    // Fetch ROs. For a single-shop request we use rosForShopNum directly —
    // it's exact, uses the per-shop RO cache, and avoids any shopId-injection
    // ambiguity from the chain fetch. For all-shops we fetch chain-wide and
    // also fan out per-shop payloads in the background so switching shops is
    // instant on the next request.
    // Build a set of shopIds that were open during a given window start date.
    // This prevents pre-opening data (e.g. prior-business data in a Tekmetric
    // shop ID before Mango took over) from polluting YoY comparison periods.
    const shopOpenMs = (shopNum: ShopNum) => {
      const s = SHOP_BY_NUM[shopNum];
      return s?.openedAt ? new Date(s.openedAt).getTime() : 0;
    };
    const filterByOpenDate = (ros: RepairOrder[], windowStartISO: string) => {
      const wsMs = new Date(windowStartISO).getTime();
      // Build set of tekmetric IDs that were open by this window start
      const openIds = new Set(SHOPS.filter(s => !s.openedAt || new Date(s.openedAt).getTime() <= wsMs).flatMap(s => s.tekmetricIdSecondary ? [s.tekmetricId, s.tekmetricIdSecondary] : [s.tekmetricId]));
      return ros.filter(r => openIds.has(r.shopId));
    };

    const [currRaw, prevRaw] = await Promise.all([
      shopFilter === 'all'
        ? rosForChain({ startISO: currWindow.startISO, endISO: currWindow.endISO })
        : rosForShopNum(shopFilter, { startISO: currWindow.startISO, endISO: currWindow.endISO }),
      shopFilter === 'all'
        ? rosForChain({ startISO: prevWindow.startISO, endISO: prevWindow.endISO })
        : (() => {
            // For single shop, check if shop was open during comparison period
            const shop = SHOP_BY_NUM[shopFilter];
            const shopOpen = shop?.openedAt ? new Date(shop.openedAt).getTime() : 0;
            if (shopOpen > new Date(prevWindow.startISO).getTime()) {
              return Promise.resolve([] as RepairOrder[]); // shop didn't exist yet
            }
            return rosForShopNum(shopFilter, { startISO: prevWindow.startISO, endISO: prevWindow.endISO });
          })(),
    ]);
    // Filter out pre-opening data from chain fetches
    const curr = shopFilter === 'all' ? filterByOpenDate(currRaw, currWindow.startISO) : currRaw;
    const prev = shopFilter === 'all' ? filterByOpenDate(prevRaw, prevWindow.startISO) : prevRaw;

    // Merge live weekly snapshots (preferred) with the frozen backfill
    // (fallback) into one weekStart -> {conversion, rebook} chain-average map.
    const snaps = await metricSnapshotMap();
    const extras = loadExtras();
    const convRebookByWeek = new Map<string, { conversion: number | null; rebook: number | null }>();
    const allWeekKeys = new Set<string>([...snaps.keys(), ...extras.keys()]);
    for (const wk of allWeekKeys) {
      const snap = snaps.get(wk);
      const ex = extras.get(wk);
      convRebookByWeek.set(wk, {
        conversion: chainAvg(snap?.conversion) ?? chainAvg(ex?.conversion),
        rebook: chainAvg(snap?.rebook) ?? chainAvg(ex?.rebook),
      });
    }

    // CURRENT week: override with the live week-to-date caches and use the
    // SAME weighted chain rate the FBR leaderboard / Call Conversion sections
    // show — so "this week" matches the rest of the dashboard instead of the
    // staler, unweighted snapshot average.
    const thisWeek = startOfWeek(toZonedTime(new Date(), CHAIN_TZ), { weekStartsOn: 1 }).toISOString().slice(0, 10);
    let fwd = 0, elig = 0;
    for (const s of SHOPS) {
      const fb = await readCache<any>(fbrShopWtdKey(s.num));
      if (fb?.fbr) { fwd += fb.fbr.forwardBookedROs || 0; elig += fb.fbr.eligibleROs || 0; }
    }
    const br = await readCache<any>('booked_rate_week_to_date_strict');
    const liveConv = typeof br?.chain?.bookedRatePct === 'number' ? br.chain.bookedRatePct : null;
    const liveRebook = elig > 0 ? Math.round((fwd / elig) * 1000) / 10 : null;
    const existing = convRebookByWeek.get(thisWeek) || { conversion: null, rebook: null };
    convRebookByWeek.set(thisWeek, {
      conversion: liveConv ?? existing.conversion,
      rebook: liveRebook ?? existing.rebook,
    });

    // Conversion / Re-Book snapshots are chain averages — meaningless for a
    // single-shop filter. Pass an empty map so those columns show null.
    const emptyMap = new Map<string, { conversion: number | null; rebook: number | null }>();

    // Build the payload from the ROs we just fetched (chain or single-shop).
    const crMap = shopFilter === 'all' ? convRebookByWeek : emptyMap;
    const payload = {
      current: buildPeriod(curr, currWindow.label, crMap, granularity),
      comparison: buildPeriod(prev, prevWindow.label, crMap, granularity),
      granularity,
      shop: shopFilter,
    };

    // Cache the result under respKey so subsequent requests are instant.
    await writeCache(respKey, payload);

    // ── All-shops fan-out — pre-warm per-shop caches in the background ────
    // When shopFilter === 'all', curr + prev contain all shops' ROs. Fan out
    // per-shop payloads now so switching to a single shop is instant next time.
    // shopId is guaranteed on every RO via the stamp in fetchAllRepairOrders.
    if (shopFilter === 'all') {
      Promise.all(SHOPS.map(async (s) => {
        const shopKey = `pc_v4_${granularity}_${s.num}_${range}_${compMode}_${start || ''}_${end || ''}_${compStart || ''}_${compEnd || ''}`;
        if (await isFresh(shopKey, PC_FRESH_MS)) return;
        const shopIds = new Set([s.tekmetricId, ...(s.tekmetricIdSecondary ? [s.tekmetricIdSecondary] : [])]);
        const shopCurr = curr.filter((r) => shopIds.has(r.shopId));
        const shopPrev = prev.filter((r) => shopIds.has(r.shopId));
        await writeCache(shopKey, {
          current: buildPeriod(shopCurr, currWindow.label, emptyMap, granularity),
          comparison: buildPeriod(shopPrev, prevWindow.label, emptyMap, granularity),
          granularity, shop: s.num,
        });
      })).catch(() => {});
    }

    return NextResponse.json(await patchCurrentWeekLive(payload));
  } catch (e: any) {
    console.error('[period-comparison] failed:', e);
    const stale = await readCache<any>(respKey);
    if (stale) return NextResponse.json({ ...(await patchCurrentWeekLive(stale)), stale: true });
    return NextResponse.json({ error: 'period comparison unavailable' }, { status: 500 });
  }
}

// Overwrite the current week's chain Re-Book/Conversion in the `current`
// period with the live week-to-date caches — the SAME weighted chain rate the
// Employee view shows — and refresh current.totals to match. Runs on every
// request (cache hit or fresh) so "this week" never lags the Employee view.
async function patchCurrentWeekLive(payload: any) {
  try {
    const weeks = payload?.current?.weeks;
    if (!Array.isArray(weeks) || !weeks.length) return payload;
    const curWk = startOfWeek(toZonedTime(new Date(), CHAIN_TZ), { weekStartsOn: 1 }).toISOString().slice(0, 10);
    const bucket = weeks.find((w: any) => w.weekStart === curWk);
    if (!bucket) return payload;
    let fwd = 0, elig = 0;
    for (const s of SHOPS) {
      const fb = await readCache<any>(fbrShopWtdKey(s.num));
      if (fb?.fbr) { fwd += fb.fbr.forwardBookedROs || 0; elig += fb.fbr.eligibleROs || 0; }
    }
    const br = await readCache<any>('booked_rate_week_to_date_strict');
    if (elig > 0) bucket.rebook = Math.round((fwd / elig) * 1000) / 10;
    if (typeof br?.chain?.bookedRatePct === 'number') bucket.conversion = br.chain.bookedRatePct;
    // Recompute the period totals' conversion/rebook as the mean of the
    // (now-patched) weekly values so the totals card agrees with the chart.
    const t = payload.current.totals;
    if (t) {
      const cv = weeks.map((w: any) => w.conversion).filter((v: any) => v != null);
      const rb = weeks.map((w: any) => w.rebook).filter((v: any) => v != null);
      t.conversion = cv.length ? Math.round((cv.reduce((s: number, v: number) => s + v, 0) / cv.length) * 10) / 10 : null;
      t.rebook = rb.length ? Math.round((rb.reduce((s: number, v: number) => s + v, 0) / rb.length) * 10) / 10 : null;
    }
  } catch { /* best-effort overlay */ }
  return payload;
}
