import { NextRequest, NextResponse } from 'next/server';
import { customRange, resolveRange, RangeKey } from '@/lib/dates';
import { rosForChain, rosForShopNum } from '@/lib/dataAccess';
import { techProduction } from '@/lib/metrics';
import { workingDaysBetween } from '@/lib/goals';
import { ShopNum, SHOP_BY_NUM } from '@/lib/shops';
import { displayName, getTechnicianNames } from '@/lib/technicians';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const range = (req.nextUrl.searchParams.get('range') as RangeKey) || 'this_week';
  const shop = req.nextUrl.searchParams.get('shop') as ShopNum | 'all' | null;
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');
  const w = range === 'custom' && start && end ? customRange(start, end) : resolveRange(range);
  try {
    const ros = shop && shop !== 'all' && SHOP_BY_NUM[shop]
      ? await rosForShopNum(shop, w)
      : await rosForChain(w);
    // 100% efficiency = 8 hrs × working days in the window (Mon-Fri minus holidays).
    // For the current partial week/month/etc. the window already only covers elapsed
    // days, so workingDaysBetween naturally returns just the elapsed working days.
    const workingHours = workingDaysBetween(w.start, w.end) * 8;
    const rows = techProduction(ros, workingHours);
    // Attach human-readable names from /employees (cached 24h so this is fast).
    const names = await getTechnicianNames().catch(() => ({} as Record<string, any>));
    const rowsWithNames = rows.map(r => ({ ...r, techName: displayName(r.technicianId, names) }));
    return NextResponse.json({ rows: rowsWithNames, workingHours, windowLabel: w.label });
  } catch (e: any) {
    console.error('[tech-production] failed:', e);
    return NextResponse.json({ error: e?.message || 'tech production failed' }, { status: 500 });
  }
}
