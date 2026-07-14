// Permanent per-week parts-pricing aggregate store.
//
// Storage mirrors historyArchive: one Redis key per calendar year
// (`pm_hist_<year>` → { weekStart: {...aggregates} }), no TTL.
// Backfill walks newest-first so recent data appears quickly.

import { readCache, writeCache } from './cache';
import { fetchAllRepairOrders } from './tekmetric';
import { classifyPricing, matrixRetail, type PricingType } from './partsMatrix';
import { SHOPS } from './shops';

export interface PartsShopBucket {
  total: number;
  canned: number;
  matrix: number;
  manual: number;
  no_charge: number;
  lostCents: number;
}

export interface PartsWeekBucket {
  weekStart: string;   // YYYY-MM-DD (Monday UTC)
  total: number;
  canned: number;
  matrix: number;
  manual: number;
  no_charge: number;
  lostCents: number;   // sum |matrix - retail| where retail < matrix (manual only)
  gainedCents: number; // sum  retail - matrix  where retail > matrix (manual only)
  computedAt: string;
  shops?: Record<string, PartsShopBucket>;
}

type YearStore = Record<string, Omit<PartsWeekBucket, 'weekStart'>>;

// Earliest Monday we'll backfill — start of 2024 gives ~2.5 yrs from mid-2026
export const PM_HIST_FLOOR = '2024-01-01';

// v2: classification fix — canned-job manual overrides now counted as manual
const yearKey = (y: number) => `pm_hist_v2_${y}`;

async function readYear(y: number): Promise<YearStore> {
  return (await readCache<YearStore>(yearKey(y))) ?? {};
}

async function writeYear(y: number, store: YearStore): Promise<void> {
  await writeCache(yearKey(y), store); // no TTL — permanent
}

export async function readAllPartsHistory(): Promise<PartsWeekBucket[]> {
  const thisYear = new Date().getUTCFullYear();
  const all: PartsWeekBucket[] = [];
  for (let y = 2024; y <= thisYear; y++) {
    const store = await readYear(y);
    for (const [weekStart, d] of Object.entries(store)) {
      all.push({ weekStart, ...d });
    }
  }
  return all.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function mondayOfWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7; // 1=Mon … 7=Sun
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

export function allWeekStartsSince(floor: string): string[] {
  const weeks: string[] = [];
  const cur = new Date(floor + 'T00:00:00Z');
  const thisMonday = mondayOfWeek(new Date());
  while (cur.toISOString().slice(0, 10) < thisMonday) {
    weeks.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return weeks;
}

export async function getMissingWeeks(): Promise<string[]> {
  const all = allWeekStartsSince(PM_HIST_FLOOR);
  const stored = await readAllPartsHistory();
  const storedSet = new Set(stored.map((b) => b.weekStart));
  // Newest-first so the chart fills in from the right
  return all.filter((w) => !storedSet.has(w)).reverse();
}

export async function computeAndSaveWeek(weekStart: string): Promise<PartsWeekBucket> {
  const startISO = weekStart + 'T00:00:00Z';
  const endD = new Date(startISO);
  endD.setUTCDate(endD.getUTCDate() + 6);
  const endISO = endD.toISOString().slice(0, 10) + 'T23:59:59Z';

  const counts: Record<'total' | PricingType, number> = {
    total: 0, canned: 0, matrix: 0, manual: 0, no_charge: 0,
  };
  let lostCents = 0;
  let gainedCents = 0;

  const shopBuckets: Record<string, PartsShopBucket> = {};

  await Promise.all(SHOPS.map(async (shop) => {
    try {
      const ros = await fetchAllRepairOrders({ shopId: shop.tekmetricId, postedDateStart: startISO, postedDateEnd: endISO });
      const sbc: Record<'total' | PricingType, number> = { total: 0, canned: 0, matrix: 0, manual: 0, no_charge: 0 };
      let sbLost = 0;
      for (const ro of ros) {
        for (const job of (ro.jobs ?? [])) {
          for (const part of (job.parts ?? [])) {
            const costCents = part.cost ?? 0;
            const retailCents = part.retail ?? 0;
            const type = classifyPricing(costCents, retailCents, job.cannedJobId ?? null, part.partType?.code);
            const mxCents = matrixRetail(costCents, retailCents);
            const variance = retailCents - mxCents;
            counts.total++;
            counts[type]++;
            sbc.total++;
            sbc[type]++;
            if (type === 'manual') {
              if (variance < 0) { lostCents += Math.abs(variance); sbLost += Math.abs(variance); }
              else gainedCents += variance;
            }
          }
        }
      }
      shopBuckets[shop.num] = {
        total: sbc.total, canned: sbc.canned, matrix: sbc.matrix,
        manual: sbc.manual, no_charge: sbc.no_charge, lostCents: sbLost,
      };
    } catch {
      // skip shop on Tekmetric error — partial data still useful
    }
  }));

  const computedAt = new Date().toISOString();
  const year = parseInt(weekStart.slice(0, 4), 10);
  const store = await readYear(year);
  store[weekStart] = {
    total: counts.total,
    canned: counts.canned,
    matrix: counts.matrix,
    manual: counts.manual,
    no_charge: counts.no_charge,
    lostCents,
    gainedCents,
    computedAt,
    shops: shopBuckets,
  };
  await writeYear(year, store);

  return { weekStart, ...store[weekStart] };
}
