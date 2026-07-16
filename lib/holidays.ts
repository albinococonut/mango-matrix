// Holiday-week awareness for the revenue forecaster.
//
// A short week (a holiday lands inside it) does NOT simply earn 4/5 of a normal
// week — the real dip is empirical and differs by holiday and by shop. This
// module (a) detects whether a given ISO week contains a holiday and which one,
// and (b) learns, from the permanent archive, how much that SAME holiday's week
// has historically earned vs. its surrounding normal weeks — weighting the most
// recent prior year heaviest (e.g. last Memorial Day matters most for this
// Memorial Day). The result is a per-shop multiplier the engine applies to the
// shop's current run-rate instead of a flat working-day proration.

import { addDays } from 'date-fns';
import { readArchiveAllWeeks } from './historyArchive';

export type HolidayId =
  | 'new_year' | 'memorial' | 'independence' | 'labor'
  | 'thanksgiving' | 'day_after_thanksgiving' | 'christmas_eve' | 'christmas';

interface HolidayDef { id: HolidayId; label: string; weekdayAnchored: boolean; date: (y: number) => Date; }

function nthWeekday(y: number, monthIdx: number, dow: number, n: number): Date {
  const first = new Date(y, monthIdx, 1);
  const off = (dow - first.getDay() + 7) % 7;
  return new Date(y, monthIdx, 1 + off + 7 * (n - 1));
}
function lastWeekday(y: number, monthIdx: number, dow: number): Date {
  const last = new Date(y, monthIdx + 1, 0);
  const off = (last.getDay() - dow + 7) % 7;
  return new Date(y, monthIdx, last.getDate() - off);
}

/** When a fixed-date holiday falls on a weekend, return the observed weekday.
 *  Sat → preceding Fri, Sun → following Mon. */
function observed(d: Date): Date {
  const dow = d.getDay();
  if (dow === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  if (dow === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return d;
}

// weekdayAnchored = falls on the same weekday every year (so "last year's same
// holiday" is an apples-to-apples short week). Fixed-date holidays drift across
// weekdays year to year; they use observed() so a July 4 on Saturday is
// correctly treated as a Thursday-close Friday-holiday week.
const DEFS: HolidayDef[] = [
  { id: 'new_year',               label: "New Year's Day",          weekdayAnchored: false, date: (y) => observed(new Date(y, 0, 1)) },
  { id: 'memorial',               label: 'Memorial Day',            weekdayAnchored: true,  date: (y) => lastWeekday(y, 4, 1) },          // last Mon May
  { id: 'independence',           label: 'Independence Day',        weekdayAnchored: false, date: (y) => observed(new Date(y, 6, 4)) },
  { id: 'labor',                  label: 'Labor Day',               weekdayAnchored: true,  date: (y) => nthWeekday(y, 8, 1, 1) },        // 1st Mon Sep
  { id: 'thanksgiving',           label: 'Thanksgiving',            weekdayAnchored: true,  date: (y) => nthWeekday(y, 10, 4, 4) },       // 4th Thu Nov
  { id: 'day_after_thanksgiving', label: 'Day after Thanksgiving',  weekdayAnchored: true,  date: (y) => addDays(nthWeekday(y, 10, 4, 4), 1) },
  { id: 'christmas_eve',          label: 'Christmas Eve',           weekdayAnchored: false, date: (y) => observed(new Date(y, 11, 24)) },
  { id: 'christmas',              label: 'Christmas',               weekdayAnchored: false, date: (y) => observed(new Date(y, 11, 25)) },
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** ISO-Monday (YYYY-MM-DD) of the week containing `d`. */
function mondayOf(d: Date): string {
  const off = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - off));
}

export interface HolidayHit { id: HolidayId; label: string; date: string; weekdayAnchored: boolean }
export interface HolidayWeekInfo {
  isHolidayWeek: boolean;
  primary?: HolidayHit;     // the holiday that defines the short week
  all: HolidayHit[];
}

/** Which holiday(s) (if any) fall on Mon–Fri of the week starting `weekStart`. */
export function holidayWeekInfo(weekStart: string): HolidayWeekInfo {
  const [y, mo, d] = weekStart.split('-').map(Number);
  const mon = new Date(y, mo - 1, d);
  const weekdays = [0, 1, 2, 3, 4].map((i) => addDays(mon, i)); // Mon..Fri
  const hits: HolidayHit[] = [];
  for (const def of DEFS) {
    // Check this calendar year and (for year-end weeks) the next year's Jan 1.
    for (const yy of Array.from(new Set([y, y + 1, y - 1]))) {
      const hd = def.date(yy);
      if (weekdays.some((wd) => wd.getFullYear() === hd.getFullYear() && wd.getMonth() === hd.getMonth() && wd.getDate() === hd.getDate())) {
        hits.push({ id: def.id, label: def.label, date: ymd(hd), weekdayAnchored: def.weekdayAnchored });
      }
    }
  }
  if (!hits.length) return { isHolidayWeek: false, all: [] };
  const primary = hits.find((h) => h.weekdayAnchored) || hits[0];
  return { isHolidayWeek: true, primary, all: hits };
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface HolidayFactors {
  info: HolidayWeekInfo;
  byShop: Record<string, number>; // multiplier vs a normal week (e.g. 0.74)
  note: string | null;
  yearsUsed: number;
}

/**
 * Per-shop holiday multiplier for the week starting `weekStart`, learned from
 * the archive: for each prior year's SAME holiday week, ratio = that week's
 * revenue / median of the ±4 surrounding NON-holiday weeks. Years are blended
 * with the most recent weighted heaviest. Returns an empty map (engine falls
 * back to working-day proration) when the week isn't a holiday week or no prior
 * occurrence exists in the archive yet.
 */
export async function holidayFactors(weekStart: string): Promise<HolidayFactors> {
  const info = holidayWeekInfo(weekStart);
  if (!info.isHolidayWeek || !info.primary) return { info, byShop: {}, note: null, yearsUsed: 0 };

  const archive = await readArchiveAllWeeks();
  if (!archive.size) return { info, byShop: {}, note: null, yearsUsed: 0 };

  const def = DEFS.find((dd) => dd.id === info.primary!.id)!;
  const targetYear = Number(weekStart.slice(0, 4));
  // Prior occurrences of the SAME holiday that exist in the archive.
  const occurrences: string[] = [];
  for (let yy = targetYear - 1; yy >= 2021; yy--) {
    const wk = mondayOf(def.date(yy));
    if (archive.has(wk) && wk !== weekStart) occurrences.push(wk);
  }
  if (!occurrences.length) return { info, byShop: {}, note: null, yearsUsed: 0 };

  const sortedWeeks = [...archive.keys()].sort();
  const isHol = (wk: string) => holidayWeekInfo(wk).isHolidayWeek;
  const shopNums = Object.keys(archive.get(occurrences[0]) || {});
  const byShop: Record<string, number> = {};

  for (const shop of shopNums) {
    let num = 0, den = 0;
    occurrences.forEach((wk, idx) => {
      const pt = archive.get(wk)?.[shop];
      if (!pt || pt.revenue <= 0) return;
      const i = sortedWeeks.indexOf(wk);
      if (i < 0) return;
      const surround: number[] = [];
      for (let k = -4; k <= 4; k++) {
        if (k === 0) continue;
        const w2 = sortedWeeks[i + k];
        if (!w2 || isHol(w2)) continue;
        const p2 = archive.get(w2)?.[shop];
        if (p2 && p2.revenue > 0) surround.push(p2.revenue);
      }
      if (surround.length < 2) return;
      const med = median(surround);
      if (med <= 0) return;
      const w = Math.pow(0.6, idx); // most-recent prior year weighted heaviest
      num += w * (pt.revenue / med);
      den += w;
    });
    if (den > 0) byShop[shop] = num / den;
  }

  const yearsUsed = occurrences.length;
  const note = Object.keys(byShop).length
    ? `${info.primary.label} short week — projected from ${yearsUsed} prior ${info.primary.label} week${yearsUsed > 1 ? 's' : ''} (most recent weighted heaviest), not a flat 5-day week.`
    : null;
  return { info, byShop, note, yearsUsed };
}
