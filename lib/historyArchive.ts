// Permanent Tekmetric weekly revenue archive.
//
// WHY THIS EXISTS: the dashboard recomputes revenue/cars/GP from Tekmetric ROs
// per requested window and caches each window for ~14 days. Nothing stored a
// COMPLETE history — year-over-year views just re-pull each window live. That
// means deep history (e.g. last year's Memorial Day week) isn't available to
// the forecaster. This module captures one compact KPI point per ISO week per
// shop, all the way back to Dec 2021, and stores it DURABLY (no TTL) so it is
// pulled from Tekmetric exactly once and reused forever.
//
// Storage: one key per calendar year (`hist_archive_<year>` → { weekStart →
// shopNum → WeekPoint }) plus an index. A backfill cursor walks backward from
// the most recently completed week to the floor, a small batch per call, so it
// never blocks on a giant single pull. Raw ROs are NEVER persisted here (that's
// what bloated the cache before) — only the tiny computed weekly points.

import { readCache, writeCache } from './cache';
import { fetchAllRepairOrders, c2d, type RepairOrder } from './tekmetric';
import { chainKpi, isCountedRO } from './metrics';
import { SHOPS, SHOP_BY_TEKMETRIC_ID } from './shops';
import { TEKMETRIC_REPORT_TZ } from './dates';
import type { WeekPoint } from './forecast/history';
import { addDays, startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// Tekmetric data begins Dec 2021 — floor the backfill at the Monday of the
// week containing Dec 1, 2021 so all of Dec 2021 is captured.
export const ARCHIVE_FLOOR_WEEK = '2021-11-29';

const YEAR_KEY = (y: number) => `hist_archive_${y}`;
const INDEX_KEY = 'hist_archive_index';
const CURSOR_KEY = 'hist_backfill_cursor';

type ByShop = Record<string, WeekPoint | null>;
interface YearArchive { year: number; weeks: Record<string, ByShop>; }
interface ArchiveIndex { years: number[]; }
export interface BackfillCursor {
  next: string;        // next (older) Monday to process, YYYY-MM-DD
  done: boolean;
  processed: number;   // total weeks written across all calls
  startedAt: string;
  updatedAt: string;
}

// ---- reads ---------------------------------------------------------------
export async function readArchiveAllWeeks(): Promise<Map<string, ByShop>> {
  const idx = (await readCache<ArchiveIndex>(INDEX_KEY)) || { years: [] };
  const map = new Map<string, ByShop>();
  for (const y of idx.years) {
    const ya = await readCache<YearArchive>(YEAR_KEY(y));
    if (ya?.weeks) for (const [wk, bs] of Object.entries(ya.weeks)) map.set(wk, bs);
  }
  return map;
}

export async function readArchiveStatus(): Promise<{ years: number[]; weekCount: number; oldest: string | null; newest: string | null; cursor: BackfillCursor | null }> {
  const idx = (await readCache<ArchiveIndex>(INDEX_KEY)) || { years: [] };
  const all: string[] = [];
  for (const y of idx.years) {
    const ya = await readCache<YearArchive>(YEAR_KEY(y));
    if (ya?.weeks) all.push(...Object.keys(ya.weeks));
  }
  all.sort();
  const cursor = (await readCache<BackfillCursor>(CURSOR_KEY)) ?? null;
  return { years: idx.years, weekCount: all.length, oldest: all[0] ?? null, newest: all[all.length - 1] ?? null, cursor };
}

// ---- writes --------------------------------------------------------------
async function writeArchiveWeek(weekStart: string, byShop: ByShop): Promise<void> {
  const year = Number(weekStart.slice(0, 4));
  const ya = (await readCache<YearArchive>(YEAR_KEY(year))) || { year, weeks: {} };
  ya.weeks[weekStart] = byShop;
  await writeCache(YEAR_KEY(year), ya); // durable — no TTL
  const idx = (await readCache<ArchiveIndex>(INDEX_KEY)) || { years: [] };
  if (!idx.years.includes(year)) { idx.years.push(year); idx.years.sort((a, b) => a - b); await writeCache(INDEX_KEY, idx); }
}

// ---- per-week compute (revenue first; mirrors weeklyShopHistory) ---------
function loadExtras(): Map<string, { rebook?: Record<string, number>; conversion?: Record<string, number> }> {
  const m = new Map<string, any>();
  try {
    const f = path.join(process.cwd(), 'data', 'heatmapExtras.json');
    if (existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf8')); for (const w of j.weeks || []) m.set(w.weekStart, w); }
  } catch {}
  return m;
}
const extra = (v: number | undefined): number | null => (v == null || v < 0 ? null : v);

/** Compute every shop's weekly KPI point for the ISO week starting on the given
 *  Monday. Fetches ROs DIRECTLY from Tekmetric (not the 14-day RO cache) so the
 *  one-time backfill never persists giant RO blobs. */
export async function computeWeekPoints(weekStartMonday: string): Promise<ByShop> {
  const [y, mo, d] = weekStartMonday.split('-').map(Number);
  const ws = new Date(y, mo - 1, d);
  const weEnd = new Date(y, mo - 1, d + 6, 23, 59, 59);
  const wsISO = fromZonedTime(ws, TEKMETRIC_REPORT_TZ).toISOString();
  const weISO = fromZonedTime(weEnd, TEKMETRIC_REPORT_TZ).toISOString();

  const ros: RepairOrder[] = [];
  for (const s of SHOPS) {
    ros.push(...await fetchAllRepairOrders({ shopId: s.tekmetricId, postedDateStart: wsISO, postedDateEnd: weISO }));
    if (s.tekmetricIdSecondary) ros.push(...await fetchAllRepairOrders({ shopId: s.tekmetricIdSecondary, postedDateStart: wsISO, postedDateEnd: weISO }));
  }
  const kpi = chainKpi(ros);
  const byNum = new Map(kpi.byShop.map((s) => [s.shopNum, s]));
  const cb: Record<string, number> = {}; const hrs: Record<string, number> = {};
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
  const ex = loadExtras().get(weekStartMonday);
  const out: ByShop = {};
  for (const s of SHOPS) {
    const k = byNum.get(s.num);
    out[s.num] = k ? {
      weekStart: weekStartMonday,
      revenue: k.revenue, cars: k.cars, aro: k.aro, closeRate: k.closeRate,
      gpDollars: k.gpDollars, gpPct: k.gpPct,
      comebacks: cb[s.num] ?? 0,
      billedHours: Math.round((hrs[s.num] ?? 0) * 10) / 10,
      rebook: extra(ex?.rebook?.[s.num]), conversion: extra(ex?.conversion?.[s.num]),
    } : null;
  }
  return out;
}

// ---- backfill cursor walk ------------------------------------------------
function lastCompletedMonday(): string {
  const nowMtn = toZonedTime(new Date(), TEKMETRIC_REPORT_TZ);
  return addDays(startOfWeek(nowMtn, { weekStartsOn: 1 }), -7).toISOString().slice(0, 10);
}
function prevMonday(weekStart: string): string {
  const [y, mo, d] = weekStart.split('-').map(Number);
  return addDays(new Date(y, mo - 1, d), -7).toISOString().slice(0, 10);
}

export async function resetBackfillCursor(): Promise<BackfillCursor> {
  const now = new Date().toISOString();
  const c: BackfillCursor = { next: lastCompletedMonday(), done: false, processed: 0, startedAt: now, updatedAt: now };
  await writeCache(CURSOR_KEY, c);
  return c;
}

/** Process up to `maxWeeks` older weeks from the cursor. Resumable + idempotent;
 *  a failed week leaves the cursor parked there to retry on the next call. */
export async function backfillNextBatch(maxWeeks: number): Promise<{ processed: number; cursor: BackfillCursor }> {
  let cursor = (await readCache<BackfillCursor>(CURSOR_KEY)) || (await resetBackfillCursor());
  if (cursor.done) return { processed: 0, cursor };
  let processed = 0;
  let wk = cursor.next;
  for (let i = 0; i < maxWeeks; i++) {
    if (wk < ARCHIVE_FLOOR_WEEK) { cursor.done = true; break; }
    try {
      const pts = await computeWeekPoints(wk);
      await writeArchiveWeek(wk, pts);
      processed++;
    } catch {
      break; // leave cursor at this week; next call retries
    }
    wk = prevMonday(wk);
    // Persist the cursor after EACH week so a mid-batch timeout can't lose
    // progress (the next call resumes from here instead of re-pulling).
    cursor.next = wk;
    cursor.processed += 1;
    cursor.done = wk < ARCHIVE_FLOOR_WEEK;
    cursor.updatedAt = new Date().toISOString();
    await writeCache(CURSOR_KEY, cursor);
    if (cursor.done) break;
  }
  return { processed, cursor };
}

/** Append/refresh a single completed week (used to keep the archive current
 *  going forward without ever re-pulling old weeks). */
export async function archiveWeek(weekStartMonday: string): Promise<void> {
  const pts = await computeWeekPoints(weekStartMonday);
  await writeArchiveWeek(weekStartMonday, pts);
}
