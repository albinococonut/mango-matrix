// Shared shop goals + working-day helpers. Used by ShopPerformanceTable AND
// the Shop Performance Heatmap so they apply the same goals + prorating logic.

import { addDays, endOfMonth, endOfQuarter, endOfWeek, endOfYear, getDay, getMonth, getYear, isSameDay, isValid, startOfMonth, startOfQuarter, startOfWeek, startOfYear } from 'date-fns';
import type { RangeKey } from './dates';

export interface ShopGoal {
  revenueWeekly?: number;
  revenueMonthly?: number;
  revenueQuarterly?: number;
  aro?: number;
  closeRate?: number;
  gpPct?: number;
  noi?: number;
}
export type GoalsByShop = Record<string, ShopGoal>;

export const GOALS_STORAGE_KEY = 'mango.shopGoals.v3';

export const DEFAULT_GOALS: GoalsByShop = {
  '001': { revenueWeekly: 54_000, revenueMonthly: 233_000, revenueQuarterly: 700_000, gpPct: 0.58, noi: 0.25 },
  '002': { revenueWeekly: 49_000, revenueMonthly: 210_000, revenueQuarterly: 630_000, gpPct: 0.58, noi: 0.25 },
  '003': { revenueWeekly: 44_000, revenueMonthly: 187_000, revenueQuarterly: 560_000, gpPct: 0.58, noi: 0.20 },
  '004': { revenueWeekly: 32_000, revenueMonthly: 137_000, revenueQuarterly: 410_000, gpPct: 0.58, noi: 0.25 },
  '005': { revenueWeekly: 59_000, revenueMonthly: 254_000, revenueQuarterly: 762_000, gpPct: 0.58, noi: 0.25 },
  '006': { revenueWeekly: 51_000, revenueMonthly: 220_000, revenueQuarterly: 658_000, gpPct: 0.58, noi: 0.25 },
  '007': { revenueWeekly: 26_000, revenueMonthly: 110_000, revenueQuarterly: 328_000, gpPct: 0.58, noi: 0.25 },
  '009': { revenueWeekly: 41_000, revenueMonthly: 176_000, revenueQuarterly: 528_000, gpPct: 0.58, noi: 0.25 },
};

export function loadGoals(): GoalsByShop {
  if (typeof window === 'undefined') return DEFAULT_GOALS;
  try {
    const stored = localStorage.getItem(GOALS_STORAGE_KEY);
    if (!stored) return DEFAULT_GOALS;
    const parsed = JSON.parse(stored) as GoalsByShop;
    // Deep merge: per-shop fields fall back to DEFAULT_GOALS so a partial
    // override (e.g. saving `{ '007': {} }` from a stale UI state) doesn't
    // blank out an entire shop's goals. JSON-stored undefined keys are absent
    // from `parsed`, so they fall back to defaults; an explicit numeric zero
    // does override.
    const merged: GoalsByShop = {};
    for (const shop of Object.keys(DEFAULT_GOALS)) {
      merged[shop] = { ...DEFAULT_GOALS[shop], ...(parsed[shop] || {}) };
    }
    // Forward-compat: include any shops only present in stored data.
    for (const shop of Object.keys(parsed)) {
      if (!merged[shop]) merged[shop] = parsed[shop];
    }
    return merged;
  } catch { return DEFAULT_GOALS; }
}

export function saveGoals(g: GoalsByShop) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(g));
}

// --- Working-day calendar --------------------------------------------------

/** Date of N-th occurrence of a weekday in a month. */
function nthWeekdayOfMonth(year: number, monthIdx: number, dow: number, n: number): Date {
  const first = new Date(year, monthIdx, 1);
  let offset = (dow - getDay(first) + 7) % 7;
  return new Date(year, monthIdx, 1 + offset + 7 * (n - 1));
}
/** Last occurrence of a weekday in a month. */
function lastWeekdayOfMonth(year: number, monthIdx: number, dow: number): Date {
  const last = new Date(year, monthIdx + 1, 0);
  let offset = (getDay(last) - dow + 7) % 7;
  return new Date(year, monthIdx, last.getDate() - offset);
}

/** When a fixed-date holiday falls on a weekend, return the observed weekday.
 *  Sat → preceding Fri, Sun → following Mon (per company policy). */
function observed(d: Date): Date {
  const dow = d.getDay();
  if (dow === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  if (dow === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return d;
}

/**
 * Shop holidays per user spec. Day-after-Thanksgiving is also off.
 * Fixed-date holidays use the observed weekday when the calendar date falls
 * on a weekend (Sat → Fri, Sun → Mon).
 * Returns the holiday date objects for one calendar year.
 */
export function holidaysInYear(year: number): Date[] {
  const memorial = lastWeekdayOfMonth(year, 4, 1);                 // Last Monday in May
  const labor = nthWeekdayOfMonth(year, 8, 1, 1);                  // 1st Monday in Sept
  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);          // 4th Thursday in Nov
  return [
    observed(new Date(year, 0, 1)),                                // New Year's Day (observed)
    memorial,
    observed(new Date(year, 6, 4)),                                // Independence Day (observed)
    labor,
    thanksgiving,
    addDays(thanksgiving, 1),                                      // Day after Thanksgiving
    observed(new Date(year, 11, 24)),                              // Christmas Eve (observed)
    observed(new Date(year, 11, 25)),                              // Christmas (observed)
  ];
}

const HOLIDAY_CACHE = new Map<number, Set<string>>();
function holidayKeySet(year: number): Set<string> {
  if (!HOLIDAY_CACHE.has(year)) {
    HOLIDAY_CACHE.set(year, new Set(holidaysInYear(year).map(d => d.toISOString().slice(0, 10))));
  }
  return HOLIDAY_CACHE.get(year)!;
}

/** True if d is Mon-Fri and not a holiday. */
export function isWorkingDay(d: Date): boolean {
  if (!isValid(d)) return false;
  const dow = getDay(d);
  if (dow === 0 || dow === 6) return false;
  const set = holidayKeySet(getYear(d));
  return !set.has(d.toISOString().slice(0, 10));
}

/** Count working days in [start, end] inclusive (excludes weekends + holidays). */
export function workingDaysBetween(start: Date, end: Date): number {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let count = 0;
  for (let d = new Date(s); d <= e; d = addDays(d, 1)) {
    if (isWorkingDay(d)) count++;
  }
  return count;
}

/** Mon-Fri count in [start, end] inclusive, IGNORING holidays — the "normal"
 *  full-staffing denominator. Used so a week with a holiday still divides by 5,
 *  which drops the prorated goal to 4/5: we don't expect to earn a holiday's
 *  revenue, so a 4-day week shouldn't be judged against a 5-day target. */
export function weekdaysBetween(start: Date, end: Date): number {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let count = 0;
  for (let d = new Date(s); d <= e; d = addDays(d, 1)) {
    const dow = getDay(d);
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// --- Goal resolution -------------------------------------------------------

/** Pick the right revenue goal cadence given the page's selected range. */
export function revenueGoalForRange(g: ShopGoal | undefined, range: RangeKey): number | undefined {
  if (!g) return undefined;
  switch (range) {
    case 'this_week':
    case 'last_week':
    case 'next_week':
    case 'wtd':
      return g.revenueWeekly;
    case 'this_month':
    case 'last_month':
    case 'next_month':
      return g.revenueMonthly;
    case 'this_quarter':
    case 'last_quarter':
      return g.revenueQuarterly;
    case 'this_year':
    case 'last_year':
    case 'ytd':
      return g.revenueQuarterly ? g.revenueQuarterly * 4 : undefined;
    default:
      return undefined; // last_30 / 60 / 90 / 365 / custom — no single goal
  }
}

/**
 * Compute the FULL calendar bounds of the current period (start to end of month/
 * quarter/year/week), regardless of where "today" sits inside it. This lets us
 * prorate against the full period denominator (e.g., 22 working days in May) and
 * not just the elapsed-so-far slice.
 */
function fullPeriodBounds(range: RangeKey, now: Date): { start: Date; end: Date } | null {
  switch (range) {
    case 'this_week':
    case 'wtd':
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'this_month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'this_quarter':
      return { start: startOfQuarter(now), end: endOfQuarter(now) };
    case 'this_year':
    case 'ytd':
      return { start: startOfYear(now), end: endOfYear(now) };
    default:
      return null;
  }
}

/**
 * Prorate a goal by working-days elapsed in the CURRENT period.
 * Example: monthly goal $200k, 22 working days in May, today is May 17 (10
 * working days elapsed) → prorated goal = $200k × 10/22 ≈ $91k.
 *
 * Past complete ranges (last_week, last_month, etc.) get the full goal.
 * The caller passes the data-window bounds for backwards compatibility; this
 * function ignores them for current periods and uses the full calendar period
 * instead (the prior implementation had a bug where windowEnd defaulted to "now"
 * which made totalDays == doneDays — never prorating).
 */
export function prorateRevenueGoal(
  goal: number,
  range: RangeKey,
  _windowStart: Date,
  _windowEnd: Date,
  now: Date = new Date(),
): number {
  const bounds = fullPeriodBounds(range, now);
  if (!bounds) return goal; // past-complete or non-prorate-able range
  // Denominator counts ALL weekdays (Mon-Fri) ignoring holidays — the "normal"
  // full-staffing week. Numerator counts only true working days (holidays
  // excluded). So a 4-day holiday week prorates to 4/5 of the full goal: we
  // don't expect to earn a holiday's revenue, so we shouldn't judge a 4-day
  // week against a 5-day target.
  const totalDays = weekdaysBetween(bounds.start, bounds.end);
  const elapsedThrough = now < bounds.end ? now : bounds.end;
  const doneDays = workingDaysBetween(bounds.start, elapsedThrough);
  if (totalDays === 0) return goal;
  return goal * (doneDays / totalDays);
}

// --- Minute-level weekly proration ----------------------------------------
//
// Shops work 8:00am-5:30pm local time, Mon-Fri. The day-level proration in
// prorateRevenueGoal() counts whole working days, which jumps in 20% steps on
// a 5-day week. For the live "this week" leaderboard we want the goal to
// creep up as the day progresses — minute by minute — so a shop that's
// posted real revenue early in the day isn't compared against a goal that
// assumes the entire day is already gone.
//
// Per-shop timezone matters because Yuma runs on America/Phoenix (no DST).
// During Mountain DST (most of the year) Yuma's wall clock is 1 hour BEHIND
// the rest of the chain — so 5:30pm in El Paso is 4:30pm in Yuma.

import { toZonedTime } from 'date-fns-tz';
import { SHOP_BY_NUM, type ShopNum } from '@/lib/shops';

const WORK_START_HOUR = 8;        // 8:00 AM local
const WORK_END_HOUR_DEC = 17.5;   // 5:30 PM local (decimal hours)
const WORK_MIN_PER_DAY = Math.round((WORK_END_HOUR_DEC - WORK_START_HOUR) * 60); // 570
const WORK_MIN_PER_WEEK = 5 * WORK_MIN_PER_DAY;                                  // 2850

/** Minutes worked on `localDay` up to `localNow`. Returns 0 on weekends/
 *  holidays, 0 before 8am local, 570 after 5:30pm local. */
function workMinutesInLocalDay(localDay: Date, localNow: Date): number {
  if (!isWorkingDay(localDay)) return 0;
  const dayStart = new Date(localDay); dayStart.setHours(WORK_START_HOUR, 0, 0, 0);
  const dayEnd   = new Date(localDay); dayEnd.setHours(17, 30, 0, 0);
  if (localNow.getTime() <= dayStart.getTime()) return 0;
  if (localNow.getTime() >= dayEnd.getTime())   return WORK_MIN_PER_DAY;
  return (localNow.getTime() - dayStart.getTime()) / 60000;
}

/** Fraction of the work-week elapsed for a shop, evaluated at `now` in the
 *  shop's local timezone. 0 on Mon before 8am; 1 anytime after Fri 5:30pm or
 *  on Sat/Sun. */
export function weeklyMinuteProrationRatio(shopNum: string, now: Date = new Date()): number {
  const tz = SHOP_BY_NUM[shopNum as ShopNum]?.timezone || 'America/Denver';
  const localNow = toZonedTime(now, tz);
  const monday = startOfWeek(localNow, { weekStartsOn: 1 });
  let elapsed = 0;
  for (let i = 0; i < 5; i++) {
    const day = addDays(monday, i);
    elapsed += workMinutesInLocalDay(day, localNow);
  }
  return Math.min(1, elapsed / WORK_MIN_PER_WEEK);
}

/** Apply minute-level weekly proration to a full weekly revenue goal. */
export function weeklyMinuteProratedGoal(shopNum: string, fullWeeklyGoal: number, now: Date = new Date()): number {
  return fullWeeklyGoal * weeklyMinuteProrationRatio(shopNum, now);
}

// --- Color bands -----------------------------------------------------------

/** Color spread for revenue (% of prorated goal).
 *  Relaxed from the prior bands (which made anything <75% red) so shops
 *  pacing within the realistic operational range aren't punished visually:
 *    ≥ 100%   bright green   (at or above pace)
 *    ≥  95%   green-yellow   (essentially on pace)
 *    ≥  75%   yellow         (watch — within 25% of pace)
 *    ≥  65%   orange         (problem — 25-35% behind)
 *    <  65%   red            (critical — >35% behind)
 *  Same source-of-truth used by ShopPerformanceTable, ShopPerformanceHeatmap,
 *  WeeklyLeaderboard. */
export function revenueBandColor(ratio: number | null): string {
  if (ratio === null) return '#F4F5F7';
  if (ratio >= 1.00) return '#5BAA59';
  if (ratio >= 0.95) return '#A8CE5A';
  if (ratio >= 0.75) return '#F5E580';
  if (ratio >= 0.65) return '#F4B65C';
  return '#C9412A';
}

/** Fixed GP% bands per user spec (target = 58%). */
export function gpBandColor(gpPct: number | null): string {
  if (gpPct === null) return '#F4F5F7';
  if (gpPct >= 0.58) return '#5BAA59';
  if (gpPct >= 0.56) return '#A8CE5A';
  if (gpPct >= 0.54) return '#F5E580';
  if (gpPct >= 0.52) return '#F4B65C';
  if (gpPct >= 0.50) return '#ED8E3A';
  return '#C9412A';
}

/** Text color picker for cells (white on dark green/dark red, black on lighter bands). */
export function bandTextColor(color: string): string {
  if (color === '#5BAA59' || color === '#C9412A') return '#FFFFFF';
  return '#0F1419';
}
