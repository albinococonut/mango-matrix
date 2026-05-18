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
  '005': { revenueWeekly: 51_000, revenueMonthly: 217_000, revenueQuarterly: 652_000, gpPct: 0.58, noi: 0.25 },
  '006': { revenueWeekly: 51_000, revenueMonthly: 220_000, revenueQuarterly: 658_000, gpPct: 0.58, noi: 0.25 },
  '007': { revenueWeekly: 21_000, revenueMonthly: 87_000,  revenueQuarterly: 260_000, gpPct: 0.58, noi: 0.25 },
  '009': { revenueWeekly: 41_000, revenueMonthly: 176_000, revenueQuarterly: 375_000, gpPct: 0.58, noi: 0.25 },
};

export function loadGoals(): GoalsByShop {
  if (typeof window === 'undefined') return DEFAULT_GOALS;
  try {
    const stored = localStorage.getItem(GOALS_STORAGE_KEY);
    if (!stored) return DEFAULT_GOALS;
    return { ...DEFAULT_GOALS, ...JSON.parse(stored) };
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

/**
 * Shop holidays per user spec. Day-after-Thanksgiving is also off.
 * Returns the holiday date objects for one calendar year.
 */
export function holidaysInYear(year: number): Date[] {
  const memorial = lastWeekdayOfMonth(year, 4, 1);                 // Last Monday in May
  const labor = nthWeekdayOfMonth(year, 8, 1, 1);                  // 1st Monday in Sept
  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);          // 4th Thursday in Nov
  return [
    new Date(year, 0, 1),                                          // New Year's Day
    memorial,
    new Date(year, 6, 4),                                          // Independence Day
    labor,
    thanksgiving,
    addDays(thanksgiving, 1),                                      // Day after Thanksgiving
    new Date(year, 11, 24),                                        // Christmas Eve
    new Date(year, 11, 25),                                        // Christmas
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

/** Count working days in [start, end] inclusive. */
export function workingDaysBetween(start: Date, end: Date): number {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let count = 0;
  for (let d = new Date(s); d <= e; d = addDays(d, 1)) {
    if (isWorkingDay(d)) count++;
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
    case 'wtd':
      return g.revenueWeekly;
    case 'this_month':
    case 'last_month':
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
  const totalDays = workingDaysBetween(bounds.start, bounds.end);
  const elapsedThrough = now < bounds.end ? now : bounds.end;
  const doneDays = workingDaysBetween(bounds.start, elapsedThrough);
  if (totalDays === 0) return goal;
  return goal * (doneDays / totalDays);
}

// --- Color bands -----------------------------------------------------------

/** 6-band color spread for revenue (% of goal). */
export function revenueBandColor(ratio: number | null): string {
  if (ratio === null) return '#F4F5F7';
  if (ratio >= 1.00) return '#5BAA59';
  if (ratio >= 0.98) return '#A8CE5A';
  if (ratio >= 0.90) return '#F5E580';
  if (ratio >= 0.85) return '#F4B65C';
  if (ratio >= 0.75) return '#ED8E3A';
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
