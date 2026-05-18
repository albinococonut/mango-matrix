import { NextRequest, NextResponse } from 'next/server';
import { SHOPS, SHOP_BY_TEKMETRIC_ID, isRampingShop } from '@/lib/shops';
import { rosForShop } from '@/lib/dataAccess';
import { fetchAllAppointments } from '@/lib/tekmetric';
import { classifyFleet, hasForwardBookedAppt, isEligibleRO, shopFbr, shopKar } from '@/lib/fbr';
import { isFresh, readCache, writeCache } from '@/lib/cache';
import { addDays, addMonths, startOfWeek } from 'date-fns';
import { CHAIN_TZ } from '@/lib/dates';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export const dynamic = 'force-dynamic';
const RESULT_FRESH_MS = 4 * 60 * 60 * 1000; // 4 hours - matches typical cron cadence

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get('view') || 'leaderboard'; // leaderboard | heatmap_12w
  const cacheKey = `fbr_${view}`;
  // Stale-while-revalidate: if ANY cache exists, return it instantly. If it's also
  // older than RESULT_FRESH_MS, kick off a background recompute so the next caller
  // gets fresh data. Browsers never see the 4-min cold Tekmetric load.
  const cached = await readCache(cacheKey);
  if (cached) {
    if (!(await isFresh(cacheKey, RESULT_FRESH_MS))) {
      // Fire-and-forget — don't await. Errors here just mean the next call retries.
      computeAndCache(view, cacheKey).catch(e => console.error('[fbr] background refresh failed:', e));
    }
    return NextResponse.json(cached);
  }
  // No cache at all — must compute synchronously this one time.
  try {
    const data = await computeAndCache(view, cacheKey);
    return NextResponse.json(data);
  } catch (e: any) {
    console.error('[fbr] failed:', e);
    return NextResponse.json({ error: e?.message || 'fbr failed' }, { status: 500 });
  }
}

async function computeAndCache(view: string, cacheKey: string) {
  const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
  const weekStart = startOfWeek(nowMtn, { weekStartsOn: 1 });

    if (view === 'leaderboard') {
      // Show LAST full week (Mon-Sun) so the leaderboard reflects a complete
      // 7-day picture instead of partial week-to-date numbers.
      const lastWeekStart = addDays(weekStart, -7);
      const lastWeekEnd   = addDays(weekStart, 0); // exclusive end = this week's Monday
      const wkStartISO = fromZonedTime(lastWeekStart, CHAIN_TZ).toISOString();
      const wkEndISO   = fromZonedTime(lastWeekEnd, CHAIN_TZ).toISOString();
      // Appointment horizon: 14 months past last week's start
      const apptFromISO = wkStartISO;
      const apptToISO = fromZonedTime(addMonths(lastWeekStart, 14), CHAIN_TZ).toISOString();

      const results = [];
      for (const shop of SHOPS) {
        const ros = await rosForShop(shop.tekmetricId, { startISO: wkStartISO, endISO: wkEndISO });
        // Customer-level fleet classifier from RO data
        const fleetByCust = new Map<number, 'RETAIL' | 'FLEET'>();
        const vehiclesPerCust = new Map<number, Set<number>>();
        for (const r of ros) {
          if (!r.customerId) continue;
          const s = vehiclesPerCust.get(r.customerId) ?? new Set();
          s.add(r.vehicleId);
          vehiclesPerCust.set(r.customerId, s);
        }
        // We don't have customer name here without /customers endpoint — vehicle count rule only.
        // Customer name keyword rule kicks in once we wire /customers fetch; for now: vehicle-count + default.
        for (const [cid, vs] of vehiclesPerCust) {
          fleetByCust.set(cid, classifyFleet({ id: cid, fullName: '', vehicleCount: vs.size }));
        }
        const appts = await fetchAllAppointments({
          shopId: shop.tekmetricId,
          startTimeFrom: apptFromISO,
          startTimeTo: apptToISO,
        });
        const apptsByCust = new Map<number, typeof appts>();
        for (const a of appts) {
          if (!a.customerId) continue;
          const arr = apptsByCust.get(a.customerId) ?? [];
          arr.push(a);
          apptsByCust.set(a.customerId, arr);
        }
        const fbr = shopFbr(ros, fleetByCust, apptsByCust);
        const kar = shopKar(appts, ros);
        results.push({
          shopNum: shop.num,
          shopName: shop.name,
          fbr: fbr ?? { eligibleROs: 0, forwardBookedROs: 0, fbrPct: 0 },
          kar: kar ?? { expectedAppts: 0, keptAppts: 0, karPct: 0 },
          ramping: isRampingShop(shop, nowMtn),
        });
      }
      results.sort((a, b) => b.fbr.fbrPct - a.fbr.fbrPct);
      const payload = { view, weekStart: lastWeekStart.toISOString(), weekEnd: lastWeekEnd.toISOString(), shops: results };
      await writeCache(cacheKey, payload);
      return payload;
    }

    if (view === 'heatmap_12w') {
      const out: Array<{ shopNum: string; shopName: string; weeks: Array<{ weekStart: string; fbrPct: number }> }> = [];
      for (const shop of SHOPS) {
        const weeks: Array<{ weekStart: string; fbrPct: number }> = [];
        for (let i = 11; i >= 0; i--) {
          const ws = addDays(weekStart, -7 * i);
          const we = addDays(ws, 6);
          const ros = await rosForShop(shop.tekmetricId, {
            startISO: fromZonedTime(ws, CHAIN_TZ).toISOString(),
            endISO:   fromZonedTime(we, CHAIN_TZ).toISOString(),
          });
          const fleetByCust = new Map<number, 'RETAIL' | 'FLEET'>();
          const vc = new Map<number, Set<number>>();
          for (const r of ros) { const s = vc.get(r.customerId) ?? new Set(); s.add(r.vehicleId); vc.set(r.customerId, s); }
          for (const [cid, vs] of vc) fleetByCust.set(cid, classifyFleet({ id: cid, fullName: '', vehicleCount: vs.size }));
          const appts = await fetchAllAppointments({
            shopId: shop.tekmetricId,
            startTimeFrom: fromZonedTime(ws, CHAIN_TZ).toISOString(),
            startTimeTo: fromZonedTime(addMonths(we, 14), CHAIN_TZ).toISOString(),
          });
          const apptsByCust = new Map<number, typeof appts>();
          for (const a of appts) { if (!a.customerId) continue; const arr = apptsByCust.get(a.customerId) ?? []; arr.push(a); apptsByCust.set(a.customerId, arr); }
          const f = shopFbr(ros, fleetByCust, apptsByCust);
          weeks.push({ weekStart: ws.toISOString(), fbrPct: f?.fbrPct ?? 0 });
        }
        out.push({ shopNum: shop.num, shopName: shop.name, weeks });
      }
      const payload = { view, shops: out };
      await writeCache(cacheKey, payload);
      return payload;
    }

  throw new Error(`unknown view: ${view}`);
}
