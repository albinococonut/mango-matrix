'use client';

import { useEffect, useMemo, useState } from 'react';
import { Settings2, ArrowUp, ArrowDown, Trophy } from 'lucide-react';
import type { ChainKpi, ShopKpi } from '@/lib/metrics';
import { customRange, resolveRange, RangeKey } from '@/lib/dates';
import { usd, num, pct } from '@/lib/format';
import { SHOPS, SHOP_BY_NUM } from '@/lib/shops';
import {
  DEFAULT_GOALS, GOALS_STORAGE_KEY as GOALS_KEY,
  GoalsByShop, ShopGoal,
  bandTextColor, gpBandColor, revenueBandColor,
  loadGoals, prorateRevenueGoal, revenueGoalForRange, saveGoals,
} from '@/lib/goals';

// Inline style for a colored cell pill using the heatmap's 6-band palette.
function pillStyle(bg: string): React.CSSProperties {
  return { background: bg, color: bandTextColor(bg) };
}

/** Background color for a generic actual-vs-goal cell, using the 6-band scale. */
function goalBg(actual: number | undefined, goal: number | undefined): string {
  if (actual === undefined || goal === undefined || goal === 0) return '';
  return revenueBandColor(actual / goal);
}

function GoalsModal({ goals, onClose, onSave }: { goals: GoalsByShop; onClose: () => void; onSave: (g: GoalsByShop) => void }) {
  const [draft, setDraft] = useState<GoalsByShop>(() => structuredClone(goals));
  function set(num: string, field: keyof ShopGoal, raw: string) {
    setDraft(d => {
      const next = { ...d, [num]: { ...d[num] } };
      const n = raw === '' ? undefined : Number(raw);
      if (n === undefined || Number.isNaN(n)) delete next[num][field];
      else (next[num] as any)[field] = (field === 'closeRate' || field === 'gpPct' || field === 'noi') ? n / 100 : n;
      return next;
    });
  }
  const v = (num: string, field: keyof ShopGoal) => {
    const g = draft[num]?.[field];
    if (g === undefined) return '';
    return (field === 'closeRate' || field === 'gpPct' || field === 'noi')
      ? String(Math.round((g as number) * 1000) / 10)
      : String(g);
  };
  const fields: { key: keyof ShopGoal; label: string }[] = [
    { key: 'revenueWeekly',    label: '$/Wk' },
    { key: 'revenueMonthly',   label: '$/Mo' },
    { key: 'revenueQuarterly', label: '$/Qtr' },
    { key: 'aro',              label: 'ARO $' },
    { key: 'closeRate',        label: 'Close %' },
    { key: 'gpPct',            label: 'GP %' },
    { key: 'noi',              label: 'NOI %' },
  ];
  return (
    <div className="fixed inset-0 bg-mango-ink/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-card shadow-card p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-1">Edit Shop Goals</h3>
        <p className="text-sm text-mango-muted mb-4">Per-shop targets. Saved locally in this browser. Revenue goals drive cell coloring based on the current time range (weekly / monthly / quarterly).</p>
        <table className="w-full text-sm">
          <thead className="text-xs text-mango-muted">
            <tr className="border-b border-mango-line">
              <th className="py-2 px-2 text-left">Shop</th>
              {fields.map(f => (<th key={f.key} className="py-2 px-2 text-left">{f.label}</th>))}
            </tr>
          </thead>
          <tbody>
            {SHOPS.map(s => (
              <tr key={s.num} className="border-b border-mango-line/60">
                <td className="py-2 px-2 font-medium whitespace-nowrap">{s.num} {s.name}</td>
                {fields.map(f => (
                  <td key={f.key} className="py-2 px-2">
                    <input type="number" inputMode="decimal" value={v(s.num, f.key)} onChange={(e) => set(s.num, f.key, e.target.value)}
                      className="w-24 px-2 py-1 border border-mango-line rounded text-sm focus:outline-none focus:border-mango-orange" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => { localStorage.removeItem(GOALS_KEY); setDraft(DEFAULT_GOALS); }} className="px-4 py-2 border border-mango-line rounded-md text-sm">Reset to Defaults</button>
          <button onClick={onClose} className="px-4 py-2 border border-mango-line rounded-md">Cancel</button>
          <button onClick={() => onSave(draft)} className="px-4 py-2 bg-mango-ink text-white rounded-md font-medium">Save</button>
        </div>
      </div>
    </div>
  );
}

type SortKey = 'rank' | 'shop' | 'revenue' | 'cars' | 'aro' | 'closeRate' | 'gpDollars' | 'gpPct' | 'partsGpPct' | 'laborGpPct' | 'discounts';

export default function ShopPerformanceTable({ kpi, range, customStart, customEnd }: { kpi: ChainKpi | null; range: RangeKey; customStart?: string; customEnd?: string }) {
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goals, setGoals] = useState<GoalsByShop>({});
  // Default = leaderboard: highest revenue-vs-goal ratio is #1.
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => { setGoals(loadGoals()); }, []);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'shop' ? 'asc' : 'desc'); }
  }

  const orderIndex = useMemo(() => new Map<string, number>(SHOPS.map((s, i) => [s.num as string, i])), []);
  const win = useMemo(() => range === 'custom' && customStart && customEnd
    ? customRange(customStart, customEnd)
    : resolveRange(range), [range, customStart, customEnd]);

  // Map shopNum -> { revenueRatio, gpPct, prorated revenue goal } for the leaderboard sort + side panel.
  const ratios = useMemo(() => {
    const out = new Map<string, { revRatio: number | null; gpPct: number; revGoal: number | undefined; revenue: number }>();
    if (!kpi) return out;
    for (const r of kpi.byShop) {
      const g = goals[r.shopNum];
      const rawGoal = revenueGoalForRange(g, range);
      const revGoal = rawGoal ? prorateRevenueGoal(rawGoal, range, win.start, win.end) : undefined;
      out.set(r.shopNum, {
        revenue: r.revenue,
        revGoal,
        revRatio: revGoal ? r.revenue / revGoal : null,
        gpPct: r.gpPct,
      });
    }
    return out;
  }, [kpi, goals, range, win]);

  const rows: ShopKpi[] = useMemo(() => {
    if (!kpi) return [];
    const base = [...kpi.byShop];
    if (sortKey === 'shop') {
      base.sort((a, b) => (orderIndex.get(a.shopNum) ?? 99) - (orderIndex.get(b.shopNum) ?? 99));
      return sortDir === 'desc' ? base.reverse() : base;
    }
    if (sortKey === 'rank') {
      // Default leaderboard: revenue-vs-goal ratio descending; shops without a goal sort last.
      base.sort((a, b) => {
        const ra = ratios.get(a.shopNum)?.revRatio;
        const rb = ratios.get(b.shopNum)?.revRatio;
        if (ra === null && rb === null) return 0;
        if (ra === null) return 1;
        if (rb === null) return -1;
        return sortDir === 'asc' ? (ra as number) - (rb as number) : (rb as number) - (ra as number);
      });
      return base;
    }
    base.sort((a, b) => {
      const va = (a as any)[sortKey] as number;
      const vb = (b as any)[sortKey] as number;
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return base;
  }, [kpi, sortKey, sortDir, orderIndex, ratios]);

  // GP% leaderboard for the side panel (always sorted descending, regardless of table sort).
  const gpLeaderboard = useMemo(() => {
    if (!kpi) return [] as { shopNum: string; shopName: string; gpPct: number }[];
    return [...kpi.byShop].map(r => ({ shopNum: r.shopNum, shopName: r.shopName, gpPct: r.gpPct }))
      .sort((a, b) => b.gpPct - a.gpPct);
  }, [kpi]);

  if (!kpi) return <div className="card animate-pulse h-[300px] mb-6" />;
  const totalRevenue = kpi.totalRevenue;
  const totalCars = kpi.totalCars;
  const avgAro = totalCars ? totalRevenue / totalCars : 0;
  const avgClose = kpi.byShop.length ? kpi.byShop.reduce((s, r) => s + r.closeRate, 0) / kpi.byShop.length : 0;
  const totalGp = kpi.byShop.reduce((s, r) => s + r.gpDollars, 0);
  const avgGpPct = kpi.byShop.length ? kpi.byShop.reduce((s, r) => s + r.gpPct, 0) / kpi.byShop.length : 0;
  const avgPartsGpPct = kpi.byShop.length ? kpi.byShop.reduce((s, r) => s + r.partsGpPct, 0) / kpi.byShop.length : 0;
  const avgLaborGpPct = kpi.byShop.length ? kpi.byShop.reduce((s, r) => s + r.laborGpPct, 0) / kpi.byShop.length : 0;
  const totalDiscounts = kpi.byShop.reduce((s, r) => s + r.discounts, 0);

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Shop Performance Comparison</h2>
        <button onClick={() => setGoalsOpen(true)} className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 border border-mango-line rounded-lg bg-white hover:border-mango-orange">
          <Settings2 className="w-4 h-4" /> Edit Goals
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs font-medium text-mango-muted">
            <tr className="border-b border-mango-line">
              {([
                ['rank','#'], ['shop','Shop'], ['revenue','Revenue'], ['cars','Cars'], ['aro','ARO'],
                ['closeRate','Close Rate'], ['gpDollars','GP$'], ['gpPct','GP%'],
                ['partsGpPct','Parts GP%'], ['laborGpPct','Labor GP%'], ['discounts','Discounts'],
              ] as [SortKey, string][]).map(([k, label]) => (
                <th key={k} onClick={() => toggleSort(k)}
                  className="py-3 px-2 text-left cursor-pointer select-none hover:text-mango-ink">
                  <span className="inline-flex items-center gap-0.5">
                    {label}
                    {sortKey === k && (sortDir === 'asc'
                      ? <ArrowUp className="w-3 h-3" />
                      : <ArrowDown className="w-3 h-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const g = goals[r.shopNum];
              const info = ratios.get(r.shopNum);
              const revGoal = info?.revGoal;
              const revBg = revGoal ? revenueBandColor((info?.revRatio ?? 0)) : '';
              const gpBg = gpBandColor(r.gpPct);
              return (
              <tr key={r.shopNum} className="border-b border-mango-line/60 hover:bg-mango-bg/50">
                <td className="py-3 px-2 text-mango-muted font-semibold text-center">{i + 1}</td>
                <td className="py-3 px-2 font-medium whitespace-nowrap">
                  <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM]?.color }} />
                  {r.shopName}
                </td>
                <td className="py-3 px-2">
                  {revBg ? (
                    <div className="font-semibold px-2 py-0.5 rounded inline-block" style={pillStyle(revBg)}>{usd(r.revenue)}</div>
                  ) : (
                    <div className="font-semibold">{usd(r.revenue)}</div>
                  )}
                  {revGoal && <div className="text-[10px] text-mango-muted mt-0.5">{((info?.revRatio ?? 0)*100).toFixed(0)}% of {usd(revGoal)} prorated goal</div>}
                </td>
                <td className="py-3 px-2 font-medium">{num(r.cars)}</td>
                <td className="py-3 px-2">
                  {g?.aro ? (
                    <div className="font-medium px-2 py-0.5 rounded inline-block" style={pillStyle(revenueBandColor(r.aro / g.aro))}>{usd(r.aro)}</div>
                  ) : (
                    <div className="font-medium">{usd(r.aro)}</div>
                  )}
                  {g?.aro && <div className="text-[10px] text-mango-muted mt-0.5">goal {usd(g.aro)}</div>}
                </td>
                <td className="py-3 px-2">
                  {g?.closeRate ? (
                    <div className="font-medium px-2 py-0.5 rounded inline-block" style={pillStyle(revenueBandColor(r.closeRate / g.closeRate))}>{pct(r.closeRate)}</div>
                  ) : (
                    <div className="font-medium">{pct(r.closeRate)}</div>
                  )}
                  {g?.closeRate && <div className="text-[10px] text-mango-muted mt-0.5">goal {pct(g.closeRate)}</div>}
                </td>
                <td className="py-3 px-2 font-medium">{usd(r.gpDollars)}</td>
                <td className="py-3 px-2">
                  <div className="font-medium px-2 py-0.5 rounded inline-block" style={pillStyle(gpBg)}>{pct(r.gpPct)}</div>
                  {g?.gpPct && <div className="text-[10px] text-mango-muted mt-0.5">goal {pct(g.gpPct)}</div>}
                </td>
                <td className="py-3 px-2 font-medium">{pct(r.partsGpPct)}</td>
                <td className="py-3 px-2 font-medium">{pct(r.laborGpPct)}</td>
                <td className="py-3 px-2 font-medium">{usd(r.discounts)}</td>
              </tr>
              );
            })}
            <tr className="bg-mango-bg/40 font-semibold">
              <td className="py-3 px-2"></td>
              <td className="py-3 px-2">Total / Avg</td>
              <td className="py-3 px-2">Total<br />{usd(totalRevenue)}</td>
              <td className="py-3 px-2">Total<br />{num(totalCars)}</td>
              <td className="py-3 px-2">Avg<br />{usd(avgAro)}</td>
              <td className="py-3 px-2">Avg<br />{pct(avgClose)}</td>
              <td className="py-3 px-2">Total<br />{usd(totalGp)}</td>
              <td className="py-3 px-2">Avg<br />{pct(avgGpPct)}</td>
              <td className="py-3 px-2">Avg<br />{pct(avgPartsGpPct)}</td>
              <td className="py-3 px-2">Avg<br />{pct(avgLaborGpPct)}</td>
              <td className="py-3 px-2">Total<br />{usd(totalDiscounts)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-mango-muted text-center">
        Default rank = revenue vs. prorated goal (highest first). Revenue cells use the 6-band % scale; GP% cells use the fixed band scale (≥58% green).
      </div>

      {goalsOpen && (
        <GoalsModal goals={goals} onClose={() => setGoalsOpen(false)} onSave={(g) => { setGoals(g); saveGoals(g); setGoalsOpen(false); }} />
      )}
    </div>
  );
}
