// Shop Performance Heatmap: returns every shop's KPIs broken down by week,
// for the last N weeks. Frontend picks which metric to display.

import { NextRequest, NextResponse } from 'next/server';
import { rosForChain } from '@/lib/dataAccess';
import { chainKpi } from '@/lib/metrics';
import { SHOPS } from '@/lib/shops';
import { TEKMETRIC_REPORT_TZ } from '@/lib/dates';
import { isFresh, readCache, writeCache } from '@/lib/cache';
import { addDays, startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { getRole } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';
const RESULT_FRESH_MS = 4 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const weeks = Math.max(1, Math.min(26, Number(req.nextUrl.searchParams.get('weeks') || 12)));
  const cacheKey = `heatmap_${weeks}w`;
  // Stale-while-revalidate: if any cache exists, return it instantly.
  const cached = await readCache(cacheKey);
  if (cached) {
    if (!(await isFresh(cacheKey, RESULT_FRESH_MS))) {
      compute(weeks, cacheKey).catch(e => console.error('[heatmap] background refresh failed:', e));
    }
    return NextResponse.json(cached);
  }
  try {
    const data = await compute(weeks, cacheKey);
    return NextResponse.json(data);
  } catch (e: any) {
    console.error('[shop-performance-heatmap] failed:', e);
    return NextResponse.json({ error: e?.message || 'heatmap failed' }, { status: 500 });
  }
}

async function compute(weeks: number, cacheKey: string) {
  const nowMtn = toZonedTime(new Date(), TEKMETRIC_REPORT_TZ);
  const thisWeekStart = startOfWeek(nowMtn, { weekStartsOn: 1 });
  const weekStarts: string[] = [];
  const shopCols: Record<string, Record<string, any>> = {};
  for (const s of SHOPS) shopCols[s.num] = {};

  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDays(thisWeekStart, -7 * i);
    const we = addDays(ws, 6);
    const wsISO = fromZonedTime(ws, TEKMETRIC_REPORT_TZ).toISOString();
    const weISO = fromZonedTime(we, TEKMETRIC_REPORT_TZ).toISOString();
    const wkLabel = ws.toISOString().slice(0, 10);
    weekStarts.push(wkLabel);
    const ros = await rosForChain({ startISO: wsISO, endISO: weISO });
    const kpi = chainKpi(ros);
    const byNum = new Map(kpi.byShop.map(s => [s.shopNum, s]));
    for (const s of SHOPS) {
      const k = byNum.get(s.num);
      shopCols[s.num][wkLabel] = k ? {
        revenue: k.revenue, cars: k.cars, aro: k.aro, closeRate: k.closeRate,
        gpDollars: k.gpDollars, gpPct: k.gpPct, partsGpPct: k.partsGpPct,
        laborGpPct: k.laborGpPct, discounts: k.discounts,
      } : null;
    }
  }
  const payload = {
    weeks: weekStarts,
    shops: SHOPS.map(s => ({ shopNum: s.num, shopName: s.name, cells: weekStarts.map(w => shopCols[s.num][w]) })),
  };
  await writeCache(cacheKey, payload);
  return payload;
}
