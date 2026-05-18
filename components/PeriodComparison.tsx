'use client';

import { useEffect, useState } from 'react';
import { BarChart2, ChevronDown } from 'lucide-react';
import { usd } from '@/lib/format';
import LineChartBlock from './charts/LineChartBlock';
import type { ComparisonMode, RangeKey } from '@/lib/dates';

interface Resp {
  current: { series: { date: string; revenue: number }[]; total: number; label?: string };
  comparison: { series: { date: string; revenue: number }[]; total: number; label?: string };
  change: number;
}

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

const COMPARISON_OPTIONS: { value: ComparisonMode; label: string }[] = [
  { value: 'previous_period',        label: 'Previous Period' },
  { value: 'same_period_last_year',  label: 'Same Period Last Year' },
  { value: 'custom',                 label: 'Custom Range' },
];

export default function PeriodComparison() {
  const [data, setData] = useState<Resp | null>(null);
  const [noWeekends, setNoWeekends] = useState(true);
  const [range, setRange] = useState<RangeKey>('this_year');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [comparison, setComparison] = useState<ComparisonMode>('same_period_last_year');
  const [compStart, setCompStart] = useState('');
  const [compEnd, setCompEnd] = useState('');

  useEffect(() => {
    if (range === 'custom' && (!customStart || !customEnd)) return;
    if (comparison === 'custom' && (!compStart || !compEnd)) return;
    const p: Record<string, string> = { range, compare: comparison };
    if (noWeekends) p.no_weekends = '1';
    if (range === 'custom') { p.start = customStart; p.end = customEnd; }
    if (comparison === 'custom') { p.compStart = compStart; p.compEnd = compEnd; }
    const q = new URLSearchParams(p);
    setData(null);
    fetch(`/api/period-comparison?${q}`)
      .then((r) => r.json())
      .then((j) => setData(j && j.current && j.comparison ? j : null));
  }, [noWeekends, range, customStart, customEnd, comparison, compStart, compEnd]);

  // For long ranges (month / quarter / year / 30-365-day windows) we aggregate to
  // WEEKLY buckets so we're not comparing a Friday to a Monday — revenue is
  // structurally lopsided by day-of-week and a daily line is noisy.
  // For week-length ranges we keep daily, but line up by day-of-week so Mon ↔ Mon.
  const isWeekRange = range === 'this_week' || range === 'last_week';
  const isDailyRange = isWeekRange; // (could expand later)
  const dayKey = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  };
  const weekIndex = (series: { date: string }[], i: number) => {
    if (series.length === 0) return 0;
    const [y0, m0, d0] = series[0].date.split('-').map(Number);
    const start = new Date(Date.UTC(y0, m0 - 1, d0));
    const [y, m, d] = series[i].date.split('-').map(Number);
    const cur = new Date(Date.UTC(y, m - 1, d));
    return Math.floor((cur.getTime() - start.getTime()) / (7 * 86400_000));
  };
  function aggregateWeekly(s: { date: string; revenue: number }[]) {
    const m = new Map<number, number>();
    s.forEach((p, i) => {
      const k = weekIndex(s, i);
      m.set(k, (m.get(k) || 0) + p.revenue);
    });
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, rev]) => ({ x: `Wk ${k + 1}`, y: rev }));
  }
  const curRaw = data?.current?.series ?? [];
  const preRaw = data?.comparison?.series ?? [];
  let curr: { x: string; y: number }[] = [];
  let prior: { x: string; y: number }[] = [];
  if (isDailyRange) {
    // Bucket by day-of-week label so Mon lines up with Mon.
    const dowOrder = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const sumByDow = (s: { date: string; revenue: number }[]) => {
      const m = new Map<string, number>();
      for (const p of s) m.set(dayKey(p.date), (m.get(dayKey(p.date)) || 0) + p.revenue);
      return dowOrder
        .filter(d => m.has(d))
        .map(d => ({ x: d, y: m.get(d) || 0 }));
    };
    curr = sumByDow(curRaw);
    const priorMap = new Map(sumByDow(preRaw).map(p => [p.x, p.y]));
    prior = curr.map(c => ({ x: c.x, y: priorMap.get(c.x) ?? 0 }));
  } else {
    curr = aggregateWeekly(curRaw);
    const priorWeekly = aggregateWeekly(preRaw);
    // Align each prior week N to current week N on the x-axis.
    prior = curr.map((c, i) => ({ x: c.x, y: priorWeekly[i]?.y ?? 0 }));
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Period Comparison</h2>
        </div>
        <div className="flex items-center gap-2 text-sm flex-wrap">
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
          <span className="text-mango-muted text-xs">vs</span>
          <div className="relative">
            <select value={comparison} onChange={(e) => setComparison(e.target.value as ComparisonMode)}
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
          <button onClick={() => setNoWeekends(!noWeekends)}
            className={`px-3 py-1.5 border rounded-lg text-sm font-medium ${noWeekends ? 'bg-mango-ink text-white border-mango-ink' : 'bg-white border-mango-line'}`}>
            No Weekends
          </button>
        </div>
      </div>

      {!data ? (
        <div className="h-[300px] animate-pulse bg-mango-bg rounded-md" />
      ) : (
        <>
          <div className="flex items-center gap-4 text-xs text-mango-muted mb-2">
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-mango-info" /> Current ({data.current.label || ''})</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-mango-ink" style={{ borderTop: '1px dashed currentColor' }} /> Comparison ({data.comparison.label || ''})</span>
          </div>
          <LineChartBlock
            height={280}
            xType="category"
            series={[
              { key: 'current', label: `Current`, color: '#3B82F6', data: curr },
              { key: 'prior',   label: `Comparison`, color: '#0F1419', data: prior, dashed: true },
            ]}
          />
          <div className="text-[10px] text-mango-muted mt-1 text-center">
            {isWeekRange ? 'Aligned by day of week (Mon ↔ Mon).' : 'Aggregated by week so Friday vs Monday comparisons aren\'t skewed.'}
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="card">
              <div className="text-xs text-mango-muted">Current Period</div>
              <div className="text-xl font-bold mt-1">{usd(data.current.total)}</div>
            </div>
            <div className="card">
              <div className="text-xs text-mango-muted">Comparison Period</div>
              <div className="text-xl font-bold mt-1">{usd(data.comparison.total)}</div>
            </div>
            <div className="card">
              <div className="text-xs text-mango-muted">Change</div>
              <div className={`text-xl font-bold mt-1 ${data.change >= 0 ? 'text-mango-green' : 'text-mango-red'}`}>
                {data.change >= 0 ? '↗ +' : '↘ '}{(data.change * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
