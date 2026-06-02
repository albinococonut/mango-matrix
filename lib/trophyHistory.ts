// All-time weekly trophy history, backfilled from 2026-01-01 via
// scripts/backfillTrophyHistory.ts and committed to the repo (Vercel Hobby has
// no durable runtime store). Only RO-derived categories are reconstructable
// historically: revenue, gp, tech, comebacks. Re-Book / Reviews / Call
// Conversion have no trustworthy week-by-week source so they stay current-week.

import historyJson from '@/data/trophyHistory.json';

export interface WeekRankings {
  revenue: string[];
  gp: string[];
  tech: string[];
  comebacks: string[];
}
export interface HistWeek {
  weekStart: string; // YYYY-MM-DD (Monday)
  rankings: WeekRankings;
}

export const TROPHY_HISTORY: { generatedAt: string; weeks: HistWeek[] } =
  historyJson as { generatedAt: string; weeks: HistWeek[] };

/** Completed weeks whose Monday is on or after the given date (YYYY-MM-DD ok). */
export function historyWeeksSince(dateISO: string): HistWeek[] {
  const cut = dateISO.slice(0, 10);
  return TROPHY_HISTORY.weeks.filter(w => w.weekStart >= cut);
}
