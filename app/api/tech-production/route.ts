import { NextRequest, NextResponse } from 'next/server';
import { customRange, resolveRange, RangeKey, CHAIN_TZ } from '@/lib/dates';
import { rosForChain, rosForShopNum } from '@/lib/dataAccess';
import { techProduction } from '@/lib/metrics';
import { ShopNum, SHOP_BY_NUM } from '@/lib/shops';
import { displayName, getTechnicianNames } from '@/lib/technicians';
import { workingDaysBetween } from '@/lib/goals';
import { toZonedTime } from 'date-fns-tz';
import { readCache, writeCache, isFresh } from '@/lib/cache';

export const dynamic = 'force-dynamic';
// Serve from durable Redis so a refresh doesn't recompute (Tech Production +
// Trophy Tally + Quarter Tally all hit this). Cron keeps the ROs warm.
const TP_FRESH_MS = 20 * 60 * 1000;

export async function GET(req: NextRequest) {
  const range = (req.nextUrl.searchParams.get('range') as RangeKey) || 'this_week';
  const shop = req.nextUrl.searchParams.get('shop') as ShopNum | 'all' | null;
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');
  const w = range === 'custom' && start && end ? customRange(start, end) : resolveRange(range);
  const cacheable = !(range === 'custom');
  // Bumped tp_ → tp_v2_ when the efficiency denominator switched from a flat
  // 42.5 to elapsed-working-days scaling, so stale full-week-denominator
  // values don't linger for 20 min after deploy.
  const respKey = cacheable ? `tp_v2_${range}_${shop || 'all'}` : null;
  if (respKey && (await isFresh(respKey, TP_FRESH_MS))) {
    const cached = await readCache<any>(respKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });
  }
  try {
    const ros = shop && shop !== 'all' && SHOP_BY_NUM[shop]
      ? await rosForShopNum(shop, w)
      : await rosForChain(w);
    // 100% efficiency = 8.5 billable hours per WORKING DAY in the window
    // (42.5 hrs / 5-day week). The denominator scales with elapsed working
    // days — NOT a flat full-week 42.5 — so mid-week efficiency reflects
    // reality. On a Tuesday the this_week window divides by ~2 working days
    // (≈17 hrs), not 5 (42.5), which is why crowns were impossible until
    // Friday before this fix. A rolling 7-day window always spans exactly
    // 5 working days → resolves back to 42.5, unchanged.
    const HOURS_PER_WORKING_DAY = 42.5 / 5; // 8.5
    const startMt = toZonedTime(new Date(w.startISO), CHAIN_TZ);
    const endMt = toZonedTime(new Date(w.endISO), CHAIN_TZ);
    const workingDays = Math.max(1, workingDaysBetween(startMt, endMt));
    const workingHours = workingDays * HOURS_PER_WORKING_DAY;
    const rows = techProduction(ros, workingHours);
    // Attach human-readable names from /employees (cached 24h so this is fast).
    const names = await getTechnicianNames().catch(() => ({} as Record<string, any>));
    const rowsWithNames = rows.map(r => ({ ...r, techName: displayName(r.technicianId, names) }));
    const payload = { rows: rowsWithNames, workingHours, windowLabel: w.label };
    if (respKey) await writeCache(respKey, payload);
    return NextResponse.json(payload);
  } catch (e: any) {
    console.error('[tech-production] failed:', e);
    if (respKey) {
      const stale = await readCache<any>(respKey);
      if (stale) return NextResponse.json({ ...stale, stale: true });
    }
    return NextResponse.json({ error: e?.message || 'tech production failed' }, { status: 500 });
  }
}
