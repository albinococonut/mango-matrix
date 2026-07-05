'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, GitCompareArrows } from 'lucide-react';
import { SHOPS } from '@/lib/shops';
import LineChartBlock, { LineSeries } from './charts/LineChartBlock';
import type { ComparisonMode, RangeKey } from '@/lib/dates';

type Granularity = 'daily' | 'weekly' | 'monthly';
type CompMode = 'none' | ComparisonMode;
type DailyByShop = Record<string, { date: string; revenue: number; cars: number }[]>;

// All metrics route through period-comparison and get full comparison support.
// Revenue/Cars additionally support true daily granularity via /api/metrics.
// Call Conversion and Re-Book only have weekly/monthly data (snapshot store),
// so daily granularity auto-downgrades to weekly for those.
const DAILY_METRICS = new Set(['revenue', 'gpPct', 'gpDollars', 'cars', 'aro', 'closeRate', 'comebacks', 'hours']);
const SNAPSHOT_ONLY_METRICS = new Set(['conversion', 'rebook']); // weekly/monthly only

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
  const hasDailyData = DAILY_METRICS.has(metric);
  // Keep isRevenue for backward compat inside the daily-data path.
  const isRevenue = metric === 'revenue';
  const meta = METRICS.find(m => m.key === metric)!;
  // Extract the correct value from a DailyPoint for the active metric.
  const dailyVal = (p: { date: string; revenue: number; cars: number }) =>
    metric === 'cars' ? p.cars : p.revenue;

  // shared
  const [shopSel, setShopSel] = useState<string>('all');

  // Controls — all metrics now share range/granularity/comparison
  const [range, setRange] = useState<RangeKey>('this_quarter');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // Daily granularity is only available for revenue/cars; snapshot-only
  // metrics (conversion, rebook) are weekly/monthly only.
  const [granularity, setGranularity] = useState<Granularity>('weekly');
  const effectiveGranularity: Granularity = SNAPSHOT_ONLY_METRICS.has(metric) && granularity === 'daily' ? 'weekly' : granularity;
  const [comparison, setComparison] = useState<CompMode>('previous_period');
  const [compStart, setCompStart] = useState<string>('');
  const [compEnd, setCompEnd] = useState<string>('');

  // period-comparison response: { current: {weeks:[{weekStart, revenue, gpPct, ...}]}, comparison: ... }
  const [pcData, setPcData] = useState<any | null>(null);
  const [pcLoading, setPcLoading] = useState(false);

  // Heatmap fallback for snapshot-only metrics when no comparison (last N weeks view)
  const [heat, setHeat] = useState<HeatmapResp | null>(null);
  const [weeks, setWeeks] = useState<number>(12);

  // All hasDailyData metrics → period-comparison API (has all metrics, comparison, per-shop)
  useEffect(() => {
    if (!hasDailyData) return;
    if (range === 'custom' && (!customStart || !customEnd)) return;
    if (comparison === 'custom' && (!compStart || !compEnd)) return;
    setPcData(null); setPcLoading(true);
    const p: Record<string, string> = { range, granularity: effectiveGranularity };
    if (shopSel !== 'all') p.shop = shopSel;
    if (range === 'custom') { p.start = customStart; p.end = customEnd; }
    if (comparison !== 'none') { p.compare = comparison; }
    if (comparison === 'custom') { p.compStart = compStart; p.compEnd = compEnd; }
    let cancelled = false;
    fetch(`/api/period-comparison?${new URLSearchParams(p)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setPcData(d && d.current ? d : null); })
      .catch(() => { if (!cancelled) setPcData(null); })
      .finally(() => { if (!cancelled) setPcLoading(false); });
    return () => { cancelled = true; };
  }, [hasDailyData, metric, range, customStart, customEnd, granularity, comparison, compStart, compEnd, shopSel]);

  // Snapshot-only metrics (conversion, rebook) with NO comparison → heatmap for last-N-weeks view
  useEffect(() => {
    if (hasDailyData || comparison !== 'none') return;
    setHeat(null);
    fetch(`/api/shop-performance-heatmap?weeks=${weeks}`).then(r => r.json())
      .then(j => setHeat(j && Array.isArray(j.shops) ? j : null)).catch(() => setHeat(null));
  }, [hasDailyData, comparison, weeks]);

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

  // Extract a metric value from a period-comparison week bucket
  function pcVal(w: any): number {
    if (!w) return 0;
    switch (metric) {
      case 'revenue': return w.revenue || 0;
      case 'gpDollars': return w.gpDollars || 0;
      case 'gpPct': return w.revenue ? (w.gpDollars / w.revenue) * 100 : 0;
      case 'cars': return w.cars || 0;
      case 'aro': return w.cars ? w.revenue / w.cars : 0;
      case 'closeRate': return w.closeRate || 0; // already scaled to %
      case 'conversion': return w.conversion || 0;
      case 'rebook': return w.rebook || 0;
      case 'comebacks': return w.comebacks || 0;
      case 'hours': return w.hours || 0;
      default: return 0;
    }
  }

  const series: LineSeries[] = useMemo(() => {
    const out: LineSeries[] = [];
    const prefix = effectiveGranularity === 'daily' ? 'Day' : effectiveGranularity === 'monthly' ? 'Mo' : 'Wk';

    if (hasDailyData) {
      // All hasDailyData metrics use period-comparison which returns per-shop or chain data
      if (!pcData?.current?.weeks?.length) return [];
      const currWeeks = pcData.current.weeks;
      const compWeeks = comparison !== 'none' ? pcData.comparison?.weeks : null;
      const n = currWeeks.length;

      if (shopSel !== 'all') {
        // Single shop — pcData already filtered to that shop
        const curPts = currWeeks.map((w: any, i: number) => ({ x: `${prefix} ${i + 1}`, y: pcVal(w) }));
        const shop = SHOPS.find(s => s.num === shopSel);
        out.push({ key: shopSel, label: shop?.name ?? shopSel, color: shop?.color ?? '#999', data: curPts });
        if (compWeeks) {
          const cmpPts = currWeeks.map((_: any, i: number) => ({ x: `${prefix} ${i + 1}`, y: pcVal(compWeeks[i]) }));
          out.push({ key: `${shopSel}-cmp`, label: `${shop?.name ?? shopSel} (comp)`, color: shop?.color ?? '#999', dashed: true, data: cmpPts });
        }
      } else {
        // All shops — pcData is chain-wide but we need per-shop lines
        // Fall back to chain-level single line when showing all shops
        // (per-shop comparison requires N separate fetches — show chain trend)
        const curPts = currWeeks.map((w: any, i: number) => ({ x: `${prefix} ${i + 1}`, y: pcVal(w) }));
        out.push({ key: 'chain', label: 'Chain', color: '#3B82F6', data: curPts });
        if (compWeeks) {
          const cmpPts = currWeeks.map((_: any, i: number) => ({ x: `${prefix} ${i + 1}`, y: pcVal(compWeeks[i]) }));
          out.push({ key: 'chain-cmp', label: 'Chain (comp)', color: '#3B82F6', dashed: true, data: cmpPts });
        }
      }
      return out;
    }

    // Snapshot-only metrics with no comparison — heatmap multi-shop lines
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
  }, [hasDailyData, pcData, shopSel, effectiveGranularity, comparison, heat, metric, meta]);

  const loading = hasDailyData ? pcLoading && !pcData : !heat;

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Shop by Shop Comparison</h2>
          {hasDailyData && pcLoading && pcData && (
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

          {hasDailyData ? (
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
            xType="category"
            formatValue={metric === 'revenue' ? undefined : (n) => fmtVal(meta.fmt, n)} />
          {hasDailyData && pcLoading && !pcData && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/55 backdrop-blur-[1px] rounded-md">
              <span className="flex items-center gap-2 text-sm font-medium text-mango-ink bg-white border border-mango-line rounded-full px-4 py-2 shadow-sm">
                <span className="w-4 h-4 border-2 border-mango-info border-t-transparent rounded-full animate-spin" />
                Loading comparison period…
              </span>
            </div>
          )}
        </div>
      )}
      {!hasDailyData && (metric === 'conversion' || metric === 'rebook') && (
        <div className="text-[10px] text-mango-muted mt-1 text-center">
          Call Conversion / Re-Book are tracked weekly — daily granularity auto-uses weekly. History accumulates from when weekly tracking began; earlier periods may be blank.
        </div>
      )}
    </div>
  );
}
