// Offline accuracy validation: walk-forward backtest of the forecasting engine
// against ACTUAL weekly revenue. Cache-only — it never calls Tekmetric (so it
// can run alongside the heatmap backfill). Weeks whose RO windows aren't
// already cached are skipped rather than fetched.
//
// Run: set -a; . ./.env.local; set +a; npx tsx scripts/backtestProjections.ts

import { existsSync } from 'fs';
import path from 'path';
import { rosForShop } from '../lib/dataAccess';
import { chainKpi, isCountedRO } from '../lib/metrics';
import { c2d } from '../lib/tekmetric';
import { SHOPS, SHOP_BY_TEKMETRIC_ID, isRampingShop } from '../lib/shops';
import { TEKMETRIC_REPORT_TZ } from '../lib/dates';
import { projectShop, backtestShop } from '../lib/forecast/engine';
import type { WeekPoint } from '../lib/forecast/history';
import { addDays, startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), 'data', 'cache');
const HUGE = Number.MAX_SAFE_INTEGER;
const WEEKS = 20;

function cacheKey(shopId: number, sISO: string, eISO: string) {
  return `ros_${shopId}_${sISO.slice(0, 10)}_${eISO.slice(0, 10)}`;
}

async function main() {
  const nowMtn = toZonedTime(new Date(), TEKMETRIC_REPORT_TZ);
  const thisWeekStart = startOfWeek(nowMtn, { weekStartsOn: 1 });
  const byShop = new Map<string, (WeekPoint | null)[]>();
  for (const s of SHOPS) byShop.set(s.num, []);
  const labels: string[] = [];

  for (let i = WEEKS; i >= 1; i--) {
    const ws = addDays(thisWeekStart, -7 * i);
    const we = addDays(ws, 6);
    const sISO = fromZonedTime(ws, TEKMETRIC_REPORT_TZ).toISOString();
    const eISO = fromZonedTime(we, TEKMETRIC_REPORT_TZ).toISOString();
    const wk = ws.toISOString().slice(0, 10);

    // Only use this week if EVERY shop's RO window is already on disk.
    const allCached = SHOPS.every((s) =>
      existsSync(path.join(CACHE_DIR, `${cacheKey(s.tekmetricId, sISO, eISO)}.json`)),
    );
    if (!allCached) { for (const s of SHOPS) byShop.get(s.num)!.push(null); continue; }
    labels.push(wk);

    const ros: any[] = [];
    for (const s of SHOPS) ros.push(...(await rosForShop(s.tekmetricId, { startISO: sISO, endISO: eISO }, HUGE)));
    const kpi = chainKpi(ros);
    const m = new Map(kpi.byShop.map((x) => [x.shopNum, x]));
    const hrs: Record<string, number> = {};
    for (const s of SHOPS) hrs[s.num] = 0;
    for (const o of ros) {
      if (!isCountedRO(o)) continue;
      const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
      if (!meta) continue;
      for (const j of o.jobs || []) if (j.authorized) hrs[meta.num] += j.laborHours || 0;
    }
    for (const s of SHOPS) {
      const k = m.get(s.num);
      byShop.get(s.num)!.push(k ? {
        weekStart: wk, revenue: k.revenue, cars: k.cars, aro: k.aro, closeRate: k.closeRate,
        gpDollars: k.gpDollars, gpPct: k.gpPct, comebacks: 0,
        billedHours: Math.round(hrs[s.num] * 10) / 10, rebook: null, conversion: null,
      } : null);
    }
  }

  console.log(`\nCache-only walk-forward backtest — ${labels.length} usable weeks of actuals\n`);
  console.log('Shop          Wks  MAPE   Sample predictions (proj → actual)');
  console.log('─'.repeat(78));
  let wSum = 0, wErr = 0;
  for (const s of SHOPS) {
    const pts = byShop.get(s.num)!.filter((p): p is WeekPoint => !!p);
    const ramping = isRampingShop(s, new Date());
    const bt = backtestShop(s.num, s.name, s.district, byShop.get(s.num)!, ramping);
    // 3 illustrative point predictions (train on weeks before, predict that week)
    const samples: string[] = [];
    for (let k = Math.min(3, Math.max(0, pts.length - 7)); k >= 1; k--) {
      const cut = pts.length - k;
      if (cut < 6) continue;
      const proj = projectShop({
        shopNum: s.num, shopName: s.name, district: s.district,
        history: pts.slice(0, cut),
        period: { key: 'this_week', label: 'This week', workingDaysTotal: 5, workingDaysElapsed: 0, isFuture: true },
        actuals: { revenue: 0, cars: 0, gpDollars: 0, billedHours: 0 },
        goalRevenue: null, isRamping: ramping,
      });
      const act = pts[cut].revenue;
      samples.push(`$${Math.round(proj.expected / 1000)}k→$${Math.round(act / 1000)}k`);
    }
    const exp = pts.length ? pts[pts.length - 1].revenue : 0;
    wSum += exp; wErr += bt.mape * exp;
    console.log(
      `${s.name.padEnd(13)} ${String(bt.weeksTested).padStart(3)}  ${(bt.mape.toFixed(1) + '%').padStart(6)}  ${samples.join('  ') || '—'}`,
    );
  }
  console.log('─'.repeat(78));
  console.log(`Revenue-weighted portfolio MAPE: ${wSum ? (wErr / wSum).toFixed(1) : '—'}%\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
