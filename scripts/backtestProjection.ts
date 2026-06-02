// Revenue-projection backtest harness.
//
// For every completed 2026 week × shop, pulls ROs / appointments / calls ONCE
// and reconstructs the exact state that existed at each weekday checkpoint
// (using only records whose timestamp <= the checkpoint), alongside the known
// final weekly revenue. Persists a flat feature matrix to
// data/backtest_2026.json so weight-fitting / accuracy analysis can iterate
// WITHOUT re-hitting the rate-limited Tekmetric API. Resumable: weeks already
// in the file are skipped.
//
// No modeling assumptions are baked in here — this only records observed
// reality. The model is fit from this matrix in a separate analysis step.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fetchAllRepairOrders, fetchAllAppointments } from '../lib/tekmetric';
import { fetchAllLeads, isBookedBaseline, isEligibleCall } from '../lib/whatconverts';
import { SHOPS } from '../lib/shops';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfWeek, addDays } from 'date-fns';

const CHAIN_TZ = 'America/Denver';
const FILE = path.join(process.cwd(), 'data', 'backtest_2026.json');
const c2d = (c: number) => c / 100;
const COUNTED = new Set(['POSTED', 'ACCRECV']);
const EXCLUDED_CUST = new Set([41675365, 41674963]); // USPS post-office

// Checkpoints as (label, weekdayIndex Mon=0, hourMT)
const CHECKPOINTS: [string, number, number][] = [
  ['mon_am', 0, 9], ['mon_close', 0, 18],
  ['tue_close', 1, 18], ['wed_close', 2, 18],
  ['thu_close', 3, 18], ['fri_mid', 4, 12], ['fri_close', 4, 18],
];

interface Row {
  week: string; shop: string; checkpoint: string;
  cpISO: string;
  rev_so_far: number; cars_so_far: number; ro_so_far: number;
  gp_so_far_pct: number; aro_so_far: number;
  approved_unbilled: number;       // authorized job $ not yet posted as of cp
  booked_appts: number;            // appts created<=cp, start in (cp, weekEnd]
  calls_so_far: number; calls_booked_so_far: number;
  elapsed_biz_frac: number;        // position within Mon00→Fri18 business span
  y_final: number;                 // actual full-week ex-tax counted revenue
}

function exTax(o: any): number {
  return c2d(o.laborSales + o.partsSales + o.subletSales + o.feeTotal - o.discountTotal);
}
function counted(o: any): boolean {
  return COUNTED.has(o.repairOrderStatus?.code) && !EXCLUDED_CUST.has(o.customerId);
}

function completedWeeks(): { weekStart: string; mon: Date; sun: Date }[] {
  const out: { weekStart: string; mon: Date; sun: Date }[] = [];
  const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
  let mon = startOfWeek(new Date(Date.UTC(2026, 0, 5)), { weekStartsOn: 1 }); // first full 2026 wk
  while (true) {
    const sun = addDays(mon, 6);
    if (sun >= nowMtn) break; // only fully completed weeks
    out.push({ weekStart: mon.toISOString().slice(0, 10), mon: new Date(mon), sun });
    mon = addDays(mon, 7);
  }
  return out;
}

function load(): Row[] {
  if (existsSync(FILE)) { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch {} }
  return [];
}
function save(rows: Row[]) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(rows));
}

async function main() {
  const weeks = completedWeeks();
  const rows = load();
  const done = new Set(rows.map(r => `${r.week}|${r.shop}`));
  console.log(`[bt] ${weeks.length} completed 2026 weeks, ${SHOPS.length} shops; ${done.size} shop-weeks already done`);

  for (const w of weeks) {
    const mon = w.mon, sun = w.sun;
    const wkStartISO = fromZonedTime(mon, CHAIN_TZ).toISOString();
    const wkEndISO = fromZonedTime(addDays(mon, 7), CHAIN_TZ).toISOString(); // exclusive Sun 24:00
    for (const shop of SHOPS) {
      const key = `${w.weekStart}|${shop.num}`;
      if (done.has(key)) continue;
      try {
        const ros = await fetchAllRepairOrders({ shopId: shop.tekmetricId, postedDateStart: wkStartISO, postedDateEnd: wkEndISO });
        const cRos = ros.filter(counted);
        const yFinal = cRos.reduce((s, o) => s + exTax(o), 0);
        // appointments whose start is within the week
        let appts: any[] = [];
        try {
          appts = await fetchAllAppointments({ shopId: shop.tekmetricId, startTimeFrom: wkStartISO, startTimeTo: wkEndISO });
        } catch {}
        // calls for the week
        let leads: any[] = [];
        try {
          leads = await fetchAllLeads({ shop: shop.num as any, startDate: w.weekStart, endDate: addDays(mon, 6).toISOString().slice(0, 10) });
        } catch {}

        for (const [label, wdIdx, hr] of CHECKPOINTS) {
          const cpLocal = new Date(mon); cpLocal.setDate(cpLocal.getDate() + wdIdx);
          cpLocal.setHours(hr, 0, 0, 0);
          const cp = fromZonedTime(cpLocal, CHAIN_TZ);
          const cpMs = cp.getTime();
          // revenue/cars/etc so far: ROs posted on/before cp
          const soFar = cRos.filter(o => o.postedDate && new Date(o.postedDate).getTime() <= cpMs);
          const rev = soFar.reduce((s, o) => s + exTax(o), 0);
          const cars = soFar.length;
          const partsCost = soFar.reduce((s, o) => s + c2d((o.jobs || []).reduce((a: number, j: any) => a + (j.parts || []).reduce((p: number, x: any) => p + (x.cost || 0) * (x.quantity || 0), 0), 0)), 0);
          const gpPct = rev > 0 ? (rev - partsCost) / rev : 0;
          // approved but not yet billed as of cp: authorized jobs whose authorizedDate<=cp on ROs not posted by cp
          let approvedUnbilled = 0;
          for (const o of ros) {
            const postedMs = o.postedDate ? new Date(o.postedDate).getTime() : Infinity;
            if (postedMs <= cpMs) continue; // already counted in rev
            for (const j of (o.jobs || [])) {
              if (j.authorized && j.authorizedDate && new Date(j.authorizedDate).getTime() <= cpMs) {
                approvedUnbilled += c2d(j.subtotal || 0);
              }
            }
          }
          const bookedAppts = appts.filter(a => a.createdDate && a.startTime &&
            new Date(a.createdDate).getTime() <= cpMs &&
            new Date(a.startTime).getTime() > cpMs &&
            new Date(a.startTime).getTime() <= fromZonedTime(addDays(mon, 7), CHAIN_TZ).getTime()).length;
          const callsSoFar = leads.filter(l => l.date_created && new Date(l.date_created).getTime() <= cpMs);
          const callsBooked = callsSoFar.filter(isBookedBaseline).length;
          const bizStart = fromZonedTime(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 0, 0, 0), CHAIN_TZ).getTime();
          const friClose = (() => { const d = new Date(mon); d.setDate(d.getDate() + 4); d.setHours(18, 0, 0, 0); return fromZonedTime(d, CHAIN_TZ).getTime(); })();
          const elapsed = Math.max(0, Math.min(1, (cpMs - bizStart) / (friClose - bizStart)));

          rows.push({
            week: w.weekStart, shop: shop.num, checkpoint: label, cpISO: cp.toISOString(),
            rev_so_far: Math.round(rev), cars_so_far: cars, ro_so_far: cars,
            gp_so_far_pct: Math.round(gpPct * 1000) / 10, aro_so_far: cars ? Math.round(rev / cars) : 0,
            approved_unbilled: Math.round(approvedUnbilled),
            booked_appts: bookedAppts,
            calls_so_far: callsSoFar.length, calls_booked_so_far: callsBooked,
            elapsed_biz_frac: Math.round(elapsed * 1000) / 1000,
            y_final: Math.round(yFinal),
          });
        }
        done.add(key);
        save(rows);
        const total = weeks.length * SHOPS.length;
        const pct = ((done.size / total) * 100).toFixed(1);
        const line = `[bt] progress ${done.size}/${total} (${pct}%) — ${w.weekStart} ${shop.num}: yFinal $${Math.round(yFinal).toLocaleString()} (ROs ${cRos.length}, appts ${appts.length}, calls ${leads.length})`;
        console.log(line);
        try { writeFileSync(path.join(process.cwd(), 'data', 'backtest_progress.txt'), `${new Date().toISOString()}\n${done.size}/${total} shop-weeks (${pct}%)\nlast: ${w.weekStart} ${shop.num}\n`); } catch {}
      } catch (e: any) {
        console.warn(`[bt] ${w.weekStart} ${shop.num} FAIL: ${e?.message}`);
      }
    }
  }
  console.log(`[bt] complete — ${rows.length} rows → ${FILE}`);
}
main().catch(e => { console.error(e); process.exit(1); });
