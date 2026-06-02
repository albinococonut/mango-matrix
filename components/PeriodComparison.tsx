'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart2, ChevronDown } from 'lucide-react';
import { usd } from '@/lib/format';
import LineChartBlock from './charts/LineChartBlock';
import type { ComparisonMode, RangeKey } from '@/lib/dates';

// Each weekly bucket carries every metric; `totals` is the period-level
// aggregate. Matches the /api/period-comparison v2 response.
interface WeekBucket {
  weekStart: string;
  revenue: number; gpDollars: number; gpPct: number; cars: number; aro: number;
  closeRate: number; comebacks: number; hours: number;
  conversion: number | null; rebook: number | null;
}
type Totals = Omit<WeekBucket, 'weekStart'>;
interface Period { label?: string; weeks: WeekBucket[]; totals: Totals }
interface Resp { current: Period; comparison: Period }

type MetricKey = 'revenue' | 'gpPct' | 'gpDollars' | 'cars' | 'aro' | 'closeRate' | 'conversion' | 'rebook' | 'comebacks' | 'hours';
// Daily / Weekly / Monthly. Daily suppresses Conversion + Re-Book (those
// only exist at weekly granularity in the snapshot store). Monthly rolls
// up weekly snapshot means into the matching month.
type Granularity = 'daily' | 'weekly' | 'monthly';
const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
type Fmt = 'usd' | 'pct' | 'num' | 'hrs';
const METRICS: { key: MetricKey; label: string; fmt: Fmt }[] = [
  { key: 'revenue',    label: 'Revenue',         fmt: 'usd' },
  { key: 'gpPct',      label: 'GP %',            fmt: 'pct' },
  { key: 'gpDollars',  label: 'GP $',            fmt: 'usd' },
  { key: 'cars',       label: 'Cars',            fmt: 'num' },
  { key: 'aro',        label: 'ARO',             fmt: 'usd' },
  { key: 'closeRate',  label: 'Close Rate',      fmt: 'pct' },
  { key: 'conversion', label: 'Call Conversion', fmt: 'pct' },
  { key: 'rebook',     label: 'Re-Book',         fmt: 'pct' },
  { key: 'comebacks',  label: 'Comebacks',       fmt: 'num' },
  { key: 'hours',      label: 'Hours',           fmt: 'hrs' },
];

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

function fmtVal(fmt: Fmt, v: number | null): string {
  if (v == null) return '—';
  if (fmt === 'usd') return usd(v);
  if (fmt === 'pct') return v.toFixed(1) + '%';
  if (fmt === 'hrs') return Math.round(v).toLocaleString() + 'h';
  return Math.round(v).toLocaleString();
}

export default function PeriodComparison() {
  const [data, setData] = useState<Resp | null>(null);
  const [metric, setMetric] = useState<MetricKey>('revenue');
  const [range, setRange] = useState<RangeKey>('this_month');
  const [granularity, setGranularity] = useState<Granularity>('weekly');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [comparison, setComparison] = useState<ComparisonMode>('same_period_last_year');
  const [compStart, setCompStart] = useState('');
  const [compEnd, setCompEnd] = useState('');

  useEffect(() => {
    if (range === 'custom' && (!customStart || !customEnd)) return;
    if (comparison === 'custom' && (!compStart || !compEnd)) return;
    const p: Record<string, string> = { range, compare: comparison, granularity };
    if (range === 'custom') { p.start = customStart; p.end = customEnd; }
    if (comparison === 'custom') { p.compStart = compStart; p.compEnd = compEnd; }
    const q = new URLSearchParams(p);
    setData(null);
    fetch(`/api/period-comparison?${q}`)
      .then((r) => r.json())
      .then((j) => setData(j && j.current && j.comparison ? j : null))
      .catch(() => setData(null));
    // metric is intentionally NOT a dependency — the API returns every metric,
    // so switching the dropdown is instant (no refetch).
  }, [range, customStart, customEnd, comparison, compStart, compEnd, granularity]);

  const meta = METRICS.find(m => m.key === metric)!;

  // Align comparison bucket N to current bucket N on the x-axis. Label
  // prefix matches the granularity so the axis reads correctly: Day 1,
  // Day 2 … for daily; Wk 1, Wk 2 … for weekly; Mo 1, Mo 2 … for monthly.
  const { curr, prior } = useMemo(() => {
    const cw = data?.current?.weeks ?? [];
    const pw = data?.comparison?.weeks ?? [];
    const val = (w: WeekBucket | undefined) => (w ? (w[metric] ?? 0) : 0);
    const prefix = granularity === 'daily' ? 'Day' : granularity === 'monthly' ? 'Mo' : 'Wk';
    const curr = cw.map((w, i) => ({ x: `${prefix} ${i + 1}`, y: val(w) }));
    const prior = cw.map((_, i) => ({ x: `${prefix} ${i + 1}`, y: val(pw[i]) }));
    return { curr, prior };
  }, [data, metric, granularity]);

  const curTotal = data?.current?.totals?.[metric] ?? null;
  const compTotal = data?.comparison?.totals?.[metric] ?? null;
  // Ratio metrics → show point delta (e.g. +3.2 pts). Others → relative %.
  const isRatio = meta.fmt === 'pct';
  const delta = (() => {
    if (curTotal == null || compTotal == null) return null;
    if (isRatio) return { kind: 'pts' as const, v: curTotal - compTotal };
    if (compTotal === 0) return null;
    return { kind: 'rel' as const, v: (curTotal - compTotal) / compTotal };
  })();

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Period Comparison</h2>
        </div>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          {/* Metric dropdown — same metrics as Shop Performance */}
          <div className="relative">
            <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}
              className="appearance-none pl-3 pr-9 py-1.5 bg-white border border-mango-line rounded-lg text-sm font-medium cursor-pointer focus:outline-none focus:border-mango-orange">
              {METRICS.map(m => (<option key={m.key} value={m.key}>{m.label}</option>))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
          </div>
          <div className="relative">
            <select value={range} onChange={(e) => setRange(e.target.value as RangeKey)}
              className="appearance-none pl-3 pr-9 py-1.5 bg-white border border-mango-line rounded-lg text-sm font-medium cursor-pointer focus:outline-none focus:border-mango-orange">
              {RANGES.map(r => (<option key={r.value} value={r.value}>{r.label}</option>))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
          </div>
          {/* Granularity toggle — daily / weekly / monthly. Daily mode
              suppresses Conversion + Re-Book (weekly-keyed snapshots). */}
          <div className="relative">
            <select value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)}
              className="appearance-none pl-3 pr-9 py-1.5 bg-white border border-mango-line rounded-lg text-sm font-medium cursor-pointer focus:outline-none focus:border-mango-orange">
              {GRANULARITIES.map(g => (<option key={g.value} value={g.value}>{g.label}</option>))}
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
            formatValue={(n) => fmtVal(meta.fmt, n)}
            series={[
              { key: 'current', label: `Current · ${meta.label}`, color: '#3B82F6', data: curr },
              { key: 'prior',   label: `Comparison · ${meta.label}`, color: '#0F1419', data: prior, dashed: true },
            ]}
          />
          <div className="text-[10px] text-mango-muted mt-1 text-center">
            {granularity === 'daily' ? 'Daily buckets, comparison aligned day-over-day.' : granularity === 'monthly' ? 'Monthly buckets, comparison aligned month-over-month.' : 'Weekly buckets, comparison aligned week-over-week.'}
            {(metric === 'conversion' || metric === 'rebook') && granularity === 'daily' && ' · Call Conversion / Re-Book are not tracked at daily granularity — switch to Weekly or Monthly to see those.'}
            {(metric === 'conversion' || metric === 'rebook') && granularity !== 'daily' && ' Call Conversion / Re-Book history accumulates from when weekly tracking began; earlier buckets may be blank.'}
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="card">
              <div className="text-xs text-mango-muted">Current Period · {meta.label}</div>
              <div className="text-xl font-bold mt-1">{fmtVal(meta.fmt, curTotal)}</div>
            </div>
            <div className="card">
              <div className="text-xs text-mango-muted">Comparison Period · {meta.label}</div>
              <div className="text-xl font-bold mt-1">{fmtVal(meta.fmt, compTotal)}</div>
            </div>
            <div className="card">
              <div className="text-xs text-mango-muted">Change</div>
              <div className={`text-xl font-bold mt-1 ${delta == null ? 'text-mango-muted' : delta.v >= 0 ? 'text-mango-green' : 'text-mango-red'}`}>
                {delta == null ? '—'
                  : delta.kind === 'pts'
                    ? `${delta.v >= 0 ? '↗ +' : '↘ '}${delta.v.toFixed(1)} pts`
                    : `${delta.v >= 0 ? '↗ +' : '↘ '}${(delta.v * 100).toFixed(1)}%`}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
