// Weekly per-shop KPI history — the training substrate for the forecasting
// engine. One row per completed ISO week (Mon→Sun) per shop, plus the two
// Claude/Tekmetric leading indicators from the one-time backfill
// (data/heatmapExtras.json): Re-Book % and Call-Conversion %.
//
// This is intentionally the SAME weekly computation the Shop Performance
// Heatmap uses, so the forecaster and the heatmap can never disagree. ROs are
// pulled through dataAccess (per shop+window cache, 30 min) so asking for many
// weeks does not hammer Tekmetric — recent weeks are already cron-warmed.

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { rosForChain } from '@/lib/dataAccess';
import { chainKpi, isCountedRO } from '@/lib/metrics';
import { c2d } from '@/lib/tekmetric';
import { SHOPS, SHOP_BY_TEKMETRIC_ID, ShopNum } from '@/lib/shops';
import { TEKMETRIC_REPORT_TZ } from '@/lib/dates';
import { readCache } from '@/lib/cache';
import { addDays, startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export interface WeekPoint {
  weekStart: string;     // YYYY-MM-DD (Monday)
  revenue: number;       // ex-tax dollars
  cars: number;
  aro: number;
  closeRate: number;     // 0..1
  gpDollars: number;
  gpPct: number;         // 0..1
  comebacks: number;
  billedHours: number;
  rebook: number | null;      // 0..100, null = not tracked / failed week
  conversion: number | null;  // 0..100, null = not tracked / failed week
}

export interface ShopHistory {
  shopNum: ShopNum;
  shopName: string;
  // Oldest → newest. Weeks with no counted ROs for the shop are null (the
  // forecaster skips nulls but keeps the timeline aligned across shops).
  points: (WeekPoint | null)[];
}

export interface WeeklyHistory {
  weeks: string[];        // aligned week labels, oldest → newest
  shops: ShopHistory[];
}

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

function extra(v: number | undefined): number | null {
  // Backfill writes -1 for a week that failed to compute.
  return v == null || v < 0 ? null : v;
}

/**
 * Instant, ZERO-network history: derive the weekly series from an already
 * cached Shop-Performance-Heatmap payload (the heatmap component warms
 * `heatmap_12w` on every dashboard load). The heatmap's last column is the
 * in-progress week, so it is dropped — every row here is a completed week.
 * Returns null if no heatmap cache exists yet.
 */
export async function weeklyHistoryFromHeatmapCache(): Promise<WeeklyHistory | null> {
  for (const key of ['heatmap_26w', 'heatmap_20w', 'heatmap_16w', 'heatmap_12w']) {
    const hm = await readCache<{ weeks: string[]; shops: { shopNum: string; cells: (any | null)[] }[] }>(key);
    if (!hm?.weeks?.length || !hm.shops?.length) continue;
    const completed = hm.weeks.slice(0, -1); // drop in-progress current week
    if (!completed.length) continue;
    const cellByShop = new Map(hm.shops.map((s) => [s.shopNum, s.cells]));
    return {
      weeks: completed,
      shops: SHOPS.map((s) => {
        const cells = cellByShop.get(s.num) || [];
        return {
          shopNum: s.num,
          shopName: s.name,
          points: completed.map((wk, i) => {
            const c = cells[i];
            if (!c) return null;
            return {
              weekStart: wk,
              revenue: c.revenue, cars: c.cars, aro: c.aro, closeRate: c.closeRate,
              gpDollars: c.gpDollars, gpPct: c.gpPct,
              comebacks: c.comebacks ?? 0, billedHours: c.billedHours ?? 0,
              rebook: extra(c.rebook), conversion: extra(c.conversion),
            } as WeekPoint;
          }),
        };
      }),
    };
  }
  return null;
}

/**
 * Build `weeks` COMPLETED ISO weeks of per-shop KPI history, ending with the
 * most recently completed week (the in-progress current week is excluded so
 * every training row is a full week).
 */
export async function weeklyShopHistory(weeks: number): Promise<WeeklyHistory> {
  const nowMtn = toZonedTime(new Date(), TEKMETRIC_REPORT_TZ);
  const thisWeekStart = startOfWeek(nowMtn, { weekStartsOn: 1 });
  const extras = loadExtras();
  const weekStarts: string[] = [];
  const cols: Record<string, Record<string, WeekPoint | null>> = {};
  for (const s of SHOPS) cols[s.num] = {};

  // i = weeks .. 1  → fully completed weeks only (i=0 is the in-progress week).
  for (let i = weeks; i >= 1; i--) {
    const ws = addDays(thisWeekStart, -7 * i);
    const we = addDays(ws, 6);
    const wsISO = fromZonedTime(ws, TEKMETRIC_REPORT_TZ).toISOString();
    const weISO = fromZonedTime(we, TEKMETRIC_REPORT_TZ).toISOString();
    const wkLabel = ws.toISOString().slice(0, 10);
    weekStarts.push(wkLabel);

    const ros = await rosForChain({ startISO: wsISO, endISO: weISO });
    const kpi = chainKpi(ros);
    const byNum = new Map(kpi.byShop.map((s) => [s.shopNum, s]));
    const cb: Record<string, number> = {};
    const hrs: Record<string, number> = {};
    for (const s of SHOPS) { cb[s.num] = 0; hrs[s.num] = 0; }
    for (const o of ros) {
      if (!isCountedRO(o)) continue;
      const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
      if (!meta) continue;
      for (const j of o.jobs || []) {
        const h = j.laborHours || 0;
        if (j.authorized) hrs[meta.num] = (hrs[meta.num] ?? 0) + h;
        const isReins = /re-?inspect|reins/i.test(j.jobCategoryName || '');
        const charge = c2d(j.subtotal || 0);
        const heuristic = j.authorized && h >= 0.25 && charge <= 20;
        if (isReins || heuristic) cb[meta.num] = (cb[meta.num] ?? 0) + 1;
      }
    }
    const ex = extras.get(wkLabel);
    for (const s of SHOPS) {
      const k = byNum.get(s.num);
      cols[s.num][wkLabel] = k ? {
        weekStart: wkLabel,
        revenue: k.revenue, cars: k.cars, aro: k.aro, closeRate: k.closeRate,
        gpDollars: k.gpDollars, gpPct: k.gpPct,
        comebacks: cb[s.num] ?? 0,
        billedHours: Math.round((hrs[s.num] ?? 0) * 10) / 10,
        rebook: extra(ex?.rebook?.[s.num]),
        conversion: extra(ex?.conversion?.[s.num]),
      } : null;
    }
  }

  return {
    weeks: weekStarts,
    shops: SHOPS.map((s) => ({
      shopNum: s.num,
      shopName: s.name,
      points: weekStarts.map((w) => cols[s.num][w] ?? null),
    })),
  };
}
