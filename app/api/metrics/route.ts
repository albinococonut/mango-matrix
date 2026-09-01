import { NextRequest, NextResponse } from 'next/server';
import { ComparisonMode, customRange, resolveComparisonRange, resolveRange, RangeKey } from '@/lib/dates';
import { rosForChain, rosForShopNum } from '@/lib/dataAccess';
import { chainKpi, dailyByShop, dailySeries } from '@/lib/metrics';
import { ShopNum, SHOP_BY_NUM } from '@/lib/shops';
import { readCache, writeCache, isFresh } from '@/lib/cache';

export const dynamic = 'force-dynamic';
// Serve the computed payload from durable Redis so a page refresh doesn't
// recompute/refetch (Shop Performance Comparison, KPI cards, Weekly Leaderboard,
// Review page all hit this). Comparison requests are not cached (range varies
// per comparison mode). Custom date ranges are cached by exact date strings.
const RESP_FRESH_MS = 20 * 60 * 1000;

export async function GET(req: NextRequest) {
  const range = (req.nextUrl.searchParams.get('range') as RangeKey) || 'this_month';
  const shop = req.nextUrl.searchParams.get('shop') as ShopNum | 'all' | null;
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');
  // Comparison overlay: caller can pass compare=previous_period|same_period_last_year + base=<RangeKey>
  // (with optional baseStart/baseEnd for a custom base). The route resolves the comparison range and
  // returns metrics over THAT window, so the client can overlay it.
  const compare = req.nextUrl.searchParams.get('compare') as ComparisonMode | null;
  const base = req.nextUrl.searchParams.get('base') as RangeKey | null;
  const baseStart = req.nextUrl.searchParams.get('baseStart');
  const baseEnd = req.nextUrl.searchParams.get('baseEnd');
  let w;
  if (compare && base) {
    const baseRange = base === 'custom' && baseStart && baseEnd
      ? customRange(baseStart, baseEnd)
      : resolveRange(base);
    w = resolveComparisonRange(baseRange, compare);
  } else if (range === 'custom' && start && end) {
    w = customRange(start, end);
  } else {
    w = resolveRange(range);
  }
  // Cacheable for all non-comparison requests. Custom ranges use the exact
  // date strings as the cache key so the same week boundary is only computed
  // once per 20-minute window instead of on every page load.
  const cacheable = !compare;
  const respKey = cacheable
    ? (range === 'custom' && start && end
      ? `metrics_custom_${start}_${end}_${shop || 'all'}`
      : `metrics_${range}_${shop || 'all'}`)
    : null;
  if (respKey) {
    const cached = await readCache<any>(respKey);
    if (cached && (await isFresh(respKey, RESP_FRESH_MS))) {
      return NextResponse.json({ ...cached, cached: true });
    }
  }
  try {
    const ros =
      shop && shop !== 'all' && SHOP_BY_NUM[shop]
        ? await rosForShopNum(shop, w)
        : await rosForChain(w);

    const kpi = chainKpi(ros);
    const daily = dailySeries(ros);
    const perShop = dailyByShop(ros);
    const payload = {
      range,
      shop: shop || 'all',
      window: { startISO: w.startISO, endISO: w.endISO, label: w.label },
      kpi,
      daily,
      dailyByShop: perShop,
    };
    if (respKey) await writeCache(respKey, payload);
    return NextResponse.json(payload);
  } catch (e: any) {
    // On compute failure, fall back to stale cache if we have any.
    if (respKey) {
      const stale = await readCache<any>(respKey);
      if (stale) return NextResponse.json({ ...stale, stale: true });
    }
    console.error('[metrics] failed:', e);
    return NextResponse.json({ error: 'metrics unavailable' }, { status: 500 });
  }
}
