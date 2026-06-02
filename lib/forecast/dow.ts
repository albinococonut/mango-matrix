// Per-shop day-of-week revenue profile. Revenue is NOT earned evenly Mon→Fri:
// most shops close heavy on Fridays. We learn each shop's weekday revenue
// share from a trailing window of repair orders, so mid-week pacing reflects
// "what a Monday (or Thursday) historically looks like for THIS shop" instead
// of flat proration. Saturday/Sunday usually ~0 and that's fine.

import type { RepairOrder } from '@/lib/tekmetric';
import { c2d } from '@/lib/tekmetric';
import { isCountedRO } from '@/lib/metrics';
import { SHOP_BY_TEKMETRIC_ID } from '@/lib/shops';
import { CHAIN_TZ } from '@/lib/dates';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { isWorkingDay } from '@/lib/goals';

// weekday index: Mon=0 … Sun=6
export type DowWeights = number[]; // length 7, sums to 1 across the week
export interface DowProfile { byShop: Record<string, DowWeights>; chain: DowWeights }

// Sensible default if a shop has no history yet (Mon→Fri rising into Friday,
// weekends ~0) — still better than flat.
const DEFAULT_W: DowWeights = [0.16, 0.17, 0.19, 0.22, 0.24, 0.015, 0.005];

function normalize(arr: number[]): DowWeights {
  const sum = arr.reduce((s, x) => s + x, 0);
  if (sum <= 0) return [...DEFAULT_W];
  return arr.map((x) => x / sum);
}

export function computeDowProfile(orders: RepairOrder[]): DowProfile {
  const acc: Record<string, number[]> = {};
  const chainArr = [0, 0, 0, 0, 0, 0, 0];
  for (const o of orders) {
    if (!isCountedRO(o) || !o.postedDate) continue;
    const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
    if (!meta) continue;
    // 1 = Mon … 7 = Sun (date-fns 'i'); shift to 0-based Mon.
    const iso = Number(formatInTimeZone(o.postedDate, CHAIN_TZ, 'i'));
    const idx = (iso + 6) % 7; // Mon=0 … Sun=6
    const rev = c2d(o.laborSales + o.partsSales + o.subletSales + o.feeTotal - o.discountTotal);
    (acc[meta.num] ||= [0, 0, 0, 0, 0, 0, 0])[idx] += rev;
    chainArr[idx] += rev;
  }
  const byShop: Record<string, DowWeights> = {};
  for (const [num, arr] of Object.entries(acc)) byShop[num] = normalize(arr);
  return { byShop, chain: normalize(chainArr) };
}

/**
 * Fraction of THIS WEEK'S achievable revenue that has landed by `now`.
 *
 * "Achievable" excludes holiday weekdays — Mon→Fri that aren't real working
 * days for this calendar week (Memorial Day, Thanksgiving, etc.). They drop
 * out of BOTH the numerator (revenue earned) and the denominator (the slice
 * of a typical week we expect to actually earn). Without this, a holiday
 * Monday with $0 revenue still counted ~16% of "weekly revenue elapsed" in
 * the denominator, inflating the projection's pace projection by the same
 * margin (revSoFar / 0.83 instead of revSoFar / 1.00 at end of week).
 *
 * Weekends keep their tiny weights in BOTH sides — most shops barely earn
 * Sat (~1.5%) and ~0 Sun, but those weights are learned from history and
 * removing them would be a different argument; keeping them preserves
 * backwards-compat for shops that DO open Saturday.
 */
export function weekRevenueElapsed(weights: DowWeights, now: Date): number {
  // weekday of `now` in chain tz, Mon=0 … Sun=6
  const iso = Number(formatInTimeZone(now, CHAIN_TZ, 'i'));
  const today = (iso + 6) % 7;

  // Anchor: this week's Monday in chain wall-clock. Used to identify each
  // weekday's actual calendar date so we can ask isWorkingDay() about it.
  const nowMtn = toZonedTime(now, CHAIN_TZ);
  const monMtn = new Date(nowMtn);
  monMtn.setDate(nowMtn.getDate() - today);

  // Today's partial share — ~8a–6p earning window in chain tz.
  const hh = Number(formatInTimeZone(now, CHAIN_TZ, 'H'));
  const mm = Number(formatInTimeZone(now, CHAIN_TZ, 'm'));
  const dayFrac = Math.min(1, Math.max(0.04, (hh + mm / 60 - 8) / 10));

  let elapsed = 0;
  let achievable = 0;
  for (let d = 0; d < 7; d++) {
    const w = weights[d] || 0;
    // A weekday (d < 5) that isn't a working day this calendar week is a
    // holiday — drop it from both sides. Saturday/Sunday (d >= 5) keep
    // their (near-zero) historical weights as before.
    if (d < 5) {
      const dayDate = new Date(monMtn);
      dayDate.setDate(monMtn.getDate() + d);
      if (!isWorkingDay(dayDate)) continue;
    }
    achievable += w;
    if (d < today) {
      elapsed += w;
    } else if (d === today) {
      elapsed += w * dayFrac;
    }
  }

  if (achievable <= 0) return 0;
  return Math.min(1, Math.max(0, elapsed / achievable));
}
