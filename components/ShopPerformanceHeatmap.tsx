'use client';

// Shop Performance Heatmap: rows = shops, columns = last 12 weeks.
// Two metrics: Revenue (vs weekly goal, current week prorated by working days)
// and GP% (fixed 58% target with banded thresholds).

import { useEffect, useMemo, useState } from 'react';
import { addDays, endOfDay, format, isAfter, startOfDay } from 'date-fns';
import { ChevronDown, Grid3x3 } from 'lucide-react';
import { SHOPS, SHOP_BY_NUM } from '@/lib/shops';
import { bandTextColor, gpBandColor, GoalsByShop, loadGoals, revenueBandColor, workingDaysBetween } from '@/lib/goals';

interface Cell {
  revenue: number;
  cars: number;
  aro: number;
  closeRate: number;
  gpDollars: number;
  gpPct: number;
  partsGpPct: number;
  laborGpPct: number;
  discounts: number;
}
interface ShopRow {
  shopNum: string;
  shopName: string;
  cells: (Cell | null)[];
}
type Metric = 'revenue' | 'gpPct';

// Diagnose why this week's revenue is below its goal — pick the biggest lever.
function diagnose(c: Cell | null, goalRevenue: number | undefined, peers: (Cell | null)[]): string | null {
  if (!c || !goalRevenue) return null;
  if (c.revenue >= goalRevenue) return null;
  const recent = peers.filter((x): x is Cell => !!x).slice(-5).filter(x => x !== c);
  const avg = (key: keyof Cell) => recent.length ? recent.reduce((s, r) => s + (r[key] as number), 0) / recent.length : 0;
  const avgCars = avg('cars');
  const avgAro = avg('aro');
  const avgDisc = avg('discounts');
  const drop = (key: keyof Cell, current: number) => {
    const a = avg(key);
    return a > 0 ? ((current - a) / a) : 0;
  };
  const carDelta = drop('cars', c.cars);
  const aroDelta = drop('aro', c.aro);
  const discDelta = avgDisc > 0 ? (c.discounts - avgDisc) / avgDisc : 0;
  const candidates: { severity: number; msg: string }[] = [];
  if (carDelta < -0.05) candidates.push({ severity: -carDelta, msg: `Car count ${c.cars} vs ${avgCars.toFixed(0)} avg (${(carDelta*100).toFixed(0)}%) — check call conversion + incoming call volume.` });
  if (aroDelta < -0.05) candidates.push({ severity: -aroDelta, msg: `ARO $${c.aro.toFixed(0)} vs $${avgAro.toFixed(0)} avg (${(aroDelta*100).toFixed(0)}%) — smaller ticket sizes this week.` });
  if (discDelta > 0.15) candidates.push({ severity: discDelta, msg: `Discounts $${c.discounts.toFixed(0)} vs $${avgDisc.toFixed(0)} avg (+${(discDelta*100).toFixed(0)}%) — heavier discounting this week.` });
  if (candidates.length === 0) return `Revenue ${((c.revenue / goalRevenue) * 100).toFixed(0)}% of goal. No single lever stands out — likely fewer tech-hours produced.`;
  candidates.sort((a, b) => b.severity - a.severity);
  return candidates[0].msg;
}

export default function ShopPerformanceHeatmap() {
  const [data, setData] = useState<{ weeks: string[]; shops: ShopRow[] } | null>(null);
  const [metric, setMetric] = useState<Metric>('revenue');
  const [goals, setGoals] = useState<GoalsByShop>({});

  useEffect(() => { setGoals(loadGoals()); }, []);
  useEffect(() => {
    fetch('/api/shop-performance-heatmap?weeks=12').then((r) => r.json()).then((d) => {
      if (d?.shops) setData(d);
    });
  }, []);

  // Each heatmap cell is one Monday→Sunday week. For past weeks we compare actual
  // revenue to the full weekly goal. For the CURRENT week (the last column) we
  // pro-rate the goal by working-days elapsed so partial-week comparisons are fair.
  const now = useMemo(() => new Date(), []);
  function goalForCell(shopNum: string, weekStartISO: string): number | undefined {
    const weekly = goals[shopNum]?.revenueWeekly;
    if (!weekly) return undefined;
    const weekStart = startOfDay(new Date(weekStartISO + 'T12:00:00'));
    const weekEnd = endOfDay(addDays(weekStart, 6));
    if (isAfter(weekEnd, now)) {
      // Current/partial week — prorate by working days elapsed.
      const totalDays = workingDaysBetween(weekStart, weekEnd);
      const doneDays = workingDaysBetween(weekStart, now);
      if (totalDays === 0) return undefined;
      return weekly * (doneDays / totalDays);
    }
    return weekly;
  }

  function cellBg(shopNum: string, weekStartISO: string, c: Cell | null): { bg: string; ratio: number | null } {
    if (!c) return { bg: '#F4F5F7', ratio: null };
    if (metric === 'gpPct') {
      return { bg: gpBandColor(c.gpPct), ratio: null };
    }
    const goal = goalForCell(shopNum, weekStartISO);
    if (!goal) return { bg: '#F4F5F7', ratio: null };
    const ratio = c.revenue / goal;
    return { bg: revenueBandColor(ratio), ratio };
  }

  const cellLabel = (c: Cell | null): string => {
    if (!c) return '—';
    if (metric === 'revenue') return '$' + Math.round(c.revenue / 1000) + 'k';
    return (c.gpPct * 100).toFixed(0) + '%';
  };

  const revenueLegend = [
    { c: '#5BAA59', l: 'Above 100%' },
    { c: '#A8CE5A', l: '98-100%' },
    { c: '#F5E580', l: '90-98%' },
    { c: '#F4B65C', l: '85-90%' },
    { c: '#ED8E3A', l: '75-85%' },
    { c: '#C9412A', l: 'Below 75%' },
  ];
  const gpLegend = [
    { c: '#5BAA59', l: 'Above 58%' },
    { c: '#A8CE5A', l: '56-58%' },
    { c: '#F5E580', l: '54-56%' },
    { c: '#F4B65C', l: '52-54%' },
    { c: '#ED8E3A', l: '50-52%' },
    { c: '#C9412A', l: 'Below 50%' },
  ];
  const legend = metric === 'revenue' ? revenueLegend : gpLegend;

  return (
    <div className="card mb-6 w-full">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Grid3x3 className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Shop Performance Heatmap — 12 weeks</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-mango-line rounded-lg overflow-hidden">
            <button onClick={() => setMetric('revenue')}
              className={`px-3 py-1.5 text-sm font-medium ${metric === 'revenue' ? 'bg-mango-info text-white' : ''}`}>Revenue</button>
            <button onClick={() => setMetric('gpPct')}
              className={`px-3 py-1.5 text-sm font-medium ${metric === 'gpPct' ? 'bg-mango-info text-white' : ''}`}>GP %</button>
          </div>
        </div>
      </div>
      <p className="text-xs text-mango-muted mb-3">
        {metric === 'revenue'
          ? "Weekly revenue vs the shop's weekly goal. Current week is prorated by working-days elapsed (Mon-Fri, minus holidays). Hover any below-goal cell for the biggest lever."
          : "GP% per week. Fixed thresholds against the 58% target."}
      </p>

      {/* Color legend */}
      <div className="flex items-center gap-0 mb-3 text-[10px]">
        {legend.map((b, i) => (
          <div key={i} className="flex-1 text-center py-1 font-medium" style={{ background: b.c, color: bandTextColor(b.c) }}>{b.l}</div>
        ))}
      </div>

      {!data ? (
        <div className="h-[260px] animate-pulse bg-mango-bg rounded-md" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate" style={{ borderSpacing: '2px' }}>
            <thead>
              <tr>
                <th className="text-left text-xs font-medium text-mango-muted px-2 py-1 w-32">Shop</th>
                {data.weeks.map((w, i) => (
                  <th key={i} className="text-[10px] font-medium text-mango-muted px-1">{format(new Date(w + 'T12:00:00'), 'M/d')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.shops.map((r) => {
                const shopMeta = SHOPS.find(s => s.num === r.shopNum);
                return (
                <tr key={r.shopNum}>
                  <td className="px-2 py-1 text-sm font-medium whitespace-nowrap">
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: shopMeta?.color }} />
                    {r.shopName}
                  </td>
                  {r.cells.map((c, i) => {
                    const { bg, ratio } = cellBg(r.shopNum, data.weeks[i], c);
                    const fg = bandTextColor(bg);
                    const goalRev = metric === 'revenue' ? goalForCell(r.shopNum, data.weeks[i]) : undefined;
                    const diag = metric === 'revenue' ? diagnose(c, goalRev, r.cells) : null;
                    const tip = c
                      ? `${r.shopName} · week of ${data.weeks[i]} · ${cellLabel(c)}${ratio !== null ? ` (${(ratio*100).toFixed(0)}% of goal)` : ''}${diag ? '\n→ ' + diag : ''}`
                      : 'no data';
                    return (
                      <td key={i}
                        className="px-0 py-0 text-center text-[11px] font-semibold"
                        style={{ background: bg, color: fg, borderRadius: 4, minWidth: 56, height: 30, cursor: diag ? 'help' : 'default' }}
                        title={tip}>
                        {cellLabel(c)}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
