// Weekend "settled re-pull" reconciliation.
//
// Mid-week revenue is computed from repair orders that may still be edited
// (price corrections, line voids, refunds) for days after they post. Tekmetric
// exposes no payments/adjustments API and no financial-report endpoint, so the
// official Net Sales figure is not fetchable. What we CAN do: once the week is
// fully closed, re-pull that week's ROs fresh (by then late edits have
// settled) and freeze the result as the authoritative weekly number. Older
// weeks stay frozen; the few most-recent closed weeks are re-pulled each
// weekend in case adjustments keep trickling in.

import { readCache, writeCache } from './cache';

export interface SettledWeek {
  weekStart: string;            // YYYY-MM-DD (Mon)
  weekEnd: string;              // YYYY-MM-DD (Sun)
  chainRevenue: number;         // settled chain revenue (ex-tax, USPS-incl)
  perShop: Record<string, number>;
  computedAt: string;           // ISO of the settling re-pull
  repulls: number;              // how many weekend re-pulls have settled this week
}

const SETTLED_KEY = (weekStart: string) => `settled_week_${weekStart}`;
const SETTLED_INDEX = 'settled_week_index';

// Weeks older than this many days are considered fully frozen and are no
// longer re-pulled (adjustments don't trickle in that late).
export const FREEZE_AFTER_DAYS = 21;

export async function getSettledWeek(weekStart: string): Promise<SettledWeek | null> {
  return readCache<SettledWeek>(SETTLED_KEY(weekStart));
}

export async function readSettledWeeks(): Promise<SettledWeek[]> {
  const idx = (await readCache<string[]>(SETTLED_INDEX)) || [];
  const out: SettledWeek[] = [];
  for (const ws of idx) {
    const s = await readCache<SettledWeek>(SETTLED_KEY(ws));
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export async function writeSettledWeek(s: SettledWeek): Promise<void> {
  await writeCache(SETTLED_KEY(s.weekStart), s); // durable: no TTL (retained)
  const idx = (await readCache<string[]>(SETTLED_INDEX)) || [];
  if (!idx.includes(s.weekStart)) {
    idx.push(s.weekStart);
    idx.sort();
    await writeCache(SETTLED_INDEX, idx);
  }
}
