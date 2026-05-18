import { NextRequest, NextResponse } from 'next/server';
import { customRange, resolveRange, RangeKey } from '@/lib/dates';
import { rosForChain, rosForShopNum } from '@/lib/dataAccess';
import { opportunity } from '@/lib/metrics';
import { ShopNum, SHOP_BY_NUM } from '@/lib/shops';
import { getRole } from '@/lib/serverAuth';

// Executive-only handler. The route wrapper does the role check before calling.
export async function handle(req: NextRequest) {
  const range = (req.nextUrl.searchParams.get('range') as RangeKey) || 'this_month';
  const shop = req.nextUrl.searchParams.get('shop') as ShopNum | 'all' | null;
  const target = parseFloat(req.nextUrl.searchParams.get('target') || '0.75');
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');
  const w = range === 'custom' && start && end ? customRange(start, end) : resolveRange(range);
  try {
    const ros = shop && shop !== 'all' && SHOP_BY_NUM[shop]
      ? await rosForShopNum(shop, w)
      : await rosForChain(w, { excludeSecondary: true });
    return NextResponse.json(opportunity(ros, target));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'opportunity failed' }, { status: 500 });
  }
}
