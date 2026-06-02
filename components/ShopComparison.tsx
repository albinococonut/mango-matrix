'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, GitCompareArrows } from 'lucide-react';
import { SHOPS } from '@/lib/shops';
import LineChartBlock, { LineSeries } from './charts/LineChartBlock';
import type { ComparisonMode, RangeKey } from '@/lib/dates';

type Granularity = 'daily' | 'weekly' | 'monthly';
type CompMode = 'none' | ComparisonMode;
type DailyByShop = Record<string, { date: string; revenue: number; cars: number }[]>;

// All metrics. ONLY revenue has true daily data (/api/metrics), so it keeps
// the daily/weekly/monthly + comparison controls. Every other metric is
// weekly-only (sourced from the Shop Performance heatmap), so for those we
// hide the granularity selector and just plot weekly lines per shop.
type MetricKey = 'revenue' | 'gpPct' | 'gpDollars' | 'cars' | 'aro' | 'closeRate' | 'conversion' | 'rebook' | 'comebacks' | 'hours';
type Fmt = 'usd' | 'pct' | 'num' | 'hrs';
const METRICS: { key: MetricKey; label: string; fmt: Fmt; field?: string; scale?: number }[] = [
  { key: 'revenue',    label: 'Revenue',         fmt: 'usd' },
  { key: 'gpPct',      label: 'GP %',            fmt: 'pct', field: 'gpPct', scale: 100 },
  { key: 'gpDollars',  label: 'GP $',            fmt: 'usd', field: 'gpDollars' },
  { key: 'cars',       label: 'Cars',            fmt: 'num', field: 'cars' },
  { key: 'aro',        label: 'ARO',             fmt: 'usd', field: 'aro' },
  { key: 'closeRate',  label: 'Close Rate',      fmt: 'pct', field: 'closeRate', scale: 100 },
  { key: 'conversion', label: 'Call Conversion', fmt: 'pct', field: 'conversion' },
  { key: 'rebook',     label: 'Re-Book',         fmt: 'pct', field: 'rebook' },
  { key: 'comebacks',  label: 'Comebacks $',     fmt: 'usd', field: 'comebackDollars' },
  { key: 'hours',      label: 'Hours',           fmt: 'hrs', field: 'billedHours' },
];

interface HeatCell { [k: string]: number | null | undefined }
interface HeatmapResp { weeks: string[]; shops: { shopNum: string; shopName: string; cells: (HeatCell | null)[] }[] }
const WEEK_OPTIONS = [8, 12, 26];

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
function fmtVal(fmt: Fmt, v: number): string {
  if (fmt === 'usd') return v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + Math.round(v);
  if (fmt === 'pct') return v.toFixed(1) + '%';
  if (fmt === 'hrs') return Math.round(v) + 'h';
  return Math.round(v).toLocaleString();
}
function weekLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function ShopComparison() {
  const [metric, setMetric] = useState<MetricKey>('revenue');
  const isRevenue = metric === 'revenue';
  const meta = METRICS.find(m => m.key === metric)!;

  // shared
  const [shopSel, setShopSel] = useState<string>('all');

  // --- revenue (daily) path state ---
  const [range, setRange] = useState<RangeKey>('this_quarter');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [granularity, setGranularity] = useState<Granularity>('weekly');
  const [comparison, setComparison] = useState<CompMode>('previous_period');
  const [compStart, setCompStart] = useState<string>('');
  const [compEnd, setCompEnd] = useState<string>('');
  const [dailyByShop, setDailyByShop] = useState<DailyByShop | null>(null);
  const [compDaily, setCompDaily] = useState<DailyByShop | null>(null);
  const [compLoading, setCompLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // --- non-revenue (weekly heatmap) path state ---
  const [heat, setHeat] = useState<HeatmapResp | null>(null);
  const [weeks, setWeeks] = useState<number>(12);

  const SS_PREFIX = 'shopComp:v1:';
  function readCache(key: string): DailyByShop | null {
    try { const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(SS_PREFIX + key) : null; return raw ? JSON.parse(raw) as DailyByShop : null; } catch { return null; }
  }
  function writeCache(key: string, v: DailyByShop) {
    try { if (typeof window !== 'undefined') window.sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(v)); } catch {}
  }

  // Revenue: current-period dailyByShop.
  useEffect(() => {
    if (!isRevenue) return;
    if (range === 'custom' && (!customStart || !customEnd)) return;
    const p: Record<string, string> = { range };
    if (range === 'custom') { p.start = customStart; p.end = customEnd; }
    const qs = new URLSearchParams(p).toString();
    const cached = readCache('cur:' + qs);
    if (cached) { setDailyByShop(cached); setRefreshing(true); } else { setDailyByShop(null); setRefreshing(false); }
    let cancelled = false;
    fetch(`/api/metrics?${qs}`).then(r => r.json()).then(d => {
      if (cancelled) return;
      if (d?.dailyByShop) { setDailyByShop(d.dailyByShop); writeCache('cur:' + qs, d.dailyByShop); }
    }).finally(() => { if (!cancelled) setRefreshing(false); });
    return () => { cancelled = true; };
  }, [isRevenue, range, customStart, customEnd]);

  // Revenue: comparison-period dailyByShop.
  useEffect(() => {
    if (!isRevenue) { setCompDaily(null); return; }
    if (comparison === 'none') { setCompDaily(null); setCompLoading(false); return; }
    if (comparison === 'custom' && (!compStart || !compEnd)) { setCompDaily(null); setCompLoading(false); return; }
    const p: Record<string, string> = { range: 'custom' };
    if (comparison === 'custom') { p.start = compStart; p.end = compEnd; }
    else { p.compare = comparison; p.base = range; if (range === 'custom' && customStart && customEnd) { p.baseStart = customStart; p.baseEnd = customEnd; } }
    const qs = new URLSearchParams(p).toString();
    const cached = readCache('cmp:' + qs);
    if (cached) { setCompDaily(cached); setCompLoading(false); } else { setCompDaily(null); setCompLoading(true); }
    let cancelled = false;
    fetch(`/api/metrics?${qs}`).then(r => r.json()).then(d => {
      if (cancelled) return;
      if (d?.dailyByShop) { setCompDaily(d.dailyByShop); writeCache('cmp:' + qs, d.dailyByShop); }
    }).finally(() => { if (!cancelled) setCompLoading(false); });
    return () => { cancelled = true; };
  }, [isRevenue, comparison, compStart, compEnd, range, customStart, customEnd]);

  // Non-revenue: weekly heatmap.
  useEffect(() => {
    if (isRevenue) return;
    setHeat(null);
    fetch(`/api/shop-performance-heatmap?weeks=${weeks}`).then(r => r.json())
      .then(j => setHeat(j && Array.isArray(j.shops) ? j : null)).catch(() => setHeat(null));
  }, [isRevenue, weeks]);

  function bucketize(input: { date: string; v: number }[]) {
    let points = input;
    if (granularity === 'daily') points = points.filter(p => !isWeekendStr(p.date));
    if (granularity === 'weekly') {
      const m = new Map<string, number>();
      for (const p of points) {
        const [y, mo, d] = p.date.split('-').map(Number);
        const date = new Date(Date.UTC(y, mo - 1, d));
        const dow = (date.getUTCDay() + 6) % 7;
        date.setUTCDate(date.getUTCDate() - dow);
        const k = date.toISOString().slice(0, 10);
        m.set(k, (m.get(k) || 0) + p.v);
      }
      points = [...m.entries()].sort(([a],[b]) => a < b ? -1 : 1).map(([date, v]) => ({ date, v }));
    } else if (granularity === 'monthly') {
      const m = new Map<string, number>();
      for (const p of points) { const k = p.date.slice(0, 7) + '-01'; m.set(k, (m.get(k) || 0) + p.v); }
      let arr = [...m.entries()].sort(([a],[b]) => a < b ? -1 : 1).map(([date, v]) => ({ date, v }));
      const earliest = points.reduce((min, p) => (p.date < min ? p.date : min), points[0]?.date ?? '');
      if (arr.length > 1 && earliest && earliest.slice(8, 10) !== '01') arr = arr.slice(1);
      points = arr;
    }
    return points;
  }

  const series: LineSeries[] = useMemo(() => {
    const out: LineSeries[] = [];
    if (isRevenue) {
      if (!dailyByShop) return [];
      const useStepIndex = !!compDaily;
      for (const s of SHOPS) {
        if (shopSel !== 'all' && shopSel !== s.num) continue;
        const cur = bucketize((dailyByShop[s.num] || []).map(p => ({ date: p.date, v: p.revenue })));
        const prev = compDaily ? bucketize((compDaily[s.num] || []).map(p => ({ date: p.date, v: p.revenue }))) : null;
        if (useStepIndex && prev) {
          const stepCount = Math.max(cur.length, prev.length);
          const stepLabel = (i: number) => granularity === 'daily' ? `Day ${i + 1}` : granularity === 'weekly' ? `Wk ${i + 1}` : `Mo ${i + 1}`;
          out.push({ key: s.num, label: s.name, color: s.color, data: Array.from({ length: stepCount }, (_, i) => ({ x: stepLabel(i), y: cur[i]?.v ?? null as any })) });
          out.push({ key: `${s.num}-cmp`, label: `${s.name} (comp)`, color: s.color, dashed: true, data: Array.from({ length: stepCount }, (_, i) => ({ x: stepLabel(i), y: prev[i]?.v ?? null as any })) });
        } else {
          out.push({ key: s.num, label: s.name, color: s.color, data: cur.map(p => ({ x: p.date, y: p.v })) });
        }
      }
      return out;
    }
    // Non-revenue: weekly heatmap lines.
    if (!heat?.weeks?.length) return [];
    for (const shop of SHOPS) {
      if (shopSel !== 'all' && shopSel !== shop.num) continue;
      const row = heat.shops.find(s => s.shopNum === shop.num);
      if (!row) continue;
      const pts = heat.weeks.map((wk, i) => {
        const cell = row.cells[i];
        const raw = cell ? (cell[meta.field as string] as number | null | undefined) : null;
        const y = raw == null ? null : (meta.scale ? raw * meta.scale : raw);
        return { x: weekLabel(wk), y: y as any };
      });
      out.push({ key: shop.num, label: shop.name, color: shop.color, data: pts });
    }
    return out;
  }, [isRevenue, dailyByShop, compDaily, shopSel, granularity, heat, metric, meta]);

  const loading = isRevenue ? !dailyByShop : !heat;

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Shop by Shop Comparison</h2>
          {isRevenue && (refreshing || compLoading) && dailyByShop && (
            <span className="text-[11px] text-mango-muted italic">refreshing…</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Metric — always. */}
          <div className="relative">
            <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}
              className="appearance-none pl-3 pr-9 py-1.5 bg-white border border-mango-line rounded-lg text-sm font-medium cursor-pointer focus:outline-none focus:border-mango-orange">
              {METRICS.map(m => (<option key={m.key} value={m.key}>{m.label}</option>))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
          </div>
          {/* Shop — always. */}
          <div className="relative">
            <select value={shopSel} onChange={(e) => setShopSel(e.target.value)}
              className="appearance-none pl-3 pr-9 py-1.5 bg-white border border-mango-line rounded-lg text-sm font-medium cursor-pointer focus:outline-none focus:border-mango-orange">
              <option value="all">All Shops</option>
              {SHOPS.map(s => (<option key={s.num} value={s.num}>{s.name}</option>))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
          </div>

          {isRevenue ? (
            <>
              <div className="relative">
                <select value={range} onChange={(e) => setRange(e.target.value as RangeKey)}
                  className="appearance-none pl-3 pr-9 py-1.5 bg-white border border-mango-line rounded-lg text-sm font-medium cursor-pointer focus:outline-none focus:border-mango-orange">
                  {RANGES.map(r => (<option key={r.value} value={r.value}>{r.label}</option>))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
              </div>
              {range === 'custom' && (
                <div className="flex items-center gap-1">
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="px-2 py-1.5 border border-mango-line rounded-lg text-sm" />
                  <span className="text-mango-muted text-xs">→</span>
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="px-2 py-1.5 border border-mango-line rounded-lg text-sm" />
                </div>
              )}
              <div className="flex bg-white border border-mango-line rounded-lg overflow-hidden">
                {(['daily', 'weekly', 'monthly'] as Granularity[]).map((g) => (
                  <button key={g} onClick={() => setGranularity(g)} className={`px-3 py-1.5 text-sm font-medium capitalize ${granularity === g ? 'bg-mango-info text-white' : ''}`}>{g}</button>
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
                  <input type="date" value={compStart} onChange={(e) => setCompStart(e.target.value)} className="px-2 py-1.5 border border-mango-line rounded-lg text-sm" />
                  <span className="text-mango-muted text-xs">→</span>
                  <input type="date" value={compEnd} onChange={(e) => setCompEnd(e.target.value)} className="px-2 py-1.5 border border-mango-line rounded-lg text-sm" />
                </div>
              )}
            </>
          ) : (
            // Non-revenue: weekly only — granularity/comparison hidden; pick how many weeks.
            <div className="flex bg-white border border-mango-line rounded-lg overflow-hidden">
              {WEEK_OPTIONS.map((w) => (
                <button key={w} onClick={() => setWeeks(w)} className={`px-3 py-1.5 text-sm font-medium ${weeks === w ? 'bg-mango-info text-white' : ''}`}>{w}w</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-[520px] animate-pulse bg-mango-bg rounded-md" />
      ) : (
        <div className="relative">
          <LineChartBlock series={series} height={520}
            xType={!isRevenue || compDaily ? 'category' : 'date'}
            formatValue={isRevenue ? undefined : (n) => fmtVal(meta.fmt, n)} />
          {isRevenue && compLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/55 backdrop-blur-[1px] rounded-md">
              <span className="flex items-center gap-2 text-sm font-medium text-mango-ink bg-white border border-mango-line rounded-full px-4 py-2 shadow-sm">
                <span className="w-4 h-4 border-2 border-mango-info border-t-transparent rounded-full animate-spin" />
                Loading comparison period…
              </span>
            </div>
          )}
        </div>
      )}
      {!isRevenue && (metric === 'conversion' || metric === 'rebook') && (
        <div className="text-[10px] text-mango-muted mt-1 text-center">
          Call Conversion / Re-Book history accumulates from when weekly tracking began; earlier weeks may be blank.
        </div>
      )}
    </div>
  );
}
