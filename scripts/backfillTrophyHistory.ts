// One-time (re-runnable) backfill of weekly trophy rankings from 2026-01-01.
//
// Why a committed file: Vercel Hobby has no durable runtime store (/tmp is
// ephemeral). So the all-time accumulation baseline lives in a JSON file
// committed to the repo. The cron keeps the *current* week live; the quarter /
// all-time tally reads this baseline for completed weeks.
//
// Only RO-derived metrics can be reconstructed historically: Revenue, GP%,
// Top-Tech, Fewest-Comebacks. Re-Book needs point-in-time appointment
// snapshots, Reviews needs GBP (blocked), Call-Conversion needs WhatConverts +
// Anthropic — none expose trustworthy week-by-week history, so they stay
// current-week only (documented in the UI footer).
//
// Run: npx tsx --env-file=.env.local scripts/backfillTrophyHistory.ts

import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { rosForChain } from '../lib/dataAccess';
import { chainKpi, techProduction, isCountedRO } from '../lib/metrics';
import { SHOPS, SHOP_BY_TEKMETRIC_ID } from '../lib/shops';

const FIRST = new Date(Date.UTC(2026, 0, 5)); // first Monday on/after 2026-01-01

function mondaysSince(first: Date): { startISO: string; endISO: string; weekStart: string }[] {
  const out: { startISO: string; endISO: string; weekStart: string }[] = [];
  const now = new Date();
  const cur = new Date(first);
  while (cur < now) {
    const start = new Date(cur);
    const end = new Date(cur);
    end.setUTCDate(end.getUTCDate() + 7); // exclusive Mon→next Mon
    if (end > now) break; // only completed weeks
    out.push({
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      weekStart: start.toISOString().slice(0, 10),
    });
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return out;
}

function comebackCounts(ros: any[]): Map<string, number> {
  const MIN_HOURS = 0.25;
  const MAX_CHARGE = 20.0;
  const m = new Map<string, number>();
  for (const s of SHOPS) m.set(s.num, 0);
  for (const o of ros) {
    if (!isCountedRO(o)) continue;
    const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
    if (!meta) continue;
    for (const j of o.jobs || []) {
      if (!j.authorized) continue;
      const hours = j.laborHours || 0;
      if (hours < MIN_HOURS) continue;
      const charge = (j.laborTotal || 0) + (j.partsTotal || 0);
      if (charge > MAX_CHARGE) continue;
      m.set(meta.num, (m.get(meta.num) ?? 0) + 1);
    }
  }
  return m;
}

async function main() {
  const weeks = mondaysSince(FIRST);
  console.log(`[backfill] ${weeks.length} completed weeks from ${weeks[0]?.weekStart} → ${weeks.at(-1)?.weekStart}`);
  const history: any[] = [];

  for (const w of weeks) {
    try {
      const ros = await rosForChain({ startISO: w.startISO, endISO: w.endISO });
      const kpi = chainKpi(ros);
      const tech = techProduction(ros, 40);
      const bestTech = new Map<string, number>();
      for (const t of tech) bestTech.set(t.shopNum, Math.max(bestTech.get(t.shopNum) ?? 0, t.billedHours));
      const cb = comebackCounts(ros);

      const rankBy = (pairs: [string, number][], dir: 'desc' | 'asc') =>
        pairs.filter(([, v]) => Number.isFinite(v)).sort((a, b) => dir === 'desc' ? b[1] - a[1] : a[1] - b[1]).map(([n]) => n);

      const rankings = {
        revenue: rankBy(kpi.byShop.map(s => [s.shopNum, s.revenue] as [string, number]), 'desc'),
        gp: rankBy(kpi.byShop.map(s => [s.shopNum, s.gpPct] as [string, number]), 'desc'),
        tech: rankBy([...bestTech.entries()], 'desc'),
        comebacks: rankBy([...cb.entries()], 'asc'), // fewest = best
      };
      history.push({ weekStart: w.weekStart, rankings });
      console.log(`[backfill] ${w.weekStart} ok — rev#1=${rankings.revenue[0]} gp#1=${rankings.gp[0]} tech#1=${rankings.tech[0]}`);
    } catch (e: any) {
      console.warn(`[backfill] ${w.weekStart} FAILED: ${e?.message || e} (skipped)`);
    }
    await new Promise(r => setTimeout(r, 400)); // be gentle on Tekmetric
  }

  const dir = path.join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'trophyHistory.json');
  writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), weeks: history }, null, 0));
  console.log(`[backfill] wrote ${history.length} weeks → ${file}`);
}

main().catch(e => { console.error(e); process.exit(1); });
