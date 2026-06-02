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
export const maxDuration = 60; // allow the cold 8-shop compute room to finish
const RESULT_FRESH_MS = 4 * 60 * 60 * 1000; // 4 hours - matches typical cron cadence

// Per-shop cache key, written one-shop-per-tick by the warm-fbr cron job.
// Inlined (not imported from syncJobs) so this function's bundle stays free of
// the Anthropic SDK that syncJobs pulls in.
const fbrShopKey = (num: string) => `fbr_shop_${num}`;
// Mon→today subset, written alongside the trailing-7 cache by the same cron.
// Trophies read this view; everything else continues reading the trailing-7
// cache so existing behavior is unchanged.
const fbrShopWtdKey = (num: string) => `fbr_shop_wtd_${num}`;

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get('view') || 'leaderboard';

  if (view === 'leaderboard' || view === 'leaderboard_wtd') {
    const keyFn = view === 'leaderboard_wtd' ? fbrShopWtdKey : fbrShopKey;
    // Assemble from the durable per-shop caches the cron warms round-robin.
    // Never does the heavy 8-shop appointment burst itself (that 429s), so it
    // returns instantly and shows partial data rather than all-or-nothing.
    const raw = await Promise.all(SHOPS.map(s => readCache<any>(keyFn(s.num))));
    // ── stale-week sanitization (leaderboard_wtd only) ──────────────────
    // The WTD cache is refreshed round-robin every 15 min → ~2h to touch
    // all 8 shops. On a Monday morning the shops that haven't been hit yet
    // still hold LAST Mon→Sun's full-week WTD data, so the leaderboard
    // renders last week's numbers labeled as "This Week." Detect that by
    // comparing each shop's cached weekStart against the current calendar
    // week's Monday; if it predates this Monday, zero out the FBR so the
    // row reads correctly while we wait for the next round-robin refresh.
    let shops = raw.filter(Boolean);
    if (view === 'leaderboard_wtd') {
      const nowMtnWk = toZonedTime(new Date(), CHAIN_TZ);
      const thisMon = startOfWeek(nowMtnWk, { weekStartsOn: 1 });
      const thisMonISO = fromZonedTime(thisMon, CHAIN_TZ).toISOString();
      shops = shops.map((s: any) => {
        if (!s) return s;
        if (s.weekStart && s.weekStart < thisMonISO) {
          return {
            ...s,
            fbr: { eligibleROs: 0, forwardBookedROs: 0, fbrPct: 0, avgMonthsToRebook: null },
            weekStartStale: true,
          };
        }
        return s;
      });
    }
    if (shops.length === 0) {
      return NextResponse.json({
        view, warming: true, shops: [],
        note: view === 'leaderboard_wtd'
          ? 'Week-to-date Re-Book numbers populate as the FBR cron warms each shop (~one per cron tick).'
          : 'Re-Book numbers are being gathered (one shop per scheduled refresh). They will fill in over the next refresh cycles.',
      });
    }
    shops.sort((a, b) => (b.fbr?.fbrPct ?? 0) - (a.fbr?.fbrPct ?? 0));
    return NextResponse.json({
      view,
      partial: shops.length < SHOPS.length,
      shopsWarmed: shops.length,
      shopsTotal: SHOPS.length,
      shops,
    });
  }

  // Other views (heatmap) keep the original stale-while-revalidate path.
  const cacheKey = `fbr_${view}`;
  const cached = await readCache(cacheKey);
  if (cached) {
    if (!(await isFresh(cacheKey, RESULT_FRESH_MS))) {
      computeAndCache(view, cacheKey).catch(e => console.error('[fbr] background refresh failed:', e));
    }
    return NextResponse.json(cached);
  }
  try {
    const data = await computeAndCache(view, cacheKey);
    return NextResponse.json(data);
  } catch (e: any) {
    console.error('[fbr] cold compute failed:', e?.message || e);
    return NextResponse.json({ view, warming: true, shops: [] });
  }
}

async function computeAndCache(view: string, cacheKey: string) {
  const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
  const weekStart = startOfWeek(nowMtn, { weekStartsOn: 1 });

    if (view === 'leaderboard') {
      // Rolling last 7 days (week-to-date), so the section always reflects a
      // full week of activity regardless of what day it is — no Monday dip.
      const lastWeekStart = addDays(nowMtn, -7);
      const lastWeekEnd   = nowMtn;
      const wkStartISO = fromZonedTime(lastWeekStart, CHAIN_TZ).toISOString();
      const wkEndISO   = fromZonedTime(lastWeekEnd, CHAIN_TZ).toISOString();
      // Appointment horizon: 14 months past the window start
      const apptFromISO = wkStartISO;
      const apptToISO = fromZonedTime(addMonths(lastWeekStart, 6), CHAIN_TZ).toISOString();

      const results = [];
      for (const shop of SHOPS) {
        // Per-shop isolation: one shop rate-limiting must NOT zero out the whole
        // section. A failed shop returns zeros; the rest still load.
        try {
          const ros = await rosForShop(shop.tekmetricId, { startISO: wkStartISO, endISO: wkEndISO });
          const fleetByCust = new Map<number, 'RETAIL' | 'FLEET'>();
          const vehiclesPerCust = new Map<number, Set<number>>();
          for (const r of ros) {
            if (!r.customerId) continue;
            const s = vehiclesPerCust.get(r.customerId) ?? new Set();
            s.add(r.vehicleId);
            vehiclesPerCust.set(r.customerId, s);
          }
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
        } catch (e: any) {
          console.error(`[fbr] shop ${shop.num} failed:`, e?.message || e);
          results.push({
            shopNum: shop.num,
            shopName: shop.name,
            fbr: { eligibleROs: 0, forwardBookedROs: 0, fbrPct: 0 },
            kar: { expectedAppts: 0, keptAppts: 0, karPct: 0 },
            ramping: isRampingShop(shop, nowMtn),
          });
        }
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
            startTimeTo: fromZonedTime(addMonths(we, 6), CHAIN_TZ).toISOString(),
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
