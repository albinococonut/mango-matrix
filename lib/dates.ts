// Date helpers - all multi-shop dates pivot on Mountain Time since 7 of 9 shops live there.
// BOUNDARY ALIGNMENT: Tekmetric's UI uses America/Chicago (Central) for org-level reports.
// To match its Net Sales numbers exactly, we pin date boundaries to Central time too.
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  isWeekend,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns';

export const CHAIN_TZ = 'America/Denver';            // chart/labels timezone
export const TEKMETRIC_REPORT_TZ = 'America/Chicago'; // boundary timezone for revenue match

export type RangeKey =
  | 'this_week' | 'last_week'
  | 'this_month' | 'last_month'
  | 'this_quarter' | 'last_quarter'
  | 'this_year' | 'last_year'
  | 'last_30_days' | 'last_60_days' | 'last_90_days' | 'last_365_days'
  | 'custom'
  // legacy keys kept so existing callers (forecast, fbr) keep working
  | 'last_7_days' | 'wtd' | 'ytd';

export interface DateRange {
  start: Date; // inclusive
  end: Date;   // inclusive
  startISO: string;
  endISO: string;
  label: string;
}

function asISO(d: Date) { return d.toISOString(); }

export function resolveRange(key: RangeKey, now: Date = new Date()): DateRange {
  const zNow = toZonedTime(now, TEKMETRIC_REPORT_TZ);
  let start: Date, end: Date, label: string;
  switch (key) {
    case 'this_week':
      start = startOfWeek(zNow, { weekStartsOn: 1 });
      end = zNow;
      label = 'This week';
      break;
    case 'last_week': {
      const prev = addWeeks(zNow, -1);
      start = startOfWeek(prev, { weekStartsOn: 1 });
      end = endOfWeek(prev, { weekStartsOn: 1 });
      label = 'Last week';
      break;
    }
    case 'this_month':
      start = startOfMonth(zNow);
      end = zNow;
      label = 'This month';
      break;
    case 'last_month': {
      const prev = addMonths(zNow, -1);
      start = startOfMonth(prev);
      end = endOfMonth(prev);
      label = 'Last month';
      break;
    }
    case 'this_quarter':
      start = startOfQuarter(zNow);
      end = zNow;
      label = 'This quarter';
      break;
    case 'last_quarter': {
      const prev = addQuarters(zNow, -1);
      start = startOfQuarter(prev);
      end = endOfQuarter(prev);
      label = 'Last quarter';
      break;
    }
    case 'this_year':
      start = startOfYear(zNow);
      end = zNow;
      label = 'This year';
      break;
    case 'last_year': {
      const prev = addYears(zNow, -1);
      start = startOfYear(prev);
      end = endOfYear(prev);
      label = 'Last year';
      break;
    }
    case 'last_30_days':
      end = zNow;
      start = addDays(zNow, -29);
      label = 'Last 30 days';
      break;
    case 'last_60_days':
      end = zNow;
      start = addDays(zNow, -59);
      label = 'Last 60 days';
      break;
    case 'last_90_days':
      end = zNow;
      start = addDays(zNow, -89);
      label = 'Last 90 days';
      break;
    case 'last_365_days':
      end = zNow;
      start = addDays(zNow, -364);
      label = 'Last 365 days';
      break;
    // ---- legacy keys ----
    case 'last_7_days':
      end = zNow;
      start = addDays(zNow, -6);
      label = 'Last 7 days';
      break;
    case 'wtd':
      end = zNow;
      start = startOfWeek(zNow, { weekStartsOn: 1 });
      label = 'Week to date';
      break;
    case 'ytd':
      end = zNow;
      start = startOfYear(zNow);
      label = 'Year to date';
      break;
    case 'custom':
      // Callers that want a custom range should construct DateRange directly.
      end = zNow;
      start = addDays(zNow, -29);
      label = 'Custom';
      break;
  }
  // Normalize start/end to full days in the Tekmetric report TZ so boundaries match
  const startBoundary = startOfDay(start);
  const endBoundary = endOfDay(end);
  return {
    start: startBoundary,
    end: endBoundary,
    startISO: asISO(fromZonedTime(startBoundary, TEKMETRIC_REPORT_TZ)),
    endISO:   asISO(fromZonedTime(endBoundary, TEKMETRIC_REPORT_TZ)),
    label,
  };
}

/** Build a DateRange from explicit YYYY-MM-DD strings (used by 'custom' picker). */
export function customRange(startYmd: string, endYmd: string): DateRange {
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const startLocal = new Date(sy, sm - 1, sd, 0, 0, 0);
  const endLocal = new Date(ey, em - 1, ed, 23, 59, 59, 999);
  return {
    start: startLocal,
    end: endLocal,
    startISO: asISO(fromZonedTime(startLocal, TEKMETRIC_REPORT_TZ)),
    endISO:   asISO(fromZonedTime(endLocal, TEKMETRIC_REPORT_TZ)),
    label: `${startYmd} → ${endYmd}`,
  };
}

/** Comparison strategies for Period/Shop comparison views. */
export type ComparisonMode = 'previous_period' | 'same_period_last_year' | 'custom';

/** Given a current DateRange and a mode, return the comparison DateRange. */
export function resolveComparisonRange(current: DateRange, mode: ComparisonMode, customStartYmd?: string, customEndYmd?: string): DateRange {
  if (mode === 'custom' && customStartYmd && customEndYmd) {
    return customRange(customStartYmd, customEndYmd);
  }
  if (mode === 'same_period_last_year') {
    const start = addYears(current.start, -1);
    const end = addYears(current.end, -1);
    return {
      start, end,
      startISO: asISO(fromZonedTime(start, TEKMETRIC_REPORT_TZ)),
      endISO:   asISO(fromZonedTime(end, TEKMETRIC_REPORT_TZ)),
      label: `Same period last year`,
    };
  }
  // Default: previous period of same length, ending the day before current.start.
  const lengthDays = differenceInCalendarDays(current.end, current.start);
  const end = addDays(current.start, -1);
  const start = addDays(end, -lengthDays);
  return {
    start, end,
    startISO: asISO(fromZonedTime(startOfDay(start), TEKMETRIC_REPORT_TZ)),
    endISO:   asISO(fromZonedTime(endOfDay(end), TEKMETRIC_REPORT_TZ)),
    label: 'Previous period',
  };
}

export function workingDayCount(start: Date, end: Date, excludeWeekends = false): number {
  const days = differenceInCalendarDays(end, start) + 1;
  if (!excludeWeekends) return days;
  let count = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    if (!isWeekend(d)) count++;
  }
  return count;
}

export function fmtDateMtn(d: Date | string, pattern = 'MMM d, yyyy'): string {
  return formatInTimeZone(d instanceof Date ? d : new Date(d), CHAIN_TZ, pattern);
}

export function shortDateMtn(d: Date | string): string {
  return formatInTimeZone(d instanceof Date ? d : new Date(d), CHAIN_TZ, 'MMM d');
}
