'use client';

// This Week's Leaderboard. Two columns — Revenue and GP%. Always Mon→today,
// independent of the page filter. Ranked by % toward goal (revenue) and
// raw GP% vs the 58% target. Per-shop weekly goal labels shown inline.

import { useEffect, useState } from 'react';
import { DollarSign } from 'lucide-react';
import { SHOP_BY_NUM } from '@/lib/shops';
import { bandTextColor, gpBandColor, loadGoals, GoalsByShop, prorateRevenueGoal, revenueBandColor } from '@/lib/goals';
import { resolveRange } from '@/lib/dates';
import { usd, pct } from '@/lib/format';
import { TrophyIcon } from './Trophy';

interface ShopMetrics { shopNum: string; shopName: string; revenue: number; gpPct: number }
const GP_GOAL = 0.58;

export default function WeeklyLeaderboard() {
  const [metrics, setMetrics] = useState<ShopMetrics[] | null>(null);
  const [goals, setGoals] = useState<GoalsByShop>({});
  useEffect(() => { setGoals(loadGoals()); }, []);
  useEffect(() => {
    fetch('/api/metrics?range=this_week').then(r => r.json()).then(d => {
      if (!d?.kpi?.byShop) return;
      setMetrics(d.kpi.byShop.map((s: any) => ({ shopNum: s.shopNum, shopName: s.shopName, revenue: s.revenue, gpPct: s.gpPct })));
    });
  }, []);

  // Prorate the weekly goal by working-days elapsed so mid-week comparisons are fair.
  const win = resolveRange('this_week');
  const proratedRevenueGoal = (shopNum: string): number | undefined => {
    const g = goals[shopNum]?.revenueWeekly;
    if (!g) return undefined;
    return prorateRevenueGoal(g, 'this_week', win.start, win.end);
  };

  if (!metrics) return <div className="card animate-pulse h-[380px] mb-6" />;

  const withRatios = metrics.map(r => {
    const goal = proratedRevenueGoal(r.shopNum);
    return { ...r, revGoal: goal, revRatio: goal ? r.revenue / goal : 0, weeklyGoal: goals[r.shopNum]?.revenueWeekly };
  });
  const byRevenue = [...withRatios].sort((a, b) => b.revRatio - a.revRatio);
  const byGP = [...withRatios].sort((a, b) => b.gpPct - a.gpPct);

  function rankRow(r: typeof withRatios[number], i: number, kind: 'revenue' | 'gp') {
    const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
    const isTop3 = i < 3;
    const pillBg = kind === 'revenue' ? (r.revGoal ? revenueBandColor(r.revRatio) : '#E6E8EC') : gpBandColor(r.gpPct);
    const pillFg = bandTextColor(pillBg);
    const value = kind === 'revenue' ? usd(r.revenue) : pct(r.gpPct);
    const fillPct = kind === 'revenue'
      ? `${Math.min(100, Math.max(2, r.revRatio * 100))}%`
      : `${Math.min(100, Math.max(2, (r.gpPct / 0.60) * 100))}%`;
    const progressLabel = kind === 'revenue'
      ? (r.revGoal ? `${(r.revRatio * 100).toFixed(0)}%` : '—')
      : `${(r.gpPct * 100).toFixed(0)}%`;
    return (
      <div key={r.shopNum} className="flex items-center gap-3 py-2 border-b border-mango-line/60 last:border-0">
        <div className="w-5 text-mango-muted font-semibold text-sm text-right">{i + 1}</div>
        {isTop3 ? <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={16} /> : <div className="w-4" />}
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: meta?.color }} />
        <div className="w-28 shrink-0">
          <div className="font-medium text-sm leading-tight">{r.shopName}</div>
          {kind === 'revenue' && r.weeklyGoal && (
            <div className="text-[10px] text-mango-muted">Goal {usd(r.weeklyGoal)}/wk</div>
          )}
        </div>
        <div className="flex-1 h-2.5 bg-mango-line/40 rounded-full overflow-hidden" title={`${progressLabel} of ${kind === 'revenue' ? 'weekly goal' : '58% target'}`}>
          <div className="h-full rounded-full" style={{ width: fillPct, background: pillBg }} />
        </div>
        <div className="text-sm font-bold tabular-nums w-20 text-right px-2 py-0.5 rounded" style={{ background: pillBg, color: pillFg }}>{value}</div>
        <div className="text-[10px] text-mango-muted tabular-nums w-10 text-right">{progressLabel}</div>
      </div>
    );
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center gap-2 mb-1">
        <DollarSign className="w-5 h-5 text-mango-green" />
        <h2 className="text-lg font-semibold">This week's progress to goal and gp% target</h2>
      </div>
      <p className="text-xs text-mango-muted mb-4">Mon → today. Ranked by progress toward goal — pills colored using the same 6-band scale as the heatmap.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-semibold text-mango-muted mb-2 uppercase tracking-wide">Revenue <span className="text-mango-muted/70 ml-1">· vs prorated weekly goal</span></div>
          {byRevenue.map((r, i) => rankRow(r, i, 'revenue'))}
        </div>
        <div>
          <div className="text-xs font-semibold text-mango-muted mb-2 uppercase tracking-wide">GP % <span className="text-mango-muted/70 ml-1">· Goal 58% Gross Profit</span></div>
          {byGP.map((r, i) => rankRow(r, i, 'gp'))}
        </div>
      </div>
    </div>
  );
}
