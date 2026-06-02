// Shop Performance Heatmap: returns every shop's KPIs broken down by week,
// for the last N weeks. Frontend picks which metric to display.

import { NextRequest, NextResponse } from 'next/server';
import { rosForChain } from '@/lib/dataAccess';
import { chainKpi, isCountedRO } from '@/lib/metrics';
import { c2d } from '@/lib/tekmetric';
import { SHOPS, SHOP_BY_TEKMETRIC_ID } from '@/lib/shops';
import { TEKMETRIC_REPORT_TZ } from '@/lib/dates';
import { isFresh, readCache, writeCache } from '@/lib/cache';
import { metricSnapshotMap } from '@/lib/metricSnapshots';
import { addDays, startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { getRole } from '@/lib/serverAuth';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// One-time historical backfill of weekly Re-Book % and Call-Conversion %
// (scripts/backfillHeatmapExtras.ts → data/heatmapExtras.json). Static, so it
// ships in the bundle and is read once per compute. -1 = a week that failed
// to compute (frontend treats it as no-data).
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

export const dynamic = 'force-dynamic';
const RESULT_FRESH_MS = 4 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const weeks = Math.max(1, Math.min(26, Number(req.nextUrl.searchParams.get('weeks') || 12)));
  // v4: comeback $ now uses (laborSales+partsSales)/hr to match the Comebacks
  // section exactly. Bump so stale cells recompute.
  const cacheKey = `heatmap_v4_${weeks}w`;
  // Stale-while-revalidate: if any cache exists, return it instantly.
  const cached = await readCache(cacheKey);
  if (cached) {
    if (!(await isFresh(cacheKey, RESULT_FRESH_MS))) {
      compute(weeks, cacheKey).catch(e => console.error('[heatmap] background refresh failed:', e));
    }
    // Always patch the CURRENT week's Re-Book/Conversion with the live WTD
    // caches before returning, even on a cache hit. The grid is cached 4h, but
    // the current week must match the Employee view (which reads these caches
    // live). Same source — no second computation.
    return NextResponse.json(await applyLiveCurrentWeek(cached));
  }
  try {
    const data = await compute(weeks, cacheKey);
    return NextResponse.json(await applyLiveCurrentWeek(data));
  } catch (e: any) {
    console.error('[shop-performance-heatmap] failed:', e);
    return NextResponse.json({ error: e?.message || 'heatmap failed' }, { status: 500 });
  }
}

// Overwrite the current week's per-shop Re-Book % and Call Conversion % with
// the live week-to-date caches — the EXACT values the Employee view's Re-Book
// leaderboard (fbr_shop_wtd_<num>) and Call Conversion section
// (booked_rate_week_to_date_strict) display. Keeps the two views in lockstep
// without recomputing anything. Cheap: ~9 KV reads.
async function applyLiveCurrentWeek(payload: any) {
  try {
    if (!payload?.weeks?.length || !Array.isArray(payload?.shops)) return payload;
    const nowMtn = toZonedTime(new Date(), TEKMETRIC_REPORT_TZ);
    const curWk = startOfWeek(nowMtn, { weekStartsOn: 1 }).toISOString().slice(0, 10);
    const idx = payload.weeks.indexOf(curWk);
    if (idx < 0) return payload;
    const rebook: Record<string, number> = {};
    for (const s of SHOPS) {
      const fb = await readCache<any>(`fbr_shop_wtd_${s.num}`);
      if (fb?.fbr && typeof fb.fbr.fbrPct === 'number') rebook[s.num] = Math.round(fb.fbr.fbrPct * 1000) / 10;
    }
    const conv: Record<string, number> = {};
    const br = await readCache<any>('booked_rate_week_to_date_strict');
    for (const sh of (br?.shops || [])) if (typeof sh.bookedRatePct === 'number') conv[sh.shopNum] = sh.bookedRatePct;
    for (const shop of payload.shops) {
      const cell = shop.cells?.[idx];
      if (!cell) continue;
      if (rebook[shop.shopNum] != null) cell.rebook = rebook[shop.shopNum];
      if (conv[shop.shopNum] != null) cell.conversion = conv[shop.shopNum];
    }
  } catch { /* best-effort overlay; fall through to cached values */ }
  return payload;
}

// Permanent per-week cache of the RO-derived cells. A CLOSED week's repair-
// order data never changes, so we compute it exactly once and store it
// forever — no TTL. Only the in-progress week is ever recomputed. This is the
// fix for "why recompute 12 weeks every 4 hours": closed weeks are now
// immutable, and on the Sun→Mon rollover the just-closed week gets computed
// once and frozen while a new current week begins.
const HM_WEEK_KEY = (wkLabel: string) => `hm_week_v2_${wkLabel}`;

// RO-derived per-shop cells for one week (revenue, GP, cars, comebacks $,
// billed hours). Re-Book/Conversion/Rating are layered on separately at
// assembly time because they come from snapshots/live caches, not ROs.
async function weekRoCells(wsISO: string, weISO: string): Promise<Record<string, any>> {
  const ros = await rosForChain({ startISO: wsISO, endISO: weISO });
  const kpi = chainKpi(ros);
  const byNum = new Map(kpi.byShop.map(s => [s.shopNum, s]));
  const cb: Record<string, number> = {};
  const cbHrs: Record<string, number> = {};
  const hrs: Record<string, number> = {};
  // laborSales + partsSales per shop — the EXACT numerator the Comebacks
  // section uses for revenue-per-hour (NOT full ex-tax revenue, which also
  // includes sublet + fees and made the heatmap's comeback $ slightly off).
  const lp: Record<string, number> = {};
  for (const s of SHOPS) { cb[s.num] = 0; cbHrs[s.num] = 0; hrs[s.num] = 0; lp[s.num] = 0; }
  for (const o of ros) {
    if (!isCountedRO(o)) continue;
    const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
    if (!meta) continue;
    lp[meta.num] = (lp[meta.num] ?? 0) + c2d(o.laborSales) + c2d(o.partsSales);
    for (const j of o.jobs || []) {
      const h = j.laborHours || 0;
      if (j.authorized) hrs[meta.num] = (hrs[meta.num] ?? 0) + h;
      const isReins = /re-?inspect|reins/i.test(j.jobCategoryName || '');
      const charge = c2d(j.subtotal || 0);
      if (isReins || (j.authorized && h >= 0.25 && charge <= 20)) {
        cb[meta.num] = (cb[meta.num] ?? 0) + 1;
        cbHrs[meta.num] = (cbHrs[meta.num] ?? 0) + h;
      }
    }
  }
  const out: Record<string, any> = {};
  for (const s of SHOPS) {
    const k = byNum.get(s.num);
    if (!k) { out[s.num] = null; continue; }
    const billed = hrs[s.num] ?? 0;
    const revPerHr = billed > 0 ? (lp[s.num] ?? 0) / billed : 0;
    out[s.num] = {
      revenue: k.revenue, cars: k.cars, aro: k.aro, closeRate: k.closeRate,
      gpDollars: k.gpDollars, gpPct: k.gpPct, partsGpPct: k.partsGpPct,
      laborGpPct: k.laborGpPct, discounts: k.discounts,
      comebacks: cb[s.num] ?? 0, comebackDollars: Math.round((cbHrs[s.num] ?? 0) * revPerHr),
      billedHours: Math.round(billed * 10) / 10,
    };
  }
  return out;
}

async function compute(weeks: number, cacheKey: string) {
  const nowMtn = toZonedTime(new Date(), TEKMETRIC_REPORT_TZ);
  const thisWeekStart = startOfWeek(nowMtn, { weekStartsOn: 1 });
  const currentWeekLabel = thisWeekStart.toISOString().slice(0, 10);
  const weekStarts: string[] = [];
  const shopCols: Record<string, Record<string, any>> = {};
  for (const s of SHOPS) shopCols[s.num] = {};
  const extras = loadExtras();
  const snaps = await metricSnapshotMap();

  // Current-week live Re-Book/Conversion from the WTD caches (matches the
  // Employee view). applyLiveCurrentWeek re-patches these on every request too.
  const liveRebook: Record<string, number> = {};
  const liveConv: Record<string, number> = {};
  try {
    for (const s of SHOPS) {
      const fb = await readCache<any>(`fbr_shop_wtd_${s.num}`);
      if (fb?.fbr) liveRebook[s.num] = Math.round((fb.fbr.fbrPct ?? 0) * 1000) / 10;
    }
    const br = await readCache<any>('booked_rate_week_to_date_strict');
    for (const sh of (br?.shops || [])) liveConv[sh.shopNum] = sh.bookedRatePct;
  } catch { /* live caches optional */ }

  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDays(thisWeekStart, -7 * i);
    const we = addDays(ws, 6);
    const wkLabel = ws.toISOString().slice(0, 10);
    weekStarts.push(wkLabel);
    const isCurrentWeek = wkLabel === currentWeekLabel;

    // CLOSED week → permanent cache (compute once, reuse forever).
    // CURRENT week → always recompute fresh.
    let roCells: Record<string, any> | null = null;
    if (!isCurrentWeek) roCells = await readCache<Record<string, any>>(HM_WEEK_KEY(wkLabel));
    if (!roCells) {
      const wsISO = fromZonedTime(ws, TEKMETRIC_REPORT_TZ).toISOString();
      const weISO = fromZonedTime(we, TEKMETRIC_REPORT_TZ).toISOString();
      roCells = await weekRoCells(wsISO, weISO);
      if (!isCurrentWeek) await writeCache(HM_WEEK_KEY(wkLabel), roCells); // permanent, no TTL
    }

    const ex = extras.get(wkLabel);
    const snap = snaps.get(wkLabel);
    for (const s of SHOPS) {
      const ro = roCells[s.num];
      if (!ro) { shopCols[s.num][wkLabel] = null; continue; }
      // Source priority for the three "can't-reconstruct" metrics:
      //   current week → live WTD cache, then snapshot, then frozen extras
      //   past weeks   → snapshot, then frozen extras
      const rebook = isCurrentWeek
        ? (liveRebook[s.num] ?? snap?.rebook?.[s.num] ?? ex?.rebook?.[s.num])
        : (snap?.rebook?.[s.num] ?? ex?.rebook?.[s.num]);
      const conversion = isCurrentWeek
        ? (liveConv[s.num] ?? snap?.conversion?.[s.num] ?? ex?.conversion?.[s.num])
        : (snap?.conversion?.[s.num] ?? ex?.conversion?.[s.num]);
      const rating = snap?.rating?.[s.num];
      shopCols[s.num][wkLabel] = { ...ro, rebook, conversion, rating };
    }
  }
  const payload = {
    weeks: weekStarts,
    shops: SHOPS.map(s => ({ shopNum: s.num, shopName: s.name, cells: weekStarts.map(w => shopCols[s.num][w]) })),
  };
  await writeCache(cacheKey, payload);
  return payload;
}
