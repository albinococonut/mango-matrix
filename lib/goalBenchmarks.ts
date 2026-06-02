// Goal-meeting benchmarks — the empirical "what it looks like when this shop
// hits its revenue goal" levels, mined from the permanent weekly archive
// (lib/historyArchive). The GP$ diagnostic tree compares each shop's PROJECTED
// period against these levels to find the biggest lever to move GP$.
//
// For each shop we take the median of every KPI across the weeks where the shop
// ACTUALLY met its weekly revenue goal. If a shop rarely (or never) hit goal,
// we fall back to its own best weeks (top revenue quartile) and flag it, so the
// benchmark is always "your realistic ceiling" rather than an unreachable
// fiction. We also return the shop's RECENT operating level (trailing 8 weeks)
// for the rate metrics the projection doesn't expose (close rate, call
// conversion, re-book), so the tree has a consistent current-vs-goal pair.

import { readArchiveAllWeeks } from './historyArchive';
import { DEFAULT_GOALS } from './goals';
import { SHOPS } from './shops';
import type { WeekPoint } from './forecast/history';

export interface BenchLevels {
  revenue: number;            // weekly $
  cars: number;               // weekly count
  aro: number;                // $/car (rate)
  closeRate: number;          // 0..1
  gpPct: number;              // 0..1
  conversion: number | null;  // 0..100
  rebook: number | null;      // 0..100
}
export interface ShopBenchmark {
  shopNum: string;
  shopName: string;
  goalWeeks: number;          // weeks that met the weekly revenue goal
  sampleWeeks: number;        // weeks with revenue data
  method: 'goal-met' | 'best-weeks';
  benchmark: BenchLevels;     // median across goal-meeting (or best) weeks
  recent: BenchLevels;        // median across the trailing 8 weeks (current level)
}
export interface GoalBenchmarks {
  shops: ShopBenchmark[];
  generatedAt: string;
}

function median(xs: number[]): number {
  const s = xs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function medianOrNull(xs: (number | null)[]): number | null {
  const s = xs.filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
  return s.length ? median(s) : null;
}
function levels(pts: WeekPoint[]): BenchLevels {
  return {
    revenue: median(pts.map((p) => p.revenue).filter((v) => v > 0)),
    cars: median(pts.map((p) => p.cars).filter((v) => v > 0)),
    aro: median(pts.map((p) => p.aro).filter((v) => v > 0)),
    closeRate: median(pts.map((p) => p.closeRate).filter((v) => v > 0)),
    gpPct: median(pts.map((p) => p.gpPct).filter((v) => v > 0)),
    conversion: medianOrNull(pts.map((p) => p.conversion)),
    rebook: medianOrNull(pts.map((p) => p.rebook)),
  };
}

export async function goalMeetingBenchmarks(): Promise<GoalBenchmarks> {
  const all = await readArchiveAllWeeks(); // Map<weekStart, Record<shopNum, WeekPoint|null>>
  const weekStarts = [...all.keys()].sort(); // oldest → newest

  // per-shop chronological points (revenue-bearing weeks only)
  const byShop = new Map<string, WeekPoint[]>();
  for (const s of SHOPS) byShop.set(s.num, []);
  for (const wk of weekStarts) {
    const bs = all.get(wk)!;
    for (const s of SHOPS) {
      const p = bs[s.num];
      if (p && p.revenue > 0) byShop.get(s.num)!.push(p);
    }
  }

  const shops: ShopBenchmark[] = SHOPS.map((s) => {
    const pts = byShop.get(s.num)!; // chronological
    const goal = DEFAULT_GOALS[s.num]?.revenueWeekly ?? 0;
    const goalMet = goal > 0 ? pts.filter((p) => p.revenue >= goal) : [];

    // Benchmark = goal-meeting weeks when we have enough of them; otherwise the
    // shop's own best weeks (top revenue quartile) as a realistic ceiling.
    let benchPts: WeekPoint[];
    let method: 'goal-met' | 'best-weeks';
    if (goalMet.length >= 4) {
      benchPts = goalMet;
      method = 'goal-met';
    } else {
      const sorted = [...pts].sort((a, b) => b.revenue - a.revenue);
      const take = Math.min(sorted.length, Math.max(4, Math.ceil(sorted.length * 0.25)));
      benchPts = sorted.slice(0, take);
      method = 'best-weeks';
    }
    const recentPts = pts.slice(-8);

    return {
      shopNum: s.num,
      shopName: s.name,
      goalWeeks: goalMet.length,
      sampleWeeks: pts.length,
      method,
      benchmark: levels(benchPts.length ? benchPts : recentPts),
      recent: levels(recentPts.length ? recentPts : pts),
    };
  });

  return { shops, generatedAt: new Date().toISOString() };
}
