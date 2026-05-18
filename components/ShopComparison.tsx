'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, GitCompareArrows } from 'lucide-react';
import { SHOPS } from '@/lib/shops';
import LineChartBlock, { LineSeries } from './charts/LineChartBlock';
import type { ComparisonMode, RangeKey } from '@/lib/dates';

type Granularity = 'daily' | 'weekly' | 'monthly';
type CompMode = 'none' | ComparisonMode;
type DailyByShop = Record<string, { date: string; revenue: number }[]>;

const RANGES: { value: RangeKey; label: string }[] = [
  { value: 'this_week',      label: 'This Week' },
  { value: 'last_week',      label: 'Last Week' },
  { value: 'this_month',     label: 'This Month' },
  { value: 'last_month',     label: 'Last Month' },
  { value: 'this_quarter',   label: 'This Quarter' },
  { value: 'last_quarter',   label: 'Last Quarter' },
  { value: 'this_year',      label: 'This Year' },
  { value: 'last_year',      label: 'Last Year' },
  { value: 'last_30_days',   label: 'Last 30 Days' },
  { value: 'last_60_days',   label: 'Last 60 Days' },
  { value: 'last_90_days',   label: 'Last 90 Days' },
  { value: 'last_365_days',  label: 'Last 365 Days' },
  { value: 'custom',         label: 'Custom' },
];
const COMPARISON_OPTIONS: { value: CompMode; label: string }[] = [
  { value: 'none',                   label: 'No Comparison' },
  { value: 'previous_period',        label: 'Previous Period' },
  { value: 'same_period_last_year',  label: 'Same Period Last Year' },
  { value: 'custom',                 label: 'Custom Range' },
];

function isWeekendStr(ymd: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

export default function ShopComparison() {
  // Self-contained range so this chart isn't tied to the page-level filter.
  const [range, setRange] = useState<RangeKey>('last_30_days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SHOPS.map((s) => [s.num, true]))
  );
  const [granularity, setGranularity] = useState<Granularity>('weekly');
  const [comparison, setComparison] = useState<CompMode>('none');
  const [compStart, setCompStart] = useState<string>('');
  const [compEnd, setCompEnd] = useState<string>('');
  const [dailyByShop, setDailyByShop] = useState<DailyByShop | null>(null);
  const [compDaily, setCompDaily] = useState<DailyByShop | null>(null);

  // Fetch current-period dailyByShop whenever range changes.
  useEffect(() => {
    if (range === 'custom' && (!customStart || !customEnd)) return;
    const p: Record<string, string> = { range };
    if (range === 'custom') { p.start = customStart; p.end = customEnd; }
    setDailyByShop(null);
    let cancelled = false;
    fetch(`/api/metrics?${new URLSearchParams(p)}`).then(r => r.json()).then(d => {
      if (cancelled) return;
      if (d?.dailyByShop) setDailyByShop(d.dailyByShop);
    });
    return () => { cancelled = true; };
  }, [range, customStart, customEnd]);

  // Fetch comparison-period dailyByShop when comparison changes.
  useEffect(() => {
    setCompDaily(null);
    if (comparison === 'none') return;
    if (comparison === 'custom' && (!compStart || !compEnd)) return;
    const p: Record<string, string> = { range: 'custom' };
    if (comparison === 'custom') {
      p.start = compStart; p.end = compEnd;
    } else {
      p.compare = comparison;
      p.base = range;
      if (range === 'custom' && customStart && customEnd) {
        p.baseStart = customStart; p.baseEnd = customEnd;
      }
    }
    let cancelled = false;
    fetch(`/api/metrics?${new URLSearchParams(p)}`).then(r => r.json()).then(d => {
      if (cancelled) return;
      if (d?.dailyByShop) setCompDaily(d.dailyByShop);
    });
    return () => { cancelled = true; };
  }, [comparison, compStart, compEnd, range, customStart, customEnd]);

  // Weekends are ALWAYS hidden from the daily view so the line doesn't have gaps.
  // Totals/numbers elsewhere still include weekend revenue — this is a chart-display
  // concern only. Weekly and monthly granularities aggregate full weeks/months so
  // weekend revenue is naturally rolled in.
  function bucketize(input: { date: string; revenue: number }[]) {
    let points = input;
    if (granularity === 'daily') {
      points = points.filter(p => !isWeekendStr(p.date));
    }
    if (granularity === 'weekly') {
      const m = new Map<string, number>();
      for (const p of points) {
        const [y, mo, d] = p.date.split('-').map(Number);
        const date = new Date(Date.UTC(y, mo - 1, d));
        const dow = (date.getUTCDay() + 6) % 7; // Mon = 0
        date.setUTCDate(date.getUTCDate() - dow);
        const k = date.toISOString().slice(0, 10);
        m.set(k, (m.get(k) || 0) + p.revenue);
      }
      points = [...m.entries()].sort(([a],[b]) => a < b ? -1 : 1).map(([date, revenue]) => ({ date, revenue }));
    } else if (granularity === 'monthly') {
      const m = new Map<string, number>();
      for (const p of points) {
        const k = p.date.slice(0, 7) + '-01';
        m.set(k, (m.get(k) || 0) + p.revenue);
      }
      points = [...m.entries()].sort(([a],[b]) => a < b ? -1 : 1).map(([date, revenue]) => ({ date, revenue }));
    }
    return points;
  }

  const series: LineSeries[] = useMemo(() => {
    if (!dailyByShop) return [];
    const out: LineSeries[] = [];
    // When a comparison is active, we anchor BOTH series to "step N of N" labels
    // so they're guaranteed to overlay regardless of the two periods having
    // identical day counts or starting day-of-week. This is the robust fix for
    // the "comparison line never shows" bug.
    const useStepIndex = !!compDaily;
    for (const s of SHOPS) {
      if (!selected[s.num]) continue;
      const cur = bucketize(dailyByShop[s.num] || []);
      const prev = compDaily ? bucketize(compDaily[s.num] || []) : null;
      if (useStepIndex && prev) {
        const stepCount = Math.max(cur.length, prev.length);
        const stepLabel = (i: number) => granularity === 'daily' ? `Day ${i + 1}` : granularity === 'weekly' ? `Wk ${i + 1}` : `Mo ${i + 1}`;
        out.push({
          key: s.num, label: s.name, color: s.color,
          data: Array.from({ length: stepCount }, (_, i) => ({ x: stepLabel(i), y: cur[i]?.revenue ?? null as any })),
        });
        out.push({
          key: `${s.num}-cmp`, label: `${s.name} (comp)`, color: s.color, dashed: true,
          data: Array.from({ length: stepCount }, (_, i) => ({ x: stepLabel(i), y: prev[i]?.revenue ?? null as any })),
        });
      } else {
        out.push({ key: s.num, label: s.name, color: s.color, data: cur.map(p => ({ x: p.date, y: p.revenue })) });
      }
    }
    return out;
  }, [dailyByShop, compDaily, selected, granularity]);

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Shop Revenue Comparison</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select value={range} onChange={(e) => setRange(e.target.value as RangeKey)}
              className="appearance-none pl-3 pr-9 py-1.5 bg-white border border-mango-line rounded-lg text-sm font-medium cursor-pointer focus:outline-none focus:border-mango-orange">
              {RANGES.map(r => (<option key={r.value} value={r.value}>{r.label}</option>))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
          </div>
          {range === 'custom' && (
            <div className="flex items-center gap-1">
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                className="px-2 py-1.5 border border-mango-line rounded-lg text-sm" />
              <span className="text-mango-muted text-xs">→</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2 py-1.5 border border-mango-line rounded-lg text-sm" />
            </div>
          )}
          <div className="flex bg-white border border-mango-line rounded-lg overflow-hidden">
            {(['daily', 'weekly', 'monthly'] as Granularity[]).map((g) => (
              <button key={g}
                onClick={() => setGranularity(g)}
                className={`px-3 py-1.5 text-sm font-medium capitalize ${granularity === g ? 'bg-mango-info text-white' : ''}`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="relative">
            <select value={comparison} onChange={(e) => setComparison(e.target.value as CompMode)}
              className="appearance-none pl-3 pr-9 py-1.5 bg-white border border-mango-line rounded-lg text-sm font-medium cursor-pointer focus:outline-none focus:border-mango-orange">
              {COMPARISON_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
          </div>
          {comparison === 'custom' && (
            <div className="flex items-center gap-1">
              <input type="date" value={compStart} onChange={(e) => setCompStart(e.target.value)}
                className="px-2 py-1.5 border border-mango-line rounded-lg text-sm" />
              <span className="text-mango-muted text-xs">→</span>
              <input type="date" value={compEnd} onChange={(e) => setCompEnd(e.target.value)}
                className="px-2 py-1.5 border border-mango-line rounded-lg text-sm" />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
        {SHOPS.map((s) => (
          <label key={s.num} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={!!selected[s.num]}
              onChange={() => setSelected({ ...selected, [s.num]: !selected[s.num] })}
              className="accent-mango-info"
            />
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            <span>{s.name}</span>
          </label>
        ))}
      </div>

      {!dailyByShop ? (
        <div className="h-[520px] animate-pulse bg-mango-bg rounded-md" />
      ) : (
        <LineChartBlock series={series} height={520} xType={compDaily ? 'category' : 'date'} />
      )}
    </div>
  );
}
