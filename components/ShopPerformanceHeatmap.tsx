'use client';

// Shop Performance Heatmap — one universal warm-amber tonal system. Each cell
// leads with percent-to-goal (large) and shows the raw number as quiet
// context. Good weeks stay subtle; problems darken naturally. The in-progress
// week is marked (blue outline + stripe + "Partial Week"), never alarming.

import { useEffect, useMemo, useState } from 'react';
import { addDays, endOfDay, format, isAfter, startOfDay } from 'date-fns';
import { Grid3x3 } from 'lucide-react';
import { GoalsByShop, loadGoals, workingDaysBetween } from '@/lib/goals';
import {
  HEAT, tierColor, LEGEND, Tier,
  pctTier, gpTier, closeTier, convTier, comebackTier, rebookTier, ratingTier,
} from '@/lib/heatmap';
import { SHOPS } from '@/lib/shops';

interface Cell {
  revenue: number; cars: number; aro: number; closeRate: number;
  gpDollars: number; gpPct: number; partsGpPct: number; laborGpPct: number;
  discounts: number; comebacks?: number; comebackDollars?: number; billedHours?: number;
  rebook?: number; conversion?: number; rating?: number;
}
interface ShopRow { shopNum: string; shopName: string; cells: (Cell | null)[] }
type Metric = 'revenue' | 'gpPct' | 'cars' | 'aro' | 'gpDollars' | 'closeRate' | 'comebacks' | 'billedHours' | 'rebook' | 'conversion' | 'rating';
const METRICS: { key: Metric; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'gpPct', label: 'GP %' },
  { key: 'gpDollars', label: 'GP $' },
  { key: 'cars', label: 'Cars' },
  { key: 'aro', label: 'ARO' },
  { key: 'closeRate', label: 'Close Rate' },
  { key: 'conversion', label: 'Call Conversion' },
  { key: 'rebook', label: 'Re-Book' },
  { key: 'comebacks', label: 'Comebacks' },
  { key: 'billedHours', label: 'Hours' },
  { key: 'rating', label: 'Google Rating' },
];

const fmtK = (n: number) => '$' + Math.round(n / 1000) + 'k';

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

  const now = useMemo(() => new Date(), []);
  const currentIdx = data ? data.weeks.length - 1 : -1; // last col = in-progress week

  function revGoal(shopNum: string, weekStartISO: string): number | undefined {
    const ws = startOfDay(new Date(weekStartISO + 'T12:00:00'));
    const we = endOfDay(addDays(ws, 6));
    const prorate = (weekly: number): number | undefined => {
      if (isAfter(we, now)) {
        const total = workingDaysBetween(ws, we);
        const done = workingDaysBetween(ws, now);
        return total ? weekly * (done / total) : undefined;
      }
      return weekly;
    };
    if (shopNum === 'all') {
      let sum = 0, hasAny = false;
      for (const s of SHOPS) {
        const weekly = goals[s.num]?.revenueWeekly;
        if (!weekly) continue;
        const v = prorate(weekly);
        if (v != null) { sum += v; hasAny = true; }
      }
      return hasAny ? sum : undefined;
    }
    const weekly = goals[shopNum]?.revenueWeekly;
    if (!weekly) return undefined;
    return prorate(weekly);
  }

  // Per-shop trailing median for metrics with no hard goal (cars/ARO/$/hrs)
  // → percent-to-typical, kept consistent with the revenue %-to-goal idea.
  function rowMedian(cells: (Cell | null)[], pick: (c: Cell) => number): number {
    const xs = cells.filter((c): c is Cell => !!c).map(pick).filter((v) => v > 0).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  }
  function colMax(pick: (c: Cell) => number | null | undefined): number {
    let m = 0;
    for (const s of data?.shops || []) for (const c of s.cells) {
      const v = c ? pick(c) : null;
      if (v != null && v > m) m = v;
    }
    return m;
  }

  const allShopsRow = useMemo<ShopRow | null>(() => {
    if (!data) return null;
    const cells: (Cell | null)[] = data.weeks.map((_, wi) => {
      const sc = data.shops.map((s) => s.cells[wi]).filter((c): c is Cell => !!c);
      if (!sc.length) return null;
      const revenue = sc.reduce((a, c) => a + c.revenue, 0);
      const cars = sc.reduce((a, c) => a + c.cars, 0);
      const gpDollars = sc.reduce((a, c) => a + c.gpDollars, 0);
      const carsWeightedCR = sc.reduce((a, c) => a + c.closeRate * c.cars, 0);
      const rebookVals = sc.map((c) => c.rebook).filter((v): v is number => v != null && v >= 0);
      const convVals = sc.map((c) => c.conversion).filter((v): v is number => v != null && v >= 0);
      const ratingVals = sc.map((c) => c.rating).filter((v): v is number => v != null && v > 0);
      return {
        revenue,
        cars,
        aro: cars > 0 ? revenue / cars : 0,
        closeRate: cars > 0 ? carsWeightedCR / cars : 0,
        gpDollars,
        gpPct: revenue > 0 ? gpDollars / revenue : 0,
        partsGpPct: 0,
        laborGpPct: 0,
        discounts: sc.reduce((a, c) => a + c.discounts, 0),
        comebacks: sc.reduce((a, c) => a + (c.comebacks ?? 0), 0),
        comebackDollars: sc.reduce((a, c) => a + (c.comebackDollars ?? 0), 0),
        billedHours: Math.round(sc.reduce((a, c) => a + (c.billedHours ?? 0), 0) * 10) / 10,
        rebook: rebookVals.length ? rebookVals.reduce((a, v) => a + v, 0) / rebookVals.length : undefined,
        conversion: convVals.length ? convVals.reduce((a, v) => a + v, 0) / convVals.length : undefined,
        rating: ratingVals.length ? ratingVals.reduce((a, v) => a + v, 0) / ratingVals.length : undefined,
      };
    });
    return { shopNum: 'all', shopName: 'All Shops', cells };
  }, [data]);

  // Returns { tier, big, small } for one cell under the active metric.
  function render(row: ShopRow, c: Cell | null, wkISO: string): { tier: Tier | null; big: string; small: string } {
    if (!c) return { tier: null, big: '—', small: '' };
    switch (metric) {
      case 'revenue': {
        const g = revGoal(row.shopNum, wkISO);
        if (!g) return { tier: null, big: fmtK(c.revenue), small: 'no goal' };
        const r = c.revenue / g;
        return { tier: pctTier(r), big: fmtK(c.revenue), small: `${Math.round(r * 100)}% of ${fmtK(g)} goal` };
      }
      case 'cars': {
        const med = rowMedian(row.cells, (x) => x.cars);
        const r = med ? c.cars / med : null;
        return { tier: pctTier(r), big: r != null ? Math.round(r * 100) + '%' : String(c.cars), small: `${c.cars}${med ? ` / ~${Math.round(med)}` : ''}` };
      }
      case 'aro': {
        // ARO is a DOLLAR amount — show $ as the primary value; the % is just
        // the shading basis (vs this shop's typical), shown small for context.
        const med = rowMedian(row.cells, (x) => x.aro);
        const r = med ? c.aro / med : null;
        return { tier: pctTier(r), big: '$' + Math.round(c.aro), small: r != null ? Math.round(r * 100) + '% of typ.' : '' };
      }
      case 'gpDollars': {
        const med = rowMedian(row.cells, (x) => x.gpDollars);
        const r = med ? c.gpDollars / med : null;
        return { tier: pctTier(r), big: fmtK(c.gpDollars), small: r != null ? Math.round(r * 100) + '% of typ.' : '' };
      }
      case 'gpPct':
        return { tier: gpTier(c.gpPct), big: (c.gpPct * 100).toFixed(0) + '%', small: 'gross profit' };
      case 'closeRate':
        return { tier: closeTier(c.closeRate), big: (c.closeRate * 100).toFixed(0) + '%', small: 'close rate' };
      case 'conversion': {
        // 1 decimal to match the Employee view's Call Conversion exactly
        // (same cache, same precision — no rounding drift).
        const v = c.conversion == null || c.conversion <= 0 ? null : c.conversion;
        return { tier: convTier(v), big: v == null ? '—' : v.toFixed(1) + '%', small: v == null ? 'no data' : 'calls booked' };
      }
      case 'rebook': {
        // 1 decimal to match the Employee view's Re-Book leaderboard exactly.
        const v = c.rebook == null || c.rebook < 0 ? null : c.rebook;
        return { tier: rebookTier(v), big: v == null ? '—' : v.toFixed(1) + '%', small: v == null ? 'no data' : 're-booked' };
      }
      case 'comebacks': {
        // Show the DOLLAR impact (revenue those comeback hours displaced),
        // not the raw count. Tier still inverts (less $ = better) and scales
        // against the worst cell in view.
        const v = c.comebackDollars ?? 0;
        const big = v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + Math.round(v);
        const n = c.comebacks ?? 0;
        return { tier: comebackTier(v, colMax((x) => x.comebackDollars ?? 0)), big, small: `${n} comeback${n === 1 ? '' : 's'}` };
      }
      case 'billedHours': {
        const med = rowMedian(row.cells, (x) => x.billedHours ?? 0);
        const v = c.billedHours ?? 0;
        const r = med ? v / med : null;
        return { tier: pctTier(r), big: v.toFixed(0) + 'h', small: r != null ? Math.round(r * 100) + '% of typ.' : '' };
      }
      case 'rating': {
        const v = c.rating == null || c.rating <= 0 ? null : c.rating;
        return { tier: ratingTier(v), big: v == null ? '—' : v.toFixed(2) + '★', small: v == null ? 'no data' : 'google rating' };
      }
      default:
        return { tier: null, big: '—', small: '' };
    }
  }

  const hint: Record<Metric, string> = {
    revenue: 'Revenue in dollars. Cell color shows percent of weekly goal. Current week is prorated by working-days elapsed.',
    gpPct: 'Gross-profit % against the 58% target.',
    gpDollars: 'GP dollars vs each shop’s typical week.',
    cars: 'Car count vs each shop’s typical week.',
    aro: 'Average RO vs each shop’s typical week.',
    closeRate: 'Job close rate against an 85% excellent / 55% critical scale.',
    conversion: 'Inbound calls booked (Claude-classified). Blank weeks predate tracking.',
    rebook: 'Customers who re-booked a future visit. Low visual aggression by design.',
    comebacks: 'Comeback $ — revenue the redo/warranty hours displaced. Lower is better; only elevated amounts darken. Count shown below.',
    billedHours: 'Tech hours produced vs each shop’s typical week.',
    rating: 'Cumulative Google rating, captured weekly. History accumulates from when tracking began.',
  };

  return (
    <div className="card mb-8 w-full">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Grid3x3 className="w-[18px] h-[18px] text-mango-faint" />
          <div>
            <h2 className="section-h">Shop Performance</h2>
            <p className="section-sub mt-0.5">12-week view · {hint[metric]}</p>
          </div>
        </div>
        {/* Compact pill legend */}
        <div className="flex items-center gap-3 text-[11px] text-mango-muted">
          {LEGEND.map((l) => (
            <span key={l.tier} className="inline-flex items-center">
              <span className="legend-dot" style={{ background: HEAT[l.tier - 1], boxShadow: 'inset 0 0 0 1px rgba(31,41,55,0.06)' }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Metric segmented control */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {METRICS.map((m) => (
          <button key={m.key} onClick={() => setMetric(m.key)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
              metric === m.key ? 'bg-mango-ink text-white' : 'bg-mango-bg text-mango-muted hover:text-mango-ink'
            }`}>
            {m.label}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="h-[280px] mt-5 animate-pulse bg-mango-bg rounded-xl" />
      ) : (
        <div className="mt-5 rounded-xl border border-mango-line overflow-hidden">
          {/* table-fixed + w-full → the whole grid fits the card; no
              horizontal scroll. Columns share width evenly. */}
          <table className="w-full table-fixed border-separate" style={{ borderSpacing: '3px' }}>
            <colgroup>
              <col style={{ width: '104px' }} />
              {data.weeks.map((_, i) => <col key={i} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="text-left text-[10px] font-medium text-mango-faint px-2 pb-2"></th>
                {data.weeks.map((w, i) => (
                  <th key={i} className="px-0.5 pb-2 align-bottom" style={{ opacity: i === currentIdx ? 0.4 : 1 }}>
                    {i === currentIdx && (
                      <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide text-mango-info leading-tight">Partial</div>
                    )}
                    <div className="text-[10px] font-medium text-mango-faint">{format(new Date(w + 'T12:00:00'), 'M/d')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.shops.map((r, ri) => (
                <tr key={r.shopNum}>
                  <td className="px-2 text-[12px] font-medium text-mango-ink whitespace-nowrap truncate rounded-lg"
                    style={{ background: ri % 2 ? 'rgba(31,41,55,0.018)' : 'transparent' }}>
                    {r.shopName}
                  </td>
                  {r.cells.map((c, i) => {
                    const { tier, big, small } = render(r, c, data.weeks[i]);
                    const { bg, fg } = tierColor(tier);
                    const isCurrent = i === currentIdx;
                    return (
                      <td key={i}
                        className="text-center align-middle overflow-hidden"
                        style={{
                          background: bg, color: fg, borderRadius: 8,
                          height: 44, padding: '3px 2px',
                          boxShadow: isCurrent ? 'inset 0 0 0 1.5px #E08E1A' : 'inset 0 0 0 1px rgba(31,41,55,0.04)',
                          opacity: isCurrent ? 0.4 : 1,
                        }}
                        title={c ? `${r.shopName} · week of ${data.weeks[i]} · ${big}${small ? ` (${small})` : ''}` : 'no data'}>
                        <div className="text-[12px] font-semibold leading-tight tnum">{big}</div>
                        {small && <div className="text-[8.5px] leading-tight tnum truncate" style={{ opacity: 0.5 }}>{small}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Spacer + All Shops combined row */}
              <tr aria-hidden><td colSpan={1 + data.weeks.length} style={{ height: 6, padding: 0 }} /></tr>
              {allShopsRow && (
                <tr key="all">
                  <td className="px-2 text-[12px] font-semibold text-mango-ink whitespace-nowrap truncate rounded-lg"
                    style={{ background: 'rgba(31,41,55,0.07)' }}>
                    All Shops
                  </td>
                  {allShopsRow.cells.map((c, i) => {
                    const { tier, big, small } = render(allShopsRow, c, data.weeks[i]);
                    const { bg, fg } = tierColor(tier);
                    const isCurrent = i === currentIdx;
                    return (
                      <td key={i}
                        className="text-center align-middle overflow-hidden"
                        style={{
                          background: bg, color: fg, borderRadius: 8,
                          height: 44, padding: '3px 2px',
                          boxShadow: isCurrent ? 'inset 0 0 0 1.5px #E08E1A' : 'inset 0 0 0 1px rgba(31,41,55,0.04)',
                          opacity: isCurrent ? 0.4 : 1,
                        }}
                        title={c ? `All Shops · week of ${data.weeks[i]} · ${big}${small ? ` (${small})` : ''}` : 'no data'}>
                        <div className="text-[12px] font-semibold leading-tight tnum">{big}</div>
                        {small && <div className="text-[8.5px] leading-tight tnum truncate" style={{ opacity: 0.5 }}>{small}</div>}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
