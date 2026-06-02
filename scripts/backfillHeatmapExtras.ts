// One-time (resumable) backfill of weekly Re-Book % and Call-Conversion %
// per shop, from 2026-01-05. Heavy: Re-Book needs Tekmetric appointments,
// Conversion runs every eligible WhatConverts call through Claude. Resumable —
// re-runs skip weeks already written. Paced to be gentle on the APIs.
//
// Run: set -a; . ./.env.local; set +a; npx tsx scripts/backfillHeatmapExtras.ts
//
// (5★ reviews are intentionally NOT here — the GBP API is blocked, so there is
//  no historical weekly source. They light up once GBP access is approved.)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { rosForShop } from '../lib/dataAccess';
import { fetchAllAppointments } from '../lib/tekmetric';
import { classifyFleet, shopFbr } from '../lib/fbr';
import { fetchAllLeads, isEligibleCall } from '../lib/whatconverts';
import { classifyBatch } from '../lib/classify';
import { SHOPS } from '../lib/shops';
import { addMonths } from 'date-fns';

const FIRST = new Date(Date.UTC(2026, 0, 5)); // first Monday on/after 2026-01-01
const FILE = path.join(process.cwd(), 'data', 'heatmapExtras.json');

interface WeekExtra {
  weekStart: string; // YYYY-MM-DD
  rebook: Record<string, number>;      // shopNum -> fbr % (0..100)
  conversion: Record<string, number>;  // shopNum -> booked-rate % (0..100)
}

function mondays(): { wsISO: string; weISO: string; weekStart: string }[] {
  const out: { wsISO: string; weISO: string; weekStart: string }[] = [];
  const now = new Date();
  const cur = new Date(FIRST);
  while (cur < now) {
    const start = new Date(cur);
    const end = new Date(cur); end.setUTCDate(end.getUTCDate() + 7); // exclusive
    if (end > now) break; // completed weeks only
    out.push({ wsISO: start.toISOString(), weISO: end.toISOString(), weekStart: start.toISOString().slice(0, 10) });
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return out;
}

function load(): { generatedAt: string; weeks: WeekExtra[] } {
  if (existsSync(FILE)) { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch {} }
  return { generatedAt: new Date().toISOString(), weeks: [] };
}
function save(d: { generatedAt: string; weeks: WeekExtra[] }) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify({ ...d, generatedAt: new Date().toISOString() }, null, 0));
}

async function main() {
  // NEWEST-FIRST: the live dashboard's heatmap + Revenue Projection use the
  // most recent ~12-20 weeks, so backfilling recent weeks first makes the
  // call-conversion / re-book signals (and the conversion lever) light up
  // fast instead of after the whole Jan→now history is done. Resumable —
  // already-captured weeks are skipped.
  const weeks = mondays().reverse();
  const store = load();
  const done = new Set(store.weeks.map(w => w.weekStart));
  const byWeek = new Map(store.weeks.map(w => [w.weekStart, w]));
  // REBOOK_ONLY=1 → recompute Re-Book for ALL weeks with the new
  // booked-at-checkout definition and PRESERVE existing Conversion values
  // (Conversion wasn't wrong; re-running Claude across all history is huge).
  const REBOOK_ONLY = process.env.REBOOK_ONLY === '1';
  console.log(`[hx] ${weeks.length} weeks total, ${done.size} already done, ${REBOOK_ONLY ? 'REBOOK_ONLY: recomputing rebook for all weeks, keeping conversion' : `${weeks.length - done.size} to do`} (newest-first)`);

  for (const w of weeks) {
    if (done.has(w.weekStart) && !REBOOK_ONLY) { console.log(`[hx] ${w.weekStart} skip (cached)`); continue; }
    const prev = byWeek.get(w.weekStart);
    const rebook: Record<string, number> = {};
    const conversion: Record<string, number> = REBOOK_ONLY && prev ? { ...prev.conversion } : {};
    for (const shop of SHOPS) {
      // ---- Re-Book ----
      try {
        const ros = await rosForShop(shop.tekmetricId, { startISO: w.wsISO, endISO: w.weISO });
        const fleet = new Map<number, 'RETAIL' | 'FLEET'>();
        const veh = new Map<number, Set<number>>();
        for (const r of ros) { if (!r.customerId) continue; const s = veh.get(r.customerId) ?? new Set(); s.add(r.vehicleId); veh.set(r.customerId, s); }
        for (const [cid, vs] of veh) fleet.set(cid, classifyFleet({ id: cid, fullName: '', vehicleCount: vs.size }));
        const appts = await fetchAllAppointments({
          shopId: shop.tekmetricId,
          startTimeFrom: w.wsISO,
          startTimeTo: addMonths(new Date(w.wsISO), 6).toISOString(),
        });
        const byCust = new Map<number, typeof appts>();
        for (const a of appts) { if (!a.customerId) continue; const arr = byCust.get(a.customerId) ?? []; arr.push(a); byCust.set(a.customerId, arr); }
        const f = shopFbr(ros, fleet, byCust);
        rebook[shop.num] = f ? Math.round(f.fbrPct * 1000) / 10 : 0;
      } catch (e: any) {
        rebook[shop.num] = -1; // sentinel: failed (kept so re-run can retry the week)
        console.warn(`[hx] ${w.weekStart} ${shop.num} rebook FAIL: ${e?.message}`);
      }
      await new Promise(r => setTimeout(r, 350));
      // ---- Conversion (Claude) ---- (skipped in REBOOK_ONLY: keep existing)
      if (REBOOK_ONLY) { await new Promise(r => setTimeout(r, 120)); continue; }
      try {
        const leads = await fetchAllLeads({ shop: shop.num as any, startDate: w.weekStart, endDate: w.weISO.slice(0, 10) });
        const eligible = leads.filter(isEligibleCall);
        if (eligible.length === 0) { conversion[shop.num] = 0; }
        else {
          const res = await classifyBatch(eligible, 6);
          const booked = [...res.values()].filter((r: any) => r.appointment_booked).length;
          conversion[shop.num] = Math.round((booked / eligible.length) * 1000) / 10;
        }
      } catch (e: any) {
        conversion[shop.num] = -1;
        console.warn(`[hx] ${w.weekStart} ${shop.num} conversion FAIL: ${e?.message}`);
      }
      await new Promise(r => setTimeout(r, 350));
    }
    // Upsert (re-runs / REBOOK_ONLY overwrite the week in place, no dupes).
    const existingIdx = store.weeks.findIndex(x => x.weekStart === w.weekStart);
    const row = { weekStart: w.weekStart, rebook, conversion };
    if (existingIdx >= 0) store.weeks[existingIdx] = row; else store.weeks.push(row);
    store.weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    save(store); // persist after every week so the job is fully resumable
    console.log(`[hx] ${w.weekStart} done — rebook#shops=${Object.keys(rebook).length} conv#shops=${Object.keys(conversion).length}`);
  }
  console.log(`[hx] complete — ${store.weeks.length} weeks → ${FILE}`);
}
main().catch(e => { console.error(e); process.exit(1); });
