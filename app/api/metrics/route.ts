import { NextRequest, NextResponse } from 'next/server';
import { ComparisonMode, customRange, resolveComparisonRange, resolveRange, RangeKey } from '@/lib/dates';
import { rosForChain, rosForShopNum } from '@/lib/dataAccess';
import { chainKpi, dailyByShop, dailySeries } from '@/lib/metrics';
import { ShopNum, SHOP_BY_NUM } from '@/lib/shops';

export const dynamic = 'force-dynamic';

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
  try {
    const ros =
      shop && shop !== 'all' && SHOP_BY_NUM[shop]
        ? await rosForShopNum(shop, w)
        : await rosForChain(w);

    const kpi = chainKpi(ros);
    const daily = dailySeries(ros);
    const perShop = dailyByShop(ros);
    return NextResponse.json({
      range,
      shop: shop || 'all',
      window: { startISO: w.startISO, endISO: w.endISO, label: w.label },
      kpi,
      daily,
      dailyByShop: perShop,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'metrics fetch failed' }, { status: 500 });
  }
}
