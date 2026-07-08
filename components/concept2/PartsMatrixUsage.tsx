'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Card, Dropdown, ConceptShell, BigStat, MiniStat,
  INK, INK2, FAINT, LINE, AMBER, GOOD, BAD, COOL,
} from '@/components/concept2/kit';
import { SHOPS, DISTRICTS } from '@/lib/shops';
import type { PartsMatrixPayload, PartLine } from '@/app/api/parts-matrix-usage/route';
import type { PartsMatrixReviewEntry } from '@/lib/partsMatrixReview';
import type { PartsWeekBucket } from '@/lib/partsMatrixHistory';

// ── Date range options ───────────────────────────────────────────────────────
const RANGES = [
  { key: 'this_week',    label: 'This Week' },
  { key: 'last_week',    label: 'Last Week' },
  { key: 'this_month',   label: 'This Month' },
  { key: 'last_month',   label: 'Last Month' },
  { key: 'this_quarter', label: 'This Quarter' },
  { key: 'last_quarter', label: 'Last Quarter' },
  { key: 'this_year',    label: 'This Year' },
  { key: 'last_year',    label: 'Last Year' },
  { key: 'last_90_days', label: 'Last 90 Days' },
];

const CHART_RANGES = [
  { key: 'last_90_days', label: 'Last 90 Days' },
  { key: 'last_year',    label: 'Last Year' },
  { key: 'all',         label: 'All Time' },
];

const MODE_OPTS = [
  { key: 'all',    label: 'All' },
  { key: 'posted', label: 'Posted' },
  { key: 'open',   label: 'Open' },
];

const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'manual',    label: 'Manual Override' },
  { key: 'canned',    label: 'Canned Job' },
  { key: 'matrix',    label: 'Matrix' },
  { key: 'no_charge', label: 'No Charge' },
];

const PAGE_SIZE = 20;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Helpers ──────────────────────────────────────────────────────────────────
function rangeToDateParams(range: string): { start: string; end: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  switch (range) {
    case 'this_week': { const dow = now.getDay() || 7; return { start: fmt(shift(now, 1 - dow)), end: fmt(now) }; }
    case 'last_week': { const dow = now.getDay() || 7; const mon = shift(now, 1 - dow - 7); return { start: fmt(mon), end: fmt(shift(mon, 6)) }; }
    case 'this_month': return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: fmt(now) };
    case 'last_month': { const f = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { start: fmt(f), end: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) }; }
    case 'this_quarter': { const q = Math.floor(now.getMonth() / 3); return { start: fmt(new Date(now.getFullYear(), q * 3, 1)), end: fmt(now) }; }
    case 'last_quarter': { const q = Math.floor(now.getMonth() / 3); return { start: fmt(new Date(now.getFullYear(), (q - 1) * 3, 1)), end: fmt(new Date(now.getFullYear(), q * 3, 0)) }; }
    case 'this_year': return { start: fmt(new Date(now.getFullYear(), 0, 1)), end: fmt(now) };
    case 'last_year': { const y = now.getFullYear() - 1; return { start: fmt(new Date(y, 0, 1)), end: fmt(new Date(y, 11, 31)) }; }
    case 'last_90_days': return { start: fmt(shift(now, -90)), end: fmt(now) };
    default: { const dow = now.getDay() || 7; return { start: fmt(shift(now, 1 - dow)), end: fmt(now) }; }
  }
}

function chartCutoff(range: string): Date {
  const d = new Date();
  if (range === 'last_90_days') d.setDate(d.getDate() - 90);
  else if (range === 'last_year') d.setFullYear(d.getFullYear() - 1);
  else d.setFullYear(2024, 0, 1);
  return d;
}

function fmtWeekLabel(w: string): string {
  const d = new Date(w + 'T00:00:00Z');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const usd = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US');
const pct = (n: number) => isFinite(n) ? (n * 100).toFixed(1) + '%' : '—';
const fmtDate = (d: string | null) => d ? d.slice(0, 10) : '—';

// ── Heat-cell helpers (same palette as Diagnostic page) ──────────────────────
const HEAT_STOPS: [number, [number, number, number]][] = [
  [1.00, [122, 192, 230]], [0.80, [139, 205, 197]], [0.60, [193, 214, 142]],
  [0.44, [242, 206, 112]], [0.28, [240, 166, 92]], [0.00, [237, 104, 66]],
];
function heatRGB(s0: number): [number, number, number] {
  const s = Math.max(0, Math.min(1, s0));
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const [hi, c1] = HEAT_STOPS[i]; const [lo, c2] = HEAT_STOPS[i + 1];
    if (s <= hi && s >= lo) { const t = (s - lo) / (hi - lo); return [0, 1, 2].map((k) => Math.round(c2[k] + (c1[k] - c2[k]) * t)) as [number, number, number]; }
  }
  return HEAT_STOPS[s >= 1 ? 0 : HEAT_STOPS.length - 1][1];
}
function heatCell(score: number): React.CSSProperties {
  const [r, g, b] = heatRGB(score);
  return { background: `radial-gradient(135% 160% at 28% -10%, rgba(${r},${g},${b},0.50), rgba(${r},${g},${b},0.16) 70%, rgba(${r},${g},${b},0.08))`, boxShadow: `inset 0 0 0 1px rgba(${r},${g},${b},0.28)` };
}
function norm(v: number, lo: number, hi: number): number { const t = (v - lo) / (hi - lo); return Math.max(0, Math.min(1, t)); }

// ── Portfolio / Districts / Shop-by-Shop tab strip ─────────────────────────────
function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-full p-1" style={{ background: 'rgba(34,32,28,0.05)', border: `1px solid ${LINE}` }}>
      {tabs.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} className="c2ui rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition" style={value === k ? { background: '#fff', color: INK, boxShadow: '0 1px 4px rgba(40,34,26,0.12)' } : { color: INK2, background: 'transparent' }}>{label}</button>
      ))}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────
function TypeBadge({ type, variance }: { type: string; variance: number }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    canned:    { label: 'Canned',     bg: 'rgba(232,134,62,0.12)',  color: '#B5631F' },
    matrix:    { label: 'Matrix',     bg: 'rgba(62,142,94,0.12)',   color: '#3E8E5E' },
    no_charge: { label: 'No Charge',  bg: 'rgba(147,140,129,0.12)', color: '#938C81' },
    manual:    variance < 0
      ? { label: 'Manual ▼', bg: 'rgba(192,90,46,0.12)',  color: '#C05A2E' }
      : { label: 'Manual ▲', bg: 'rgba(62,156,176,0.12)', color: '#3E9CB0' },
  };
  const c = map[type] ?? map.no_charge;
  return (
    <span className="c2ui inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ background: c.bg, color: c.color }}>{c.label}</span>
  );
}

function ReviewStatus({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  if (status === 'approved') return <span className="c2ui inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'rgba(62,142,94,0.12)', color: '#3E8E5E' }}>✓ Approved</span>;
  if (status === 'rejected') return <span className="c2ui inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'rgba(192,90,46,0.1)', color: '#C05A2E' }}>⚑ Flagged</span>;
  return <span className="c2ui inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'rgba(147,140,129,0.1)', color: FAINT }}>Pending</span>;
}

function NotesCell({ id, notes, onSave }: { id: string; notes: string; onSave: (v: string) => void }) {
  const [val, setVal] = useState(notes);
  const ref = useRef(val);
  ref.current = val;
  useEffect(() => { setVal(notes); }, [notes]);
  return (
    <input
      type="text"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { if (ref.current !== notes) onSave(ref.current); }}
      placeholder="Add note…"
      className="c2ui rounded-lg border px-2 py-1 text-[12px] outline-none w-full"
      style={{ background: 'rgba(255,255,255,0.7)', borderColor: 'rgba(34,32,28,0.12)', color: INK, minWidth: 140 }}
    />
  );
}

function ChartTooltip({ active, payload, label, isDollar }: { active?: boolean; payload?: any[]; label?: string; isDollar?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="c2ui rounded-xl px-3 py-2 text-[12px] shadow-lg"
      style={{ background: 'rgba(34,32,28,0.92)', color: '#fff', backdropFilter: 'blur(8px)' }}>
      <div className="font-semibold mb-1.5">{label}</div>
      {payload.map((p: any) => p.value != null && (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color || p.stroke }}>●</span>
          <span style={{ color: 'rgba(255,255,255,0.7)' }}>{p.name}:</span>
          <span className="font-semibold">
            {isDollar ? usd(p.value) : `${Number(p.value).toFixed(1)}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

const COL_HEADERS_BASE = ['RO#', 'Shop', 'Date', 'Status', 'Job', 'Part Name', 'Part #', 'Qty', 'Cost', 'Retail', 'Matrix', 'Variance', 'Type'];
const COL_HEADERS_REVIEW = [...COL_HEADERS_BASE, 'Notes', 'Review'];

const PAGE_SECTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'trends',  label: 'Trends' },
];

// ── Chart palette — shop sparkline colors ────────────────────────────────────
const C_MATRIX  = '#18B6C9';   // bright teal
const C_MANUAL  = '#FF6B4A';   // coral
const C_CANNED  = '#F5A623';   // mango

// ── Main component ───────────────────────────────────────────────────────────
export default function PartsMatrixUsage({ email }: { email: string }) {
  // ── View granularity ──
  const [projView, setProjView] = useState<'portfolio' | 'districts' | 'shops'>('portfolio');

  // ── Table / summary state ──
  const [range, setRange]         = useState('this_week');
  const [mode, setMode]           = useState('posted');
  const [filterType, setFilterType] = useState('manual');
  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(0);
  const [data, setData]           = useState<PartsMatrixPayload | null>(null);
  const [loading, setLoading]     = useState(false);
  const [failed, setFailed]       = useState(false);
  const [reviewMap, setReviewMap] = useState<Record<string, PartsMatrixReviewEntry>>({});

  // ── Chart / history state ──
  const [history, setHistory]         = useState<PartsWeekBucket[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [histBackfilling, setHistBackfilling] = useState(false);
  const [histRemaining, setHistRemaining]     = useState(0);
  const [chartRange, setChartRange]   = useState('last_year');
  const [showComparison, setShowComparison] = useState(false);
  const [histShop, setHistShop]       = useState('all');
  const [showTable, setShowTable] = useState(false);

  // ── Load review state ────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/parts-matrix-review', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.entries) setReviewMap(d.entries); })
      .catch(() => {});
  }, []);

  // ── Load history + auto-backfill ─────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch('/api/parts-matrix-history', { cache: 'no-store', signal: ctrl.signal });
        const d = await res.json() as { buckets: PartsWeekBucket[]; missingCount: number };
        if (!mounted) return;
        setHistory(d.buckets ?? []);
        setHistRemaining(d.missingCount ?? 0);
        setHistLoading(false);

        if ((d.missingCount ?? 0) > 0) {
          setHistBackfilling(true);
          let remaining = d.missingCount;
          while (remaining > 0 && !ctrl.signal.aborted && mounted) {
            const r = await fetch('/api/parts-matrix-history', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batchSize: 2 }),
              signal: ctrl.signal,
            });
            const rd = await r.json() as { remaining: number; done: boolean };
            if (!mounted) break;
            remaining = rd.remaining ?? 0;
            setHistRemaining(remaining);
            const hr = await fetch('/api/parts-matrix-history', { cache: 'no-store', signal: ctrl.signal });
            const hd = await hr.json() as { buckets: PartsWeekBucket[] };
            if (!mounted) break;
            setHistory(hd.buckets ?? []);
            if (rd.done) break;
          }
          if (mounted) setHistBackfilling(false);
        }
      } catch {
        if (mounted) { setHistLoading(false); setHistBackfilling(false); }
      }
    })();

    return () => { mounted = false; ctrl.abort(); };
  }, []);

  // ── Load table data ───────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setPage(0);
    setSearch('');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const { start, end } = rangeToDateParams(range);
      const p = new URLSearchParams({ shop: 'all', start, end, mode });
      const res = await fetch(`/api/parts-matrix-usage?${p}`, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json() as PartsMatrixPayload);
    } catch {
      setFailed(true);
      setData(null);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [range, mode]);

  useEffect(() => { load(); }, [load]);

  // Reset page/search when scope changes (no re-fetch needed — filtered client-side)
  useEffect(() => { setPage(0); setSearch(''); }, [projView]);

  // ── Review handlers ───────────────────────────────────────────────────────
  const handleReview = useCallback(async (
    line: PartLine,
    patch: { status?: 'pending' | 'approved' | 'rejected'; notes?: string },
  ) => {
    const partData = {
      roId: line.roId, roNumber: line.roNumber,
      shopNum: line.shopNum, shopName: line.shopName,
      jobName: line.jobName, partName: line.partName,
      partNumber: line.partNumber,
      varianceCents: line.varianceCents,
      retailCents: line.retailCents, matrixCents: line.matrixCents,
    };
    setReviewMap((prev) => {
      const existing = prev[line.id];
      const now = new Date().toISOString();
      const base: PartsMatrixReviewEntry = existing ?? {
        id: line.id, ...partData, status: 'pending', notes: '', firstSeenAt: now,
      };
      return { ...prev, [line.id]: { ...base, ...patch, ...(patch.status ? { reviewedAt: now } : {}) } };
    });
    fetch('/api/parts-matrix-review', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: line.id, partData, ...patch }),
    }).then((r) => r.json()).then((d) => {
      if (d.entry) setReviewMap((prev) => ({ ...prev, [line.id]: d.entry }));
    }).catch(() => {});
  }, []);

  // ── Chart data ────────────────────────────────────────────────────────────
  const cutoff = chartCutoff(chartRange);
  const primaryWeeks = history.filter((b) => new Date(b.weekStart + 'T00:00:00Z') >= cutoff);
  const histMap = new Map(history.map((b) => [b.weekStart, b]));
  const xInterval = chartRange === 'last_90_days' ? 1 : chartRange === 'last_year' ? 7 : 12;

  const chartData = primaryWeeks
    .filter((pw) => pw.total > 0)
    .map((pw) => {
      const compDate = new Date(pw.weekStart + 'T00:00:00Z');
      compDate.setUTCDate(compDate.getUTCDate() - 364);
      const comp = histMap.get(compDate.toISOString().slice(0, 10));
      const safe = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
      return {
        label: fmtWeekLabel(pw.weekStart),
        matrixPct: safe(pw.matrix, pw.total),
        manualPct: safe(pw.manual, pw.total),
        cannedPct: safe(pw.canned, pw.total),
        lostDollars: pw.lostCents / 100,
        compMatrixPct: comp ? safe(comp.matrix, comp.total) : undefined,
        compManualPct: comp ? safe(comp.manual, comp.total) : undefined,
        compCannedPct: comp ? safe(comp.canned, comp.total) : undefined,
        compLostDollars: comp ? comp.lostCents / 100 : undefined,
      };
    });

  // ── All lines (scope is now controlled by projView display, not filter) ────
  const scopedLines = useMemo(() => data?.lines ?? [], [data]);

  // ── Per-district and per-shop breakdowns for Districts / Shop-by-Shop views
  const districtStats = useMemo(() => {
    if (!data) return [];
    return DISTRICTS.map((d) => {
      const lines = data.lines.filter((l) => SHOPS.find((sh) => sh.num === l.shopNum)?.district === d.name);
      const counts = { total: lines.length, canned: 0, matrix: 0, manual: 0, no_charge: 0 };
      let lostCents = 0;
      for (const l of lines) {
        counts[l.pricingType as keyof typeof counts]++;
        if (l.pricingType === 'manual' && l.varianceCents < 0) lostCents += Math.abs(l.varianceCents);
      }
      return { name: d.name, ...counts, lostCents };
    });
  }, [data]);

  const shopStats = useMemo(() => {
    if (!data) return [];
    return SHOPS.map((sh) => {
      const lines = data.lines.filter((l) => l.shopNum === sh.num);
      const counts = { total: lines.length, canned: 0, matrix: 0, manual: 0, no_charge: 0 };
      let lostCents = 0;
      for (const l of lines) {
        counts[l.pricingType as keyof typeof counts]++;
        if (l.pricingType === 'manual' && l.varianceCents < 0) lostCents += Math.abs(l.varianceCents);
      }
      return { shopNum: sh.num, shopName: sh.name, district: sh.district, ...counts, lostCents };
    });
  }, [data]);

  const s = useMemo(() => {
    if (!data) return null;
    const counts = { total: scopedLines.length, canned: 0, matrix: 0, manual: 0, no_charge: 0 };
    let manualRevenueLostCents = 0, manualRevenueGainedCents = 0;
    for (const l of scopedLines) {
      counts[l.pricingType as keyof typeof counts]++;
      if (l.pricingType === 'manual') {
        if (l.varianceCents < 0) manualRevenueLostCents += Math.abs(l.varianceCents);
        else manualRevenueGainedCents += l.varianceCents;
      }
    }
    return { ...counts, manualRevenueLostCents, manualRevenueGainedCents };
  }, [data, scopedLines]);

  // ── Table ─────────────────────────────────────────────────────────────────
  const showReviewCols = filterType === 'manual' || filterType === 'all';
  const COL_HEADERS = showReviewCols ? COL_HEADERS_REVIEW : COL_HEADERS_BASE;

  const filtered: PartLine[] = scopedLines.filter((l) => {
    if (filterType !== 'all' && l.pricingType !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        l.partName.toLowerCase().includes(q) ||
        l.partNumber.toLowerCase().includes(q) ||
        l.jobName.toLowerCase().includes(q) ||
        String(l.roNumber).includes(q) ||
        l.shopNum.includes(q) ||
        l.shopName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const pendingCount = scopedLines.filter(
    (l) => l.pricingType === 'manual' && (reviewMap[l.id]?.status ?? 'pending') === 'pending',
  ).length;

  const axisStyle = { fontSize: 11, fill: FAINT };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ConceptShell
      active="parts-matrix"
      title="Parts Pricing"
      sub="Per-part classification · approve manual overrides · matrix vs canned"
      email={email}
      sections={PAGE_SECTIONS}
      headerRight={null}
    >
      {/* ── Inline controls strip ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <span className="c2ui text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: FAINT }}>Timeframe</span>
          <Dropdown value={range} onChange={setRange} opts={RANGES} />
        </div>
        {loading && (
          <div className="c2ui text-[12px] flex items-center gap-1.5" style={{ color: FAINT }}>
            <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
            Loading…
          </div>
        )}
        {failed && <span className="c2ui text-[12px]" style={{ color: BAD }}>Failed — try a shorter range</span>}
      </div>

      {/* ── Summary stats ─────────────────────────────────────────────────── */}
      <Card id="summary" eyebrow="Current period" title="Pricing breakdown" right={
        <div className="flex items-center gap-2">
          <Tabs tabs={[['portfolio', 'Portfolio'], ['districts', 'Districts'], ['shops', 'Shop-by-Shop']]} value={projView} onChange={(v) => setProjView(v as any)} />
          <Dropdown value={mode} onChange={setMode} opts={MODE_OPTS} />
        </div>
      }>
        {s ? (<>
          {/* ── Portfolio view ─────────────────────────────────────────────── */}
          {projView === 'portfolio' && (<>
            <div className="rounded-3xl p-6 mb-4" style={{ background: 'linear-gradient(160deg, rgba(139,205,197,0.12), rgba(242,206,112,0.08) 55%, rgba(232,134,62,0.10))', border: `1px solid ${LINE}` }}>
              <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-center">
                <div>
                  <BigStat
                    label="Matrix priced"
                    value={pct(s.matrix / s.total)}
                    sub={`${s.matrix.toLocaleString()} of ${s.total.toLocaleString()} parts correctly matrix-priced`}
                    color={GOOD}
                  />
                  <div className="flex flex-wrap gap-x-6 gap-y-1 mt-5 c2ui text-[13px]" style={{ color: INK2 }}>
                    <span>Canned <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 16 }}>{pct(s.canned / s.total)}</span></span>
                    <span>Manual <span className="c2disp tabular-nums" style={{ color: s.total > 0 && s.manual / s.total > 0.15 ? BAD : INK, fontSize: 16 }}>{pct(s.manual / s.total)}</span></span>
                    <span>No charge <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 16 }}>{s.no_charge.toLocaleString()}</span></span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="Canned job" value={pct(s.canned / s.total)} />
                  <MiniStat label="Manual" value={pct(s.manual / s.total)} />
                  <MiniStat label="No charge" value={s.no_charge.toLocaleString()} />
                  <MiniStat label="Total parts" value={s.total.toLocaleString()} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(150deg, rgba(232,134,62,0.12), rgba(242,206,112,0.10))', border: `1px solid rgba(232,134,62,0.25)` }}>
                <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: '#B5631F' }}>Revenue left on table</div>
                <div className="c2disp tabular-nums mt-1.5" style={{ color: INK, fontSize: 32, letterSpacing: '-0.02em' }}>{usd(s.manualRevenueLostCents / 100)}</div>
                <div className="c2ui text-[12.5px] mt-1" style={{ color: INK2 }}>manual parts underpriced vs matrix</div>
              </div>
              <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}>
                <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>Revenue above matrix</div>
                <div className="c2disp tabular-nums mt-1.5" style={{ color: INK, fontSize: 32, letterSpacing: '-0.02em' }}>{usd(s.manualRevenueGainedCents / 100)}</div>
                <div className="c2ui text-[12.5px] mt-1" style={{ color: INK2 }}>manual parts overpriced vs matrix</div>
              </div>
            </div>
          </>)}

          {/* ── Districts view ──────────────────────────────────────────────── */}
          {projView === 'districts' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {districtStats.map((d) => {
                const sc = d.total > 0 ? norm(d.matrix / d.total, 0.55, 0.95) : 0.5;
                return (
                  <div key={d.name} className="rounded-3xl p-5" style={heatCell(sc)}>
                    <div className="c2disp" style={{ color: INK, fontSize: 19 }}>{d.name}</div>
                    <div className="c2disp tabular-nums mt-2" style={{ color: INK, fontSize: 30, letterSpacing: '-0.02em' }}>{pct(d.matrix / d.total)}</div>
                    <div className="c2ui text-[12px] mt-0.5" style={{ color: INK2 }}>matrix priced</div>
                    <div className="c2ui text-[13px] mt-3 flex flex-wrap gap-x-4 gap-y-1" style={{ color: INK2 }}>
                      <span>Manual {pct(d.manual / d.total)}</span>
                      <span>Lost {usd(d.lostCents / 100)}</span>
                      <span>{d.total.toLocaleString()} parts</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Shop-by-Shop view ───────────────────────────────────────────── */}
          {projView === 'shops' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
              {shopStats.map((sh) => {
                const sc = sh.total > 0 ? norm(sh.matrix / sh.total, 0.55, 0.95) : 0.5;
                return (
                  <div key={sh.shopNum} className="rounded-3xl p-5" style={heatCell(sc)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="c2disp" style={{ color: INK, fontSize: 17 }}>{sh.shopName}</div>
                      <span className="c2ui text-[12px] font-semibold rounded-full px-2 py-0.5 shrink-0" style={{ background: 'rgba(255,255,255,0.6)', color: INK2 }}>{sh.district}</span>
                    </div>
                    <div className="c2disp tabular-nums mt-2" style={{ color: INK, fontSize: 28, letterSpacing: '-0.02em' }}>{pct(sh.matrix / sh.total)}</div>
                    <div className="c2ui text-[12px] mt-0.5" style={{ color: INK2 }}>matrix priced</div>
                    <div className="c2ui text-[13px] mt-3 flex flex-wrap gap-x-4 gap-y-1" style={{ color: INK2 }}>
                      <span>Manual {pct(sh.manual / sh.total)}</span>
                      <span>Lost {usd(sh.lostCents / 100)}</span>
                      <span>{sh.total.toLocaleString()} parts</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Parts detail expand (A/R pattern) ──────────────────────────── */}
          <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${LINE}` }}>
            <button onClick={() => setShowTable((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
              <span className="c2ui text-[12.5px] font-semibold uppercase tracking-wide flex items-center gap-2" style={{ color: FAINT }}>
                Parts detail · {scopedLines.length.toLocaleString()} parts
                {pendingCount > 0 && (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold" style={{ background: BAD, color: '#fff' }}>{pendingCount > 9 ? '9+' : pendingCount}</span>
                )}
              </span>
              <span className="c2ui inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: INK2 }}>
                {showTable ? 'Hide' : 'Show all'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showTable ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><path d="M6 9l6 6 6-6" /></svg>
              </span>
            </button>

            {showTable && (
              <div className="mt-4 -mx-6 -mb-5">
                <div className="px-6 pt-1 pb-4 flex flex-wrap gap-3 items-center" style={{ borderBottom: `1px solid ${LINE}` }}>
                  <div className="inline-flex rounded-full p-1 gap-0.5" style={{ background: 'rgba(34,32,28,0.05)', border: `1px solid ${LINE}` }}>
                    {TYPE_FILTERS.map((f) => (
                      <button key={f.key} onClick={() => { setFilterType(f.key); setPage(0); }}
                        className="c2ui rounded-full px-3 py-1 text-[12px] font-semibold transition relative"
                        style={filterType === f.key
                          ? { background: '#fff', color: INK, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                          : { color: INK2 }}>
                        {f.label}
                        {f.key === 'manual' && pendingCount > 0 && (
                          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold"
                            style={{ background: BAD, color: '#fff' }}>{pendingCount > 9 ? '9+' : pendingCount}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    placeholder="Search part, job, RO#, shop…"
                    className="c2ui rounded-full border px-3.5 py-1.5 text-[12.5px] outline-none flex-1 min-w-[200px]"
                    style={{ background: 'rgba(255,255,255,0.7)', borderColor: 'rgba(34,32,28,0.12)', color: INK }} />
                  <div className="c2ui text-[12px] shrink-0" style={{ color: FAINT }}>{filtered.length.toLocaleString()} parts</div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="w-full" style={{ minWidth: showReviewCols ? 1240 : 1000, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                        {COL_HEADERS.map((h) => (
                          <th key={h} className="c2ui text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.13em] whitespace-nowrap"
                            style={{ color: FAINT }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={COL_HEADERS.length} className="c2ui px-4 py-10 text-center text-[13px]" style={{ color: FAINT }}>
                            No parts match the current filters.
                          </td>
                        </tr>
                      )}
                      {rows.map((l, i) => {
                        const review = reviewMap[l.id];
                        const status = review?.status ?? 'pending';
                        const isApproved = status === 'approved';
                        const isRejected = status === 'rejected';
                        const rowBg = isApproved
                          ? 'rgba(62,142,94,0.04)'
                          : isRejected ? 'rgba(192,90,46,0.05)'
                          : i % 2 === 0 ? 'transparent' : 'rgba(34,32,28,0.012)';
                        return (
                          <tr key={`${l.roId}-${l.jobId}-${i}`}
                            style={{ borderBottom: `1px solid ${LINE}`, background: rowBg, opacity: isApproved ? 0.72 : 1 }}>
                            <td className="c2ui px-4 py-2.5 text-[12.5px] whitespace-nowrap font-semibold" style={{ color: INK }}>
                              {l.roNumber}
                              {review?.reviewedBy && <div className="c2ui text-[10px] mt-0.5" style={{ color: FAINT }}>{review.reviewedBy.split('@')[0]}</div>}
                            </td>
                            <td className="c2ui px-4 py-2.5 text-[12.5px] whitespace-nowrap" style={{ color: INK2 }}>{l.shopNum}</td>
                            <td className="c2ui px-4 py-2.5 text-[12.5px] whitespace-nowrap" style={{ color: INK2 }}>{fmtDate(l.roDate)}</td>
                            <td className="c2ui px-4 py-2.5 text-[12.5px] whitespace-nowrap" style={{ color: INK2 }}>{l.roStatus}</td>
                            <td className="c2ui px-4 py-2.5 text-[12.5px]" style={{ color: INK, maxWidth: 180 }}>
                              <div className="truncate">{l.jobName}</div>
                              {l.cannedJobId !== null && <div className="c2ui text-[10.5px] mt-0.5" style={{ color: AMBER }}>Canned #{l.cannedJobId}</div>}
                            </td>
                            <td className="c2ui px-4 py-2.5 text-[12.5px]" style={{ color: INK, maxWidth: 200 }}>
                              <div className="truncate">{l.partName}</div>
                              {l.brand && <div className="c2ui text-[10.5px]" style={{ color: FAINT }}>{l.brand}</div>}
                            </td>
                            <td className="c2ui px-4 py-2.5 text-[11.5px] whitespace-nowrap font-mono" style={{ color: FAINT }}>{l.partNumber || '—'}</td>
                            <td className="c2ui px-4 py-2.5 text-[12.5px] text-right whitespace-nowrap" style={{ color: INK2 }}>{l.qty}</td>
                            <td className="c2ui px-4 py-2.5 text-[12.5px] text-right whitespace-nowrap" style={{ color: INK2 }}>{usd(l.costCents / 100)}</td>
                            <td className="c2ui px-4 py-2.5 text-[12.5px] text-right whitespace-nowrap font-semibold" style={{ color: INK }}>{usd(l.retailCents / 100)}</td>
                            <td className="c2ui px-4 py-2.5 text-[12.5px] text-right whitespace-nowrap" style={{ color: INK2 }}>
                              {l.costCents > 0 ? usd(l.matrixCents / 100) : '—'}
                            </td>
                            <td className="c2ui px-4 py-2.5 text-[12.5px] text-right whitespace-nowrap font-semibold"
                              style={{ color: l.varianceCents === 0 ? FAINT : l.varianceCents > 0 ? COOL : BAD }}>
                              {l.costCents > 0 ? (l.varianceCents >= 0 ? '+' : '') + usd(l.varianceCents / 100) : '—'}
                            </td>
                            <td className="c2ui px-4 py-2.5 whitespace-nowrap"><TypeBadge type={l.pricingType} variance={l.varianceCents} /></td>
                            {showReviewCols && (
                              <>
                                <td className="px-4 py-2" style={{ minWidth: 160 }}>
                                  {l.pricingType === 'manual' ? (
                                    isApproved
                                      ? <span className="c2ui text-[12px]" style={{ color: INK2 }}>{review?.notes || '—'}</span>
                                      : <NotesCell id={l.id} notes={review?.notes ?? ''} onSave={(v) => handleReview(l, { notes: v })} />
                                  ) : null}
                                </td>
                                <td className="px-4 py-2 whitespace-nowrap">
                                  {l.pricingType === 'manual' ? (
                                    <div className="inline-flex rounded-full p-0.5" style={{ background: 'rgba(34,32,28,0.05)', border: `1px solid ${LINE}` }}>
                                      <button
                                        onClick={() => handleReview(l, { status: status === 'approved' ? 'pending' : 'approved' })}
                                        className="c2ui rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition whitespace-nowrap"
                                        style={status === 'approved'
                                          ? { background: '#fff', color: '#3E8E5E', boxShadow: '0 1px 3px rgba(0,0,0,0.14), 0 1px 2px rgba(0,0,0,0.08)' }
                                          : { color: INK2, background: 'transparent' }}>
                                        ✓ Approve
                                      </button>
                                      <button
                                        onClick={() => handleReview(l, { status: status === 'rejected' ? 'pending' : 'rejected' })}
                                        className="c2ui rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition whitespace-nowrap"
                                        style={status === 'rejected'
                                          ? { background: '#fff', color: '#C05A2E', boxShadow: '0 1px 3px rgba(0,0,0,0.14), 0 1px 2px rgba(0,0,0,0.08)' }
                                          : { color: INK2, background: 'transparent' }}>
                                        ⚑ Flag
                                      </button>
                                    </div>
                                  ) : null}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {pageCount > 1 && (
                  <div className="px-6 py-4 flex items-center justify-between" style={{ borderTop: `1px solid ${LINE}` }}>
                    <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                      className="c2ui text-[12.5px] font-semibold px-3 py-1 rounded-full transition"
                      style={{ color: page === 0 ? FAINT : INK2, cursor: page === 0 ? 'default' : 'pointer' }}>← Prev</button>
                    <span className="c2ui text-[12px]" style={{ color: FAINT }}>Page {page + 1} of {pageCount}</span>
                    <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page === pageCount - 1}
                      className="c2ui text-[12.5px] font-semibold px-3 py-1 rounded-full transition"
                      style={{ color: page === pageCount - 1 ? FAINT : INK2, cursor: page === pageCount - 1 ? 'default' : 'pointer' }}>Next →</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>) : (
          <div className="c2ui text-[13px] text-center py-8" style={{ color: FAINT }}>
            {loading ? 'Loading…' : failed ? 'Failed to load — try a shorter date range' : 'Fetching parts data…'}
          </div>
        )}
      </Card>

      {/* ── Pricing trends charts ──────────────────────────────────────────── */}
      <Card id="trends" eyebrow="Historical · chain-wide" title="Pricing trends" colHeader right={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Dropdown value={histShop} onChange={setHistShop} opts={[{ key: 'all', label: 'All Shops' }, ...SHOPS.map((s) => ({ key: s.num, label: s.name }))]} />
          <Dropdown value={chartRange} onChange={setChartRange} opts={CHART_RANGES} />
          <Dropdown value={showComparison ? 'prior_year' : 'none'} onChange={(v) => setShowComparison(v !== 'none')} opts={[{ key: 'none', label: 'No Comparison' }, { key: 'prior_year', label: 'vs Prior Year' }]} />
        </div>
      }>
        {histShop !== 'all' && (
          <div className="c2ui text-[12px] mb-4" style={{ color: FAINT }}>
            Trend history is chain-wide — per-shop breakdown coming soon
          </div>
        )}
        {(histLoading || histBackfilling) && (
          <div className="c2ui text-[11.5px] flex items-center gap-1.5 mb-4" style={{ color: FAINT }}>
            <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
            {histLoading ? 'Loading history…' : `Computing… ${histRemaining} weeks left`}
          </div>
        )}
        {!histLoading && !histBackfilling && history.length > 0 && (
          <div className="c2ui text-[11px] mb-4" style={{ color: FAINT }}>{history.length} weeks on record</div>
        )}

        {(histLoading || (history.length === 0 && histBackfilling)) && (
          <div className="flex items-center justify-center py-16 c2ui text-[13px]" style={{ color: FAINT }}>
            Building pricing history — may take a few minutes the first time…
          </div>
        )}

        {!histLoading && history.length > 0 && (() => {
          const latest = history[history.length - 1];
          const safeP = (n: number, d: number) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '—';
          return (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-1.5 mb-6 c2ui text-[13px]" style={{ color: INK2 }}>
              <span style={{ color: FAINT, fontSize: 12 }}>Latest week {fmtWeekLabel(latest.weekStart)}</span>
              <span>Matrix <span className="c2disp tabular-nums" style={{ color: C_MATRIX, fontSize: 16 }}>{safeP(latest.matrix, latest.total)}</span></span>
              <span>Manual <span className="c2disp tabular-nums" style={{ color: C_MANUAL, fontSize: 16 }}>{safeP(latest.manual, latest.total)}</span></span>
              <span>Canned <span className="c2disp tabular-nums" style={{ color: C_CANNED, fontSize: 16 }}>{safeP(latest.canned, latest.total)}</span></span>
              <span style={{ color: FAINT }}>{latest.total.toLocaleString()} parts</span>
            </div>
          );
        })()}

        {!histLoading && history.length > 0 && (
          <>
            <div className="mb-8">
              <div className="c2ui text-[11px] font-semibold uppercase tracking-[0.14em] mb-4" style={{ color: FAINT }}>Pricing Mix Over Time</div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={axisStyle} axisLine={{ stroke: LINE }} tickLine={false} interval={xInterval} />
                  <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={axisStyle} axisLine={false} tickLine={false} width={36} domain={[0, 100]} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: INK2 }} />
                  <Line type="monotone" dataKey="matrixPct" name="Matrix %" stroke={C_MATRIX} dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="manualPct" name="Manual %" stroke={C_MANUAL} dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="cannedPct" name="Canned %" stroke={C_CANNED} dot={false} strokeWidth={2} />
                  {showComparison && <>
                    <Line type="monotone" dataKey="compMatrixPct" name="Matrix % (−1yr)" stroke={C_MATRIX} dot={false} strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.45} legendType="none" />
                    <Line type="monotone" dataKey="compManualPct" name="Manual % (−1yr)" stroke={C_MANUAL} dot={false} strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.45} legendType="none" />
                    <Line type="monotone" dataKey="compCannedPct" name="Canned % (−1yr)" stroke={C_CANNED} dot={false} strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.45} legendType="none" />
                  </>}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div className="c2ui text-[11px] font-semibold uppercase tracking-[0.14em] mb-4" style={{ color: FAINT }}>Revenue Left on Table (Manual Underpriced vs Matrix)</div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="lostGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C_MANUAL} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={C_MANUAL} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={AMBER} stopOpacity={0.12} />
                      <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={axisStyle} axisLine={{ stroke: LINE }} tickLine={false} interval={xInterval} />
                  <YAxis tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} tick={axisStyle} axisLine={false} tickLine={false} width={42} />
                  <Tooltip content={<ChartTooltip isDollar />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: INK2 }} />
                  <Area type="monotone" dataKey="lostDollars" name="Rev left on table" stroke={C_MANUAL} strokeWidth={2} fill="url(#lostGrad)" dot={false} />
                  {showComparison && (
                    <Area type="monotone" dataKey="compLostDollars" name="Prior year" stroke={AMBER} strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.55} fill="url(#compGrad)" dot={false} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Card>

    </ConceptShell>
  );
}
