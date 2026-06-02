'use client';

// Revenue Opportunity — Per-Shop Diagnostic.
//
// Same seven upstream levers as Highest Leverage on the Employee View — Calls,
// Call Conversion, AWRO, Close Rate, Parts GP, Labor GP, Return Customers —
// but with a dollar opportunity attached to each weak lever. Per shop:
//
//   1. Compare each lever to the chain median this week.
//   2. For every below-median lever, compute how much revenue closing the gap
//      to the chain median is worth.
//   3. Sum across the shop's weak levers → shop's total opportunity.
//
// All values are WEEK-TO-DATE (Mon 00:00 MT → now), so every shop has had the
// same elapsed time when compared. This replaces the older bottleneck-
// classification approach (low-conversion / easy-yes / weak-inspections…)
// which the team found too abstract to act on.
//
// Car Count and ARO are intentionally excluded — both are downstream of the
// seven shown here (Car Count = conversion × prior re-books; ARO = AWRO ×
// close rate). Surfacing them would double-count opportunity.
//
// Parts GP and Labor GP currently surface a percentage-point gap only —
// translating those to dollars requires per-shop parts/labor revenue which
// ShopKpi doesn't yet expose. They're shown so the trend is visible; the $
// figure is left blank.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ChevronDown, ChevronUp, TrendingUp, ArrowRight, Info,
  Phone, PhoneIncoming, ClipboardList, Handshake, Wrench, Cog, Repeat,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { num, pct, usd, usdK } from '@/lib/format';
import type { OpportunityResult, ChainKpi } from '@/lib/metrics';
import type { RangeKey } from '@/lib/dates';
import { SHOPS } from '@/lib/shops';

// --- Lever definitions -----------------------------------------------------

type LeverKey = 'calls' | 'conversion' | 'awro' | 'closeRate' | 'partsGp' | 'laborGp' | 'returnCust';

interface LeverDef {
  key: LeverKey;
  label: string;
  Icon: any;
  // How the lever value is formatted for display.
  fmt: (v: number) => string;
}

const LEVERS: LeverDef[] = [
  { key: 'calls',      label: 'Calls',            Icon: Phone,         fmt: v => num(Math.round(v)) },
  { key: 'conversion', label: 'Call Conversion',  Icon: PhoneIncoming, fmt: v => pct(v, 0) },
  { key: 'awro',       label: 'AWRO',             Icon: ClipboardList, fmt: v => usd(Math.round(v)) },
  { key: 'closeRate',  label: 'Close Rate',       Icon: Handshake,     fmt: v => pct(v) },
  { key: 'partsGp',    label: 'Parts GP',         Icon: Wrench,        fmt: v => pct(v) },
  { key: 'laborGp',    label: 'Labor GP',         Icon: Cog,           fmt: v => pct(v) },
  { key: 'returnCust', label: 'Return Customers', Icon: Repeat,        fmt: v => pct(v) },
];

// --- Data shapes -----------------------------------------------------------

interface ShopLeverData {
  shopNum: string;
  shopName: string;
  // Lever values (null = no data yet)
  calls: number | null;
  conversion: number | null;       // 0..1
  awro: number | null;
  closeRate: number | null;        // 0..1
  partsGp: number | null;          // 0..1
  laborGp: number | null;          // 0..1
  returnCust: number | null;       // 0..1
  // Multipliers used in $ opportunity sizing
  aro: number;
  cars: number;
  totalWtdCustomers: number;       // for return-customer $ sizing
}

interface MedianMap {
  calls: number;
  conversion: number;
  awro: number;
  closeRate: number;
  partsGp: number;
  laborGp: number;
  returnCust: number;
}

interface LeverOpportunity {
  key: LeverKey;
  def: LeverDef;
  shopValue: number;
  median: number;
  gap: number;                     // median - shopValue, only when shop is below
  dollarOpp: number | null;        // null = not sizable (e.g. Parts/Labor GP)
}

interface ShopDiagnosis {
  shopNum: string;
  shopName: string;
  data: ShopLeverData;
  weakLevers: LeverOpportunity[];  // sorted by dollarOpp desc (null sinks)
  strongLevers: LeverKey[];
  unknownLevers: LeverKey[];
  totalDollarOpp: number;          // sum of sizable weak-lever $ opps
}

// --- Compute helpers -------------------------------------------------------

function median(arr: number[]): number {
  const xs = arr.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

function leverValue(d: ShopLeverData, key: LeverKey): number | null {
  return d[key];
}

// $ opportunity for closing a single weak lever to the chain median.
//
//   Calls:        (medCalls − shopCalls) × shopConversion × shopARO
//   Conversion:   shopCalls × (medConv − shopConv) × shopARO
//   AWRO:         (medAWRO − shopAWRO) × shopCloseRate × shopCars
//   Close Rate:   (medCR − shopCR) × shopAWRO × shopCars
//   Return Cust.: (medRet − shopRet) × shopTotalWtdCustomers × shopARO
//   Parts/Labor GP: null (need parts/labor revenue, not yet exposed)
function dollarOpportunity(key: LeverKey, d: ShopLeverData, med: MedianMap): number | null {
  const v = leverValue(d, key);
  if (v === null || med[key] <= 0) return null;
  const gap = med[key] - v;
  if (gap <= 0) return 0;
  switch (key) {
    case 'calls':
      if (d.conversion === null || d.aro <= 0) return null;
      return gap * d.conversion * d.aro;
    case 'conversion':
      if (d.calls === null || d.aro <= 0) return null;
      return d.calls * gap * d.aro;
    case 'awro':
      if (d.closeRate === null || d.cars <= 0) return null;
      return gap * d.closeRate * d.cars;
    case 'closeRate':
      if (d.awro === null || d.cars <= 0) return null;
      return gap * d.awro * d.cars;
    case 'returnCust':
      if (d.totalWtdCustomers <= 0 || d.aro <= 0) return null;
      return gap * d.totalWtdCustomers * d.aro;
    // Parts/Labor GP: gap is in pp; without parts/labor revenue we can't
    // monetize it. Return null so it surfaces as "pp gap" only.
    case 'partsGp':
    case 'laborGp':
      return null;
  }
}

function diagnose(d: ShopLeverData, med: MedianMap): ShopDiagnosis {
  const weak: LeverOpportunity[] = [];
  const strong: LeverKey[] = [];
  const unknown: LeverKey[] = [];
  for (const def of LEVERS) {
    const v = leverValue(d, def.key);
    const m = med[def.key];
    if (v === null || m <= 0) { unknown.push(def.key); continue; }
    if (v >= m) { strong.push(def.key); continue; }
    const dollarOpp = dollarOpportunity(def.key, d, med);
    weak.push({ key: def.key, def, shopValue: v, median: m, gap: m - v, dollarOpp });
  }
  // Sort weak levers by $ opp desc, with nulls (Parts/Labor GP) at the end.
  weak.sort((a, b) => {
    const av = a.dollarOpp ?? -1;
    const bv = b.dollarOpp ?? -1;
    return bv - av;
  });
  const totalDollarOpp = weak.reduce((s, w) => s + (w.dollarOpp ?? 0), 0);
  return { shopNum: d.shopNum, shopName: d.shopName, data: d, weakLevers: weak, strongLevers: strong, unknownLevers: unknown, totalDollarOpp };
}

// --- Main component --------------------------------------------------------

export default function RevenueOpportunityCard(_props: {
  // Props are accepted for backwards compatibility with the Dashboard call
  // site but the rework computes everything from a WTD pull internally. The
  // diagnostic is inherently a "what should we focus on this week" question,
  // so the dashboard's range selector doesn't apply here.
  data: OpportunityResult | null;
  kpi: ChainKpi | null;
  range?: RangeKey;
}) {
  const [conversion, setConversion] = useState<any[] | null>(null);
  const [returnCustomers, setReturnCustomers] = useState<any[] | null>(null);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const safe = async <T,>(url: string): Promise<T | null> => {
      try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch { return null; }
    };
    // WTD across the board (Mon → today MT) so the chain-median comparison
    // is apples-to-apples — every shop has had the same elapsed time.
    safe<any>('/api/extras?view=booked-rate&wtd=1').then(d => {
      // Normalize bookedRatePct from 0..100 → 0..1 so it lives on the same
      // scale as every other percentage in this component.
      const rows = (d?.shops || []).map((s: any) => ({
        ...s,
        bookedRatePct: typeof s.bookedRatePct === 'number' ? s.bookedRatePct / 100 : 0,
      }));
      setConversion(rows);
    });
    safe<any>('/api/extras?view=return-customers').then(d => setReturnCustomers(d?.shops || []));
    safe<any>('/api/metrics?range=this_week').then(d => setMetrics(d));
  }, []);

  // Build per-shop lever data from the three fetches.
  const shopData = useMemo<ShopLeverData[]>(() => {
    if (!conversion || !returnCustomers || !metrics) return [];
    const kpiByShop: Record<string, any> = {};
    for (const s of (metrics?.kpi?.byShop || [])) kpiByShop[s.shopNum] = s;
    const convByShop: Record<string, any> = {};
    for (const s of conversion) convByShop[s.shopNum] = s;
    const rcByShop: Record<string, any> = {};
    for (const s of returnCustomers) rcByShop[s.shopNum] = s;
    return SHOPS.map(shop => {
      const k = kpiByShop[shop.num];
      const c = convByShop[shop.num];
      const r = rcByShop[shop.num];
      const rcReady = r && !r.pending && typeof r.returnWtdPct === 'number';
      return {
        shopNum: shop.num,
        shopName: shop.name,
        calls: c ? (c.eligible ?? 0) : null,
        conversion: c ? (c.bookedRatePct ?? 0) : null,
        awro: k ? (k.awro ?? 0) : null,
        closeRate: k ? (k.closeRate ?? 0) : null,
        partsGp: k ? (k.partsGpPct ?? 0) : null,
        laborGp: k ? (k.laborGpPct ?? 0) : null,
        returnCust: rcReady ? r.returnWtdPct : null,
        aro: k ? (k.aro ?? 0) : 0,
        cars: k ? (k.cars ?? 0) : 0,
        totalWtdCustomers: rcReady ? (r.totalWtd ?? 0) : 0,
      };
    });
  }, [conversion, returnCustomers, metrics]);

  const medians = useMemo<MedianMap>(() => {
    const collect = (key: LeverKey) => shopData.map(d => d[key]).filter((x): x is number => x !== null);
    return {
      calls: median(collect('calls')),
      conversion: median(collect('conversion')),
      awro: median(collect('awro')),
      closeRate: median(collect('closeRate')),
      partsGp: median(collect('partsGp')),
      laborGp: median(collect('laborGp')),
      returnCust: median(collect('returnCust')),
    };
  }, [shopData]);

  const diagnoses = useMemo<ShopDiagnosis[]>(() => shopData.map(d => diagnose(d, medians)), [shopData, medians]);
  const sorted = useMemo(() => [...diagnoses].sort((a, b) => b.totalDollarOpp - a.totalDollarOpp), [diagnoses]);

  // Loading skeleton until every fetch has resolved.
  if (!conversion || !returnCustomers || !metrics) return <div className="card animate-pulse h-[320px]" />;

  const chainTotalOpp = diagnoses.reduce((s, d) => s + d.totalDollarOpp, 0);
  const shopsBelowPace = diagnoses.filter(d => d.weakLevers.length > 0).length;
  // Chain-wide "biggest lever" = lever with largest summed $ opp across shops.
  const leverTotals: Record<LeverKey, number> = { calls: 0, conversion: 0, awro: 0, closeRate: 0, partsGp: 0, laborGp: 0, returnCust: 0 };
  for (const d of diagnoses) {
    for (const w of d.weakLevers) if (w.dollarOpp) leverTotals[w.key] += w.dollarOpp;
  }
  const biggestLeverEntry = (Object.entries(leverTotals) as Array<[LeverKey, number]>)
    .sort((a, b) => b[1] - a[1])[0];
  const biggestLever = biggestLeverEntry && biggestLeverEntry[1] > 0
    ? { key: biggestLeverEntry[0], def: LEVERS.find(L => L.key === biggestLeverEntry[0])!, dollars: biggestLeverEntry[1] }
    : null;
  const topShop = sorted.find(d => d.totalDollarOpp > 0) || null;

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full" style={{ background: 'rgba(245,166,35,0.12)' }}>
            <AlertCircle className="w-[18px] h-[18px]" style={{ color: '#F5A623' }} />
          </span>
          <div className="min-w-0">
            <h2 className="section-h">Revenue Opportunity · per-shop diagnostic</h2>
            <p className="section-sub mt-0.5">Week-to-date (Mon → today MT). Below the company median on any of the seven upstream levers = action item; the dollar figure is what closing the gap to the company median is worth this week.</p>
          </div>
        </div>
      </div>

      {/* Context strip */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ContextTile label="Total opportunity this week" value={usdK(chainTotalOpp)} tone="orange" sub="sum across all weak levers" />
        <ContextTile label="Shops below pace" value={`${shopsBelowPace} / ${diagnoses.length}`} tone={shopsBelowPace === 0 ? 'green' : 'amber'} sub="≥1 lever below median" />
        <ContextTile label="Biggest company-wide lever" value={biggestLever ? biggestLever.def.label : '—'} tone="neutral" sub={biggestLever ? `≈ ${usdK(biggestLever.dollars)} company-wide` : 'all levers at or above median'} />
      </div>

      {/* Biggest single lift callout */}
      {topShop && (
        <div className="mt-5 rounded-2xl p-4 flex items-start gap-3"
          style={{ background: 'linear-gradient(140deg,#FFFCF4,#FDF1DC)', boxShadow: 'inset 0 0 0 1px rgba(245,166,35,0.22)' }}>
          <TrendingUp className="w-5 h-5 mt-0.5 shrink-0" style={{ color: '#B45309' }} />
          <div className="text-[13px] text-mango-ink/85 leading-relaxed">
            <span className="font-semibold text-mango-ink">{topShop.shopName}</span> has the biggest opportunity this week —
            top weak lever is{' '}
            <span className="font-semibold">{topShop.weakLevers[0]?.def.label}</span>.
            Closing all of its gaps to the company median is worth roughly{' '}
            <span className="font-semibold text-mango-ink">+{usdK(topShop.totalDollarOpp)}</span>.
          </div>
        </div>
      )}

      {/* Data provenance note */}
      <div className="mt-4 rounded-xl border border-mango-line bg-mango-bg/40 p-3 text-[11.5px] text-mango-ink/80 leading-relaxed">
        <div className="flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 text-mango-muted shrink-0" />
          <div className="flex-1">
            <span className="font-semibold text-mango-ink">Methodology:</span>{' '}
            Each lever is compared to the company median this week. When a shop is below median, the dollar opportunity is the gap closed at the shop's other current levers (e.g. Calls opportunity = call gap × this shop's conversion × this shop's ARO). Car Count and ARO are excluded because they're downstream of the seven shown — Car Count is driven by call conversion + prior re-books; ARO = AWRO × close rate. Parts GP and Labor GP currently show a pp gap only because per-shop parts/labor revenue isn't yet exposed for monetization.
          </div>
        </div>
      </div>

      {/* Per-shop table */}
      <div className="mt-5 overflow-hidden rounded-2xl border border-mango-line">
        <table className="w-full text-[13px]">
          <thead className="bg-mango-bg/70 text-[11px] uppercase tracking-wide text-mango-muted">
            <tr>
              <th className="text-left px-4 py-2">Shop</th>
              <th className="text-left px-3 py-2">Top weak levers (this week)</th>
              <th className="text-right px-4 py-2">Total opportunity</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(d => (
              <ShopRow key={d.shopNum} d={d} medians={medians} expanded={expanded === d.shopNum} onToggle={() => setExpanded(expanded === d.shopNum ? null : d.shopNum)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContextTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'green' | 'amber' | 'orange' | 'neutral' }) {
  const cls =
    tone === 'green'  ? 'border-green-200 bg-green-50/40' :
    tone === 'amber'  ? 'border-amber-200 bg-amber-50/40' :
    tone === 'orange' ? 'border-orange-200 bg-orange-50/40' :
                        'border-mango-line bg-mango-bg/40';
  return (
    <div className={`rounded-2xl border ${cls} px-4 py-3`}>
      <div className="text-[10.5px] uppercase tracking-wide font-semibold text-mango-muted">{label}</div>
      <div className="text-[1.4rem] font-semibold tabular-nums text-mango-ink leading-tight mt-1 break-words">{value}</div>
      {sub && <div className="text-[11px] text-mango-muted mt-0.5">{sub}</div>}
    </div>
  );
}

// --- Shop row + drill-down -------------------------------------------------

function ShopRow({ d, medians, expanded, onToggle }: { d: ShopDiagnosis; medians: MedianMap; expanded: boolean; onToggle: () => void }) {
  const top3 = d.weakLevers.slice(0, 3);
  const restWeakCount = Math.max(0, d.weakLevers.length - 3);
  const sevBg =
    d.totalDollarOpp >= 10000 ? 'bg-red-50/50' :
    d.totalDollarOpp >= 2500  ? 'bg-orange-50/40' :
    d.weakLevers.length > 0   ? 'bg-amber-50/30' :
                                'bg-emerald-50/30';
  return (
    <>
      <tr className={`${sevBg} border-t border-mango-line/60 hover:bg-opacity-80 cursor-pointer transition`} onClick={onToggle}>
        <td className="px-4 py-3">
          <div className="font-semibold text-mango-ink">{d.shopName}</div>
          <div className="text-[10.5px] text-mango-muted">Shop {d.shopNum}</div>
        </td>
        <td className="px-3 py-3">
          {top3.length === 0 ? (
            <span className="text-[12px] text-mango-green font-medium">All levers at or above company median ✓</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {top3.map(w => (
                <span key={w.key} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 bg-mango-red/8 border border-mango-red/25 text-[11.5px]">
                  <w.def.Icon className="w-3.5 h-3.5 text-mango-red" />
                  <span className="font-semibold text-mango-ink">{w.def.label}</span>
                  <span className="text-mango-muted">{w.def.fmt(w.shopValue)} / {w.def.fmt(w.median)}</span>
                  {w.dollarOpp !== null && w.dollarOpp > 0 && (
                    <span className="font-bold text-mango-red tabular-nums">+{usdK(w.dollarOpp)}</span>
                  )}
                </span>
              ))}
              {restWeakCount > 0 && (
                <span className="inline-flex items-center text-[11px] text-mango-muted italic">+{restWeakCount} more</span>
              )}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          {d.totalDollarOpp > 0 ? (
            <span className="font-bold tabular-nums text-[14px]">{usdK(d.totalDollarOpp)}</span>
          ) : (
            <span className="text-mango-muted">—</span>
          )}
        </td>
        <td className="pr-3 text-right">
          {expanded ? <ChevronUp className="inline w-4 h-4 text-mango-muted" /> : <ChevronDown className="inline w-4 h-4 text-mango-muted" />}
        </td>
      </tr>
      <AnimatePresence initial={false}>
        {expanded && (
          <tr className="bg-white">
            <td colSpan={4} className="px-0 py-0">
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22 }}
                className="overflow-hidden"
              >
                <ShopDrillDown d={d} medians={medians} />
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

function ShopDrillDown({ d, medians }: { d: ShopDiagnosis; medians: MedianMap }) {
  return (
    <div className="border-t border-mango-line/60 px-6 py-5 bg-white">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {LEVERS.map(L => {
          const v = leverValue(d.data, L.key);
          const m = medians[L.key];
          const hasData = v !== null && m > 0;
          const isStrong = hasData && (v as number) >= m;
          const dollarOpp = !hasData ? null : isStrong ? null : dollarOpportunity(L.key, d.data, medians);
          return (
            <div key={L.key} className={`rounded-lg border p-3 ${!hasData ? 'border-mango-line bg-mango-bg/30 opacity-60' : isStrong ? 'border-mango-line bg-emerald-50/30' : 'border-mango-red/25 bg-mango-red/8'}`}>
              <div className="flex items-center gap-2 mb-2">
                <L.Icon className={`w-4 h-4 ${!hasData ? 'text-mango-muted' : isStrong ? 'text-mango-green' : 'text-mango-red'}`} />
                <div className="text-[12px] font-semibold text-mango-ink">{L.label}</div>
              </div>
              <div className="flex items-baseline gap-3">
                <div className="text-lg font-bold tabular-nums">{hasData ? L.fmt(v as number) : '—'}</div>
                <div className="text-[10.5px] uppercase text-mango-muted">vs median {hasData ? L.fmt(m) : '—'}</div>
              </div>
              {!isStrong && hasData && (
                <div className="mt-2 text-[11.5px]">
                  {dollarOpp !== null && dollarOpp > 0 ? (
                    <span className="font-semibold text-mango-red">+{usdK(dollarOpp)} <span className="font-normal text-mango-muted">to close the gap this week</span></span>
                  ) : (L.key === 'partsGp' || L.key === 'laborGp') ? (
                    <span className="text-mango-muted">{((m - (v as number)) * 100).toFixed(1)}pp gap · $ not yet sized</span>
                  ) : (
                    <span className="text-mango-muted">—</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {d.totalDollarOpp > 0 && (
        <div className="mt-4 flex items-start gap-2 text-[12px] text-mango-ink/80">
          <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-mango-faint shrink-0" />
          <div>
            <span className="font-semibold text-mango-ink">Recommended focus:</span>{' '}
            Start with <span className="font-semibold">{d.weakLevers[0]?.def.label}</span> — the highest-dollar lever for this shop this week.
          </div>
        </div>
      )}
    </div>
  );
}
