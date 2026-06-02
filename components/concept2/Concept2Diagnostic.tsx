'use client';

// CONCEPT 2 — concept1's bespoke luxury design, driven by LIVE production data
// AND real production functionality (timeframe selector, the per-shop revenue
// diagnostic with drill-down, the 12-week heatmap matrix with a metric
// selector, comparison + trend metric selectors). Reuses concept1's visual
// system; reuses production's logic (chain-median diagnosis, real heatmap tiers).

import { useEffect, useMemo, useState } from 'react';
import { SHOPS as SHOP_META } from '@/lib/shops';
import { DEFAULT_GOALS, workingDaysBetween, isWorkingDay } from '@/lib/goals';
import {
  pctTier, gpTier, closeTier, convTier, rebookTier, comebackTier, ratingTier, type Tier,
} from '@/lib/heatmap';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, addDays } from 'date-fns';
import { ConceptShell } from './kit';
import ConceptAR from './ConceptAR';
import { TrophyTallyQuarter } from './Concept2Employee';

// ── palette + heat spectrum (concept1) ─────────────────────────────────────
const INK = '#22201C', INK2 = '#5C564E', FAINT = '#938C81', LINE = 'rgba(34,32,28,0.08)';
const AMBER = '#E8863E';
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
const heatDot = (s: number) => { const [r, g, b] = heatRGB(s); return `rgb(${r},${g},${b})`; };
// production tiers are 1=best..5=worst → map to a 0..1 cool→warm score.
const tierScore = (t: Tier | null) => (t == null ? 0.5 : (5 - t) / 4);
function norm(v: number, lo: number, hi: number, invert = false): number { const t = (v - lo) / (hi - lo); const c = Math.max(0, Math.min(1, t)); return invert ? 1 - c : c; }
const usd = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US');
const usd0 = usd;
const usdK = (n: number) => (Math.abs(n) >= 1000 ? '$' + (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : '$' + Math.round(n || 0));
const pctS = (v: number, dp = 0) => (v * 100).toFixed(dp) + '%';

const META = SHOP_META.map((s) => ({ num: s.num, name: s.name, district: s.district, color: s.color }));
const safe = async <T,>(url: string): Promise<T | null> => { try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) return null; return (await r.json()) as T; } catch { return null; } };

// ── timeframe options (drive the projection period + the diagnostic) ───────
// `last_week` reviews the most-recently-completed week's ACTUALS (for the
// Tuesday weekly meeting) — there's no forecast for a finished week, so the
// diagnostic runs on real numbers from the heatmap instead of the projection.
const RANGES: { key: string; label: string; period: string }[] = [
  { key: 'this_week', label: 'This Week', period: 'this_week' },
  { key: 'last_week', label: 'Last Week', period: 'last_week' },
  { key: 'this_month', label: 'This Month', period: 'this_month' },
  { key: 'this_quarter', label: 'This Quarter', period: 'this_quarter' },
];
const isCompletedPeriod = (range: string) => range === 'last_week';

// ── period elapsed, in 15-minute increments of the business day ────────────
// Shops run 8:00am–5:30pm. A completed working day counts 1.0; the current day
// counts the fraction of business hours elapsed (snapped to 15-min steps); a
// day the shops haven't opened yet counts 0 — so a week whose Friday hasn't
// started reads e.g. 3.0/4, not 4.0/4.
const BIZ_OPEN_H = 8, BIZ_CLOSE_H = 17.5, BIZ_MIN_PER_DAY = (BIZ_CLOSE_H - BIZ_OPEN_H) * 60; // 570
function bizDayFraction(day: Date, now: Date): number {
  const open = new Date(day); open.setHours(BIZ_OPEN_H, 0, 0, 0);
  const mins = (now.getTime() - open.getTime()) / 60000;
  if (mins <= 0) return 0;
  return Math.min(1, (Math.floor(mins / 15) * 15) / BIZ_MIN_PER_DAY);
}
function periodBounds(periodKey: string, now: Date): { start: Date; end: Date } {
  switch (periodKey) {
    case 'last_week': { const m = startOfWeek(addDays(now, -7), { weekStartsOn: 1 }); return { start: m, end: endOfWeek(m, { weekStartsOn: 1 }) }; }
    case 'this_month': return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'this_quarter': return { start: startOfQuarter(now), end: endOfQuarter(now) };
    default: return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
  }
}
function elapsedAndTotal(periodKey: string, now: Date): { elapsed: number; total: number } {
  const { start, end } = periodBounds(periodKey, now);
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const todayKey = dayKey(now);
  let elapsed = 0, total = 0;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    if (!isWorkingDay(d)) continue;
    total += 1;
    if (dayKey(d) === todayKey) elapsed += bizDayFraction(d, now);
    else if (d < now) elapsed += 1; // fully-elapsed past working day
    // future working day → 0
  }
  return { elapsed, total };
}

// ── primitives (concept1) ──────────────────────────────────────────────────
function Card({ id, eyebrow, title, sub, right, children, pad = true }: { id?: string; eyebrow?: string; title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; pad?: boolean }) {
  return (
    <section id={id} className="scroll-mt-6 mb-7">
      <div className="rounded-[26px] border" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.58))', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', borderColor: 'rgba(255,255,255,0.75)', boxShadow: '0 1px 0 rgba(255,255,255,0.9) inset, 0 18px 48px -28px rgba(40,34,26,0.30), 0 2px 8px -4px rgba(40,34,26,0.10)' }}>
        {(eyebrow || title || right) && (
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
            <div className="min-w-0">
              {eyebrow && <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>{eyebrow}</div>}
              {title && <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.01em' }}>{title}</h2>}
              {sub && <div className="c2ui text-[12.5px] mt-1" style={{ color: INK2 }}>{sub}</div>}
            </div>
            {right && <div className="shrink-0">{right}</div>}
          </div>
        )}
        <div className={pad ? 'px-6 py-5' : ''}>{children}</div>
      </div>
    </section>
  );
}
function Dropdown({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: { key: string; label: string }[] }) {
  return (
    <div className="relative inline-block">
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="c2ui appearance-none rounded-full pl-3.5 pr-8 py-1.5 text-[12.5px] font-semibold cursor-pointer"
        style={{ background: 'rgba(255,255,255,0.7)', color: INK, border: `1px solid rgba(34,32,28,0.12)` }}>
        {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"><path d="M6 9l6 6 6-6" /></svg>
    </div>
  );
}
function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-full p-1" style={{ background: 'rgba(34,32,28,0.05)', border: `1px solid ${LINE}` }}>
      {tabs.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} className="c2ui rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition" style={value === k ? { background: '#fff', color: INK, boxShadow: '0 1px 4px rgba(40,34,26,0.12)' } : { color: INK2, background: 'transparent' }}>{label}</button>
      ))}
    </div>
  );
}
function BigStat({ label, value, sub, color }: { label: string; value: string; sub?: React.ReactNode; color?: string }) {
  return (<div><div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>{label}</div><div className="c2disp tabular-nums leading-none mt-1.5" style={{ color: color || INK, fontSize: 44, letterSpacing: '-0.02em' }}>{value}</div>{sub && <div className="c2ui text-[12.5px] mt-2" style={{ color: INK2 }}>{sub}</div>}</div>);
}
function MiniStat({ label, value }: { label: string; value: string }) {
  return (<div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}><div className="c2disp tabular-nums leading-none" style={{ color: INK, fontSize: 22, letterSpacing: '-0.01em' }}>{value}</div><div className="c2ui text-[12.5px] mt-1.5" style={{ color: FAINT }}>{label}</div></div>);
}
function ForecastBar({ worst, expected, best }: { worst: number; expected: number; best: number }) {
  const span = Math.max(1, best - worst); const pos = Math.max(4, Math.min(96, ((expected - worst) / span) * 100));
  return (<div className="w-full"><div className="relative h-2.5 rounded-full" style={{ background: 'rgba(34,32,28,0.06)' }}><div className="absolute inset-y-0 left-[8%] right-[8%] rounded-full" style={{ background: 'linear-gradient(90deg, rgba(95,169,214,0.45), rgba(242,206,112,0.55), rgba(232,134,62,0.55))' }} /><div className="absolute -top-1 rounded-full" style={{ left: `calc(${pos}% - 9px)`, width: 18, height: 18, background: '#fff', boxShadow: '0 0 0 4px rgba(232,134,62,0.25), 0 2px 6px rgba(40,34,26,0.25)' }} /></div><div className="c2ui mt-2 flex justify-between text-[12.5px] tabular-nums" style={{ color: FAINT }}><span>{usdK(worst)} worst</span><span style={{ color: INK, fontWeight: 600 }}>{usdK(expected)} expected</span><span>{usdK(best)} best</span></div></div>);
}

// ════════════════════════════════════════════════════════════════════════
//  GP$ DIAGNOSTIC TREE — root = GP$, benchmarked vs goal-meeting history
// ════════════════════════════════════════════════════════════════════════
// The tree the owner asked for: GP$ sits at the very top. If a shop is
// projected short on GP$, we decompose the gap EXACTLY into Revenue vs GP%; the
// Revenue branch into Car count vs ARO; then name the operational root cause of
// the dominant branch (call conversion / re-book / close rate / margin). Every
// metric is compared to the level the shop runs WHEN IT ACTUALLY HITS GOAL
// (mined from the permanent archive), so the answer is "the single biggest
// lever to move GP$ for THIS shop" — and it can differ shop to shop. It's all
// period-aware: the projection inputs (revenue, cars, ARO, GP$, goal) are
// already scaled to the selected timeframe, so changing the upper-right
// dropdown re-examines the whole diagnostic on that basis.

const pn = (v: number | null) => (v == null ? '—' : v.toFixed(0) + '%'); // 0..100 rate
const pf = (v: number) => (v * 100).toFixed(0) + '%';                    // 0..1 rate

interface BenchLevels { revenue: number; cars: number; aro: number; closeRate: number; gpPct: number; conversion: number | null; rebook: number | null }
interface ShopBenchmark { shopNum: string; goalWeeks: number; sampleWeeks: number; method: 'goal-met' | 'best-weeks'; benchmark: BenchLevels; recent: BenchLevels }

type LeafKey = 'cars' | 'aro' | 'gpPct';
// A terminal branch of the tree — the specific, operational root cause the
// owner named. `active` = the one the data points to (the rest are the other
// candidates we ruled out / didn't pick).
interface GpBranch { label: string; detail: string; active: boolean }
interface GpLeaf {
  key: LeafKey;
  label: string;        // 'Car count' | 'ARO' | 'GP %'
  gp$: number;          // GP$ this branch explains (period, signed; +leak / −ahead)
  metricCur: string;    // headline metric, projected
  metricGoal: string;   // headline metric, goal-meeting level
  branches: GpBranch[]; // the candidate root causes under this leaf
  primaryCause: string; // active branch label — used in chips / "Start here"
  primaryFix: string;   // active branch action
  note?: string;        // GP% only: why blended GP% sits above its components
}
interface GpTree {
  num: string; name: string; district: string; color: string; ramping: boolean;
  hasGoal: boolean; onTrack: boolean;
  gp$Proj: number; gp$Goal: number; gap: number;       // GP$ headline (period)
  revGp$: number; gpPctGp$: number;                     // level 1 (signed)
  revProj: number; revGoal: number; gpPctProj: number; gpPctGoal: number;
  carsGp$: number; aroGp$: number;                      // level 2 (signed)
  carsProj: number; carsGoal: number; aroProj: number; aroGoal: number;
  leaves: GpLeaf[]; primary: GpLeaf | null;             // leaves sorted desc; primary = biggest leak
  method: 'goal-met' | 'best-weeks'; goalWeeks: number; sampleWeeks: number;
}

function buildGpTree(p: ProjShop, b: ShopBenchmark | undefined, cur?: { closeRate?: number; conversion?: number | null; rebook?: number | null; partsGp?: number | null; laborGp?: number | null }): GpTree {
  const revProj = p.expected;
  const revGoal = p.goal ?? 0;
  const gpPctProj = (p.gpPct ?? 0) / 100;            // projectedGpPct arrives as a percent number
  const gpPctGoal = DEFAULT_GOALS[p.num]?.gpPct ?? 0.58;
  const carsProj = p.cars;
  const aroProj = p.aro;

  const gp$Proj = revProj * gpPctProj;
  const gp$Goal = revGoal * gpPctGoal;
  const gap = gp$Goal - gp$Proj;
  const hasGoal = revGoal > 0;
  const onTrack = !hasGoal || gap <= gp$Goal * 0.005;  // within 0.5% of goal GP$

  // Goal-meeting levels. ARO is a rate (period-independent); derive the cars
  // target from the revenue goal at that ARO so the split reconciles exactly.
  const aroGoal = b && b.benchmark.aro > 0 ? b.benchmark.aro : aroProj;
  const carsGoal = aroGoal > 0 ? revGoal / aroGoal : carsProj;

  // Exact decomposition. Level 1: GP$ gap = revenue effect + margin effect.
  const revGapRev = revGoal - revProj;                 // revenue dollars short
  const carsRev = aroProj * (carsGoal - carsProj);     // volume effect ($rev)
  const aroRev = carsGoal * (aroGoal - aroProj);       // rate effect ($rev)  (carsRev+aroRev == revGapRev)
  const carsGp$ = gpPctProj * carsRev;
  const aroGp$ = gpPctProj * aroRev;
  const revGp$ = gpPctProj * revGapRev;                // == carsGp$ + aroGp$
  const gpPctGp$ = revGoal * (gpPctGoal - gpPctProj);  // margin effect; (revGp$+gpPctGp$ == gap)

  // Rate metrics the projection can't give us (close rate, conversion) come
  // from the benchmark endpoint: recent = current operating level, benchmark =
  // the level in goal-hitting weeks.
  const convCur = cur?.conversion ?? b?.recent.conversion ?? null, convGoal = b?.benchmark.conversion ?? null;
  const closeCur = cur?.closeRate ?? b?.recent.closeRate ?? 0, closeGoal = b?.benchmark.closeRate ?? 0;
  const partsGp = cur?.partsGp ?? null, laborGp = cur?.laborGp ?? null;

  // ── CAR COUNT → Call volume vs Call conversion (never re-books). ──
  // If conversion is below the level run in goal-hitting weeks, it's a BOOKING
  // problem; if it's already there, the gap is inbound CALL VOLUME.
  const convAvail = convGoal != null && convCur != null && convGoal > 0;
  const convBelow = convAvail && (convCur as number) < (convGoal as number) * 0.98;
  const carsBranches: GpBranch[] = [
    { label: 'Call volume', detail: !convAvail ? 'inbound calls / leads — marketing & phone coverage' : convBelow ? 'conversion is the constraint here, not lead volume' : `conversion already at goal (${pn(convGoal)}) — the gap is inbound calls & leads: marketing & phone coverage`, active: convAvail ? !convBelow : false },
    { label: 'Call conversion', detail: !convAvail ? 'booking rate of the calls you get (no history yet)' : convBelow ? `${pn(convCur)} → ${pn(convGoal)} — book more of the calls you already get` : `${pn(convCur)} — already at the goal-week level`, active: convBelow },
  ];
  const carsPrimaryCause = !convAvail ? 'Calls & conversion' : convBelow ? 'Call conversion' : 'Call volume';
  const carsPrimaryFix = !convAvail ? 'check inbound call volume and booking rate' : convBelow ? `lift conversion ${pn(convCur)} → ${pn(convGoal)}` : 'grow inbound call & lead volume (marketing, phone coverage)';

  // ── ARO → Close rate (primary driver) vs Ticket size / AWRO (secondary). ──
  const aroBranches: GpBranch[] = [
    { label: 'Close rate', detail: `${pf(closeCur)} → ${pf(closeGoal)} — presentation, financing, declined-work follow-up`, active: true },
    { label: 'Ticket size (AWRO)', detail: 'recommend more work per car — thorough inspections', active: false },
  ];

  // ── GP% → Parts GP% vs Labor GP%, each with its own two candidate causes. ──
  let partsActive = false, laborActive = false;
  if (partsGp != null && laborGp != null) { if (partsGp <= laborGp) partsActive = true; else laborActive = true; }
  else if (partsGp != null) partsActive = true;
  else if (laborGp != null) laborActive = true;
  const gpBranches: GpBranch[] = [
    { label: 'Parts GP%', detail: `${partsGp != null ? pf(partsGp) : '—'} (margin on parts sales) — big jobs at low GP%, or parts not run through the pricing matrix`, active: partsActive },
    { label: 'Labor GP%', detail: `${laborGp != null ? pf(laborGp) : '—'} (margin on labor sales) — comebacks eating hours, or labor discounted on the ticket`, active: laborActive },
  ];
  const gpPrimaryCause = partsActive ? 'Parts GP%' : laborActive ? 'Labor GP%' : 'Parts & labor margin';
  const gpPrimaryFix = partsActive ? 'lift parts GP% — pricing matrix + check big low-GP jobs' : laborActive ? 'lift labor GP% — cut comebacks + stop discounting labor' : 'check parts & labor margin';

  const leaves: GpLeaf[] = [
    { key: 'cars' as LeafKey, label: 'Car count', gp$: carsGp$, metricCur: Math.round(carsProj) + ' cars', metricGoal: Math.round(carsGoal) + ' cars', branches: carsBranches, primaryCause: carsPrimaryCause, primaryFix: carsPrimaryFix },
    { key: 'aro' as LeafKey, label: 'ARO', gp$: aroGp$, metricCur: usd0(aroProj), metricGoal: usd0(aroGoal), branches: aroBranches, primaryCause: 'Close rate', primaryFix: `raise close rate ${pf(closeCur)} → ${pf(closeGoal)}` },
    { key: 'gpPct' as LeafKey, label: 'GP %', gp$: gpPctGp$, metricCur: pf(gpPctProj), metricGoal: pf(gpPctGoal), branches: gpBranches, primaryCause: gpPrimaryCause, primaryFix: gpPrimaryFix, note: 'blended GP% runs higher than each component because fees & shop supplies carry near-100% margin' },
  ].sort((a, c) => c.gp$ - a.gp$);
  const primary = leaves[0] && leaves[0].gp$ > 0 ? leaves[0] : null;

  return {
    num: p.num, name: p.name, district: p.district, color: p.color, ramping: !!p.ramping,
    hasGoal, onTrack,
    gp$Proj, gp$Goal, gap,
    revGp$, gpPctGp$, revProj, revGoal, gpPctProj, gpPctGoal,
    carsGp$, aroGp$, carsProj, carsGoal, aroProj, aroGoal,
    leaves, primary,
    method: b?.method ?? 'best-weeks', goalWeeks: b?.goalWeeks ?? 0, sampleWeeks: b?.sampleWeeks ?? 0,
  };
}

// ── live data ──────────────────────────────────────────────────────────────
interface ProjShop { num: string; name: string; district: string; color: string; expected: number; goal: number | null; cars: number; aro: number; gpPct: number; ramping?: boolean }
interface Live {
  hm: any; goalsReady: boolean;
  chain: { current: number; goal: number; projected: number; worst: number; best: number; cars: number; gp$: number; aro: number; gpPct: number; elapsed: number; total: number; conf: number | null; districts: { name: string; expected: number; goal: number | null; cars: number }[]; shops: ProjShop[] };
  trees: GpTree[];
}

export default function Concept2Diagnostic() {
  const [range, setRange] = useState('this_week');
  const [data, setData] = useState<Live | null>(null);
  const [err, setErr] = useState(false);
  const [projTab, setProjTab] = useState<'portfolio' | 'districts' | 'shops'>('portfolio');
  const [gpTab, setGpTab] = useState<'portfolio' | 'districts' | 'shops'>('portfolio');
  const [hmMetric, setHmMetric] = useState('revenue');
  const [openShop, setOpenShop] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    const period = RANGES.find((r) => r.key === range)?.period || 'this_week';
    const completed = isCompletedPeriod(range);
    (async () => {
      const [hm, proj, metrics, bench] = await Promise.all([
        safe<any>('/api/shop-performance-heatmap?weeks=12'),
        completed ? Promise.resolve(null) : safe<any>(`/api/exec-metrics?view=projection&period=${period}`),
        safe<any>('/api/metrics?range=this_week'),
        safe<any>('/api/exec-metrics?view=goal-benchmarks'),
      ]);
      if (!alive) return;
      if (!hm && !proj && !metrics) { setErr(true); return; }

      const benchByShop: Record<string, ShopBenchmark> = {};
      for (const sb of bench?.shops ?? []) benchByShop[sb.shopNum] = sb;
      const elTot = elapsedAndTotal(period, new Date());

      let chain: Live['chain'];
      const curByShop: Record<string, { closeRate?: number; conversion?: number | null; rebook?: number | null; partsGp?: number | null; laborGp?: number | null }> = {};

      if (completed) {
        // LAST WEEK — actuals from the most-recently-completed heatmap column
        // (the last column is the in-progress current week, so use length-2).
        const wks: string[] = hm?.weeks ?? [];
        const wkIdx = wks.length - 2;
        const shops: ProjShop[] = META.map((m) => {
          const row = (hm?.shops ?? []).find((s: any) => s.shopNum === m.num);
          const c = wkIdx >= 0 ? row?.cells?.[wkIdx] : null;
          if (c) curByShop[m.num] = {
            closeRate: c.closeRate ?? undefined,
            conversion: c.conversion != null && c.conversion >= 0 ? c.conversion : null,
            rebook: c.rebook != null && c.rebook >= 0 ? c.rebook : null,
          };
          // Prorate the weekly goal to the week's actual working days, so a
          // holiday-shortened week (e.g. Memorial week = 4 days) isn't judged
          // against a full 5-day target — same proration the projection uses.
          const weekly = DEFAULT_GOALS[m.num]?.revenueWeekly;
          return {
            num: m.num, name: m.name, district: m.district, color: m.color,
            expected: c?.revenue ?? 0, goal: weekly != null ? weekly * (elTot.total / 5) : null,
            cars: c?.cars ?? 0, aro: c?.aro ?? 0, gpPct: c ? (c.gpPct ?? 0) * 100 : 0, ramping: false,
            _gp$: c?.gpDollars ?? 0,
          } as ProjShop & { _gp$: number };
        });
        const sumRev = shops.reduce((a, s) => a + s.expected, 0);
        const sumCars = shops.reduce((a, s) => a + s.cars, 0);
        const sumGp = shops.reduce((a, s) => a + ((s as any)._gp$ ?? 0), 0);
        const sumGoal = shops.reduce((a, s) => a + (s.goal ?? 0), 0);
        // districts (group by metro, preserving first-seen order)
        const dOrder: string[] = []; const dAgg = new Map<string, { expected: number; cars: number; goal: number }>();
        for (const s of shops) { if (!dAgg.has(s.district)) { dAgg.set(s.district, { expected: 0, cars: 0, goal: 0 }); dOrder.push(s.district); } const a = dAgg.get(s.district)!; a.expected += s.expected; a.cars += s.cars; a.goal += (s.goal ?? 0); }
        chain = {
          current: sumRev, goal: sumGoal, projected: sumRev, worst: sumRev, best: sumRev,
          cars: sumCars, gp$: Math.round(sumGp), aro: sumCars ? sumRev / sumCars : 0, gpPct: sumRev ? (sumGp / sumRev) * 100 : 0,
          elapsed: elTot.elapsed, total: elTot.total, conf: null,
          districts: dOrder.map((name) => { const a = dAgg.get(name)!; return { name, expected: a.expected, goal: a.goal, cars: a.cars }; }),
          shops,
        };
      } else {
        // current/forward period — driven by the live projection payload
        const kByShop: Record<string, any> = {}; for (const s of metrics?.kpi?.byShop ?? []) kByShop[s.shopNum] = s;
        // current parts/labor GP% feed the GP% leaf's margin sub-causes
        for (const m of META) { const k = kByShop[m.num]; if (k) curByShop[m.num] = { partsGp: k.partsGpPct ?? null, laborGp: k.laborGpPct ?? null }; }
        const p = proj?.portfolio, per = proj?.period;
        const sumRev = META.reduce((a, m) => { const k = kByShop[m.num]; return a + (k?.revenue ?? 0); }, 0);
        const sumGoal = META.reduce((a, m) => a + (DEFAULT_GOALS[m.num]?.revenueWeekly ?? 0), 0);
        const gp$ = META.reduce((a, m) => { const k = kByShop[m.num]; return a + (k?.gpDollars ?? 0); }, 0);
        const cars = META.reduce((a, m) => { const k = kByShop[m.num]; return a + (k?.cars ?? 0); }, 0);
        chain = {
          current: typeof per?.actualRevenue === 'number' ? per.actualRevenue : sumRev,
          goal: p?.goalRevenue ?? sumGoal, projected: p?.expected ?? sumRev,
          worst: p?.worstCase ?? Math.round(sumRev * 0.95), best: p?.bestCase ?? Math.round(sumRev * 1.08),
          cars: p?.projectedCars ?? cars, gp$: p?.projectedGpDollars ?? Math.round(gp$),
          aro: p?.projectedAro ?? (cars ? sumRev / cars : 0), gpPct: sumRev ? (gp$ / sumRev) * 100 : 0,
          elapsed: elTot.elapsed, total: elTot.total, conf: typeof p?.confidence === 'number' ? p.confidence : null,
          districts: (proj?.districts ?? []).map((d: any) => ({ name: d.label, expected: d.expected, goal: d.goalRevenue ?? null, cars: d.projectedCars })),
          shops: (proj?.shops ?? []).map((s: any) => { const m = META.find((x) => x.num === s.shopNum); return { num: s.shopNum, color: m?.color || FAINT, name: s.shopName, district: s.district, expected: s.expected, goal: s.goalRevenue ?? null, cars: s.projectedCars, aro: s.projectedAro, gpPct: s.projectedGpPct, ramping: s.isRamping }; }),
        };
      }

      // GP$ diagnostic trees — period-aware. For last week the inputs are real
      // actuals (incl. that week's own close/conversion); otherwise they're the
      // timeframe-scaled projection + the shop's recent operating rates.
      const trees = (chain.shops as ProjShop[]).map((s) => buildGpTree(s, benchByShop[s.num], curByShop[s.num])).sort((a, b) => b.gap - a.gap);

      setData({ hm, goalsReady: true, chain, trees });
    })();
    return () => { alive = false; };
  }, [range]);

  if (err) return <Shell range={range} setRange={setRange}><div className="c2ui text-center py-24" style={{ color: INK2 }}>Diagnostic data is warming up — refresh in a moment.</div></Shell>;
  if (!data) return <Shell range={range} setRange={setRange}><LoadingSkeleton /></Shell>;

  const { chain, trees, hm } = data;
  const pace = chain.goal ? chain.current / chain.goal : 0;
  const periodLabel = (RANGES.find((r) => r.key === range)?.label || 'This Week').toLowerCase();
  const completed = isCompletedPeriod(range);

  // GP$ diagnostic rollups (only shops projected short of their GP$ goal)
  const leaks = trees.filter((t) => t.hasGoal && !t.onTrack && t.gap > 0);
  const totalGpGap = leaks.reduce((s, t) => s + t.gap, 0);
  const portRev = leaks.reduce((s, t) => s + Math.max(0, t.revGp$), 0);
  const portMargin = leaks.reduce((s, t) => s + Math.max(0, t.gpPctGp$), 0);
  const portCars = leaks.reduce((s, t) => s + Math.max(0, t.carsGp$), 0);
  const portAro = leaks.reduce((s, t) => s + Math.max(0, t.aroGp$), 0);
  // Group shops by the single biggest lever for each — answers "is it one thing
  // at a few shops, or different things at different shops?"
  const leverGroups = (['cars', 'aro', 'gpPct'] as LeafKey[])
    .map((key) => {
      const shops = leaks.filter((t) => t.primary?.key === key).sort((a, b) => (b.primary!.gp$) - (a.primary!.gp$));
      const dollars = shops.reduce((s, t) => s + (t.primary?.gp$ ?? 0), 0);
      const label = key === 'cars' ? 'Car count' : key === 'aro' ? 'ARO' : 'GP %';
      return { key, label, dollars, shops };
    })
    .filter((g) => g.shops.length > 0)
    .sort((a, b) => b.dollars - a.dollars);
  const topLever = leverGroups[0] || null;
  const biggestShop = leaks[0] || null; // trees are sorted by gap desc
  // heat score for a branch by its share of the shop's GP$ gap (warm = big leak)
  const leakScore = (gp$: number, gap: number) => (gp$ <= 0 ? 0.85 : Math.max(0.05, 1 - Math.min(1, (gap > 0 ? gp$ / gap : 0) / 0.6)));

  // forecast confidence — shown distinctly from the plain metrics
  const conf = chain.conf;
  const confLabel = conf == null ? '' : conf >= 80 ? 'High' : conf >= 60 ? 'Moderate' : conf >= 40 ? 'Low' : 'Very Low';
  const confColor = conf == null ? FAINT : conf >= 80 ? '#3E8E5E' : conf >= 60 ? '#B5631F' : '#C05A2E';

  // GP$ projection roll-ups (built from the same per-shop trees that drive the
  // diagnostic, so the GP Projection box and the tree never disagree)
  const gpShops = trees.map((t) => ({ num: t.num, name: t.name, district: t.district, color: t.color, gp$: t.gp$Proj, goal: t.gp$Goal, gpPct: t.gpPctProj * 100, rev: t.revProj, cars: t.carsProj, ramping: t.ramping }));
  const gpPort = gpShops.reduce((a, s) => ({ gp$: a.gp$ + s.gp$, goal: a.goal + s.goal, rev: a.rev + s.rev, cars: a.cars + s.cars }), { gp$: 0, goal: 0, rev: 0, cars: 0 });
  const gpPortPct = gpPort.rev ? (gpPort.gp$ / gpPort.rev) * 100 : 0;
  const gpDistOrder: string[] = []; const gpDistAgg = new Map<string, { gp$: number; goal: number; rev: number; cars: number }>();
  for (const s of gpShops) { if (!gpDistAgg.has(s.district)) { gpDistAgg.set(s.district, { gp$: 0, goal: 0, rev: 0, cars: 0 }); gpDistOrder.push(s.district); } const a = gpDistAgg.get(s.district)!; a.gp$ += s.gp$; a.goal += s.goal; a.rev += s.rev; a.cars += s.cars; }
  const gpDistricts = gpDistOrder.map((name) => { const a = gpDistAgg.get(name)!; return { name, gp$: a.gp$, goal: a.goal, gpPct: a.rev ? (a.gp$ / a.rev) * 100 : 0, cars: a.cars }; });
  const gpWorst = Math.round(chain.worst * (gpPortPct / 100)), gpBest = Math.round(chain.best * (gpPortPct / 100));

  // comparison + heatmap + trend use the 12-week heatmap data
  const hmShops: any[] = hm?.shops ?? [];
  const hmWeeks: string[] = hm?.weeks ?? [];

  return (
    <Shell range={range} setRange={setRange}>
      {/* Revenue Projection (or last week's actuals) */}
      <Card id="projection" eyebrow={completed ? 'Last Week' : 'Forecast'} title={completed ? 'Last Week — Actuals' : 'Revenue Projection'}
        right={<Tabs value={projTab} onChange={(v) => setProjTab(v as any)} tabs={[['portfolio', 'Portfolio'], ['districts', 'Districts'], ['shops', 'Shop-by-Shop']]} />}>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 mb-5 c2ui text-[13px]" style={{ color: INK2 }}>
          <span>{completed ? 'Revenue' : 'Current Revenue'} <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 16 }}>{usd(chain.current)}</span></span>
          <span>{completed ? 'Working Days' : 'Period Elapsed'} <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 16 }}>{chain.elapsed.toFixed(1)} / {chain.total} days</span></span>
          <span>Goal <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 16 }}>{usd(chain.goal)}</span></span>
        </div>
        {projTab === 'portfolio' && (
          <div className="rounded-3xl p-6" style={{ background: 'linear-gradient(160deg, rgba(95,169,214,0.10), rgba(242,206,112,0.08) 55%, rgba(232,134,62,0.10))', border: `1px solid ${LINE}` }}>
            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-center">
              <div>
                <BigStat label={completed ? 'Actual' : 'Projected'} value={usd(chain.projected)} sub={<span style={{ color: chain.projected >= chain.goal ? '#3E8E5E' : '#C05A2E' }} className="font-semibold">{chain.projected >= chain.goal ? '+' : '−'}{usdK(Math.abs(chain.projected - chain.goal))} vs goal{completed ? '' : ` · pacing ${(pace * 100).toFixed(0)}%`}</span>} />
                {!completed && <div className="mt-5"><ForecastBar worst={chain.worst} expected={chain.projected} best={chain.best} /></div>}
                {completed ? (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5" style={{ background: 'rgba(255,255,255,0.6)', border: `1px solid ${LINE}` }}>
                    <span className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: FAINT }}>% of goal</span>
                    <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 15 }}>{Math.round(pace * 100)}%</span>
                  </div>
                ) : conf != null && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5" style={{ background: 'rgba(255,255,255,0.6)', border: `1px solid ${confColor}55` }}>
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: confColor }} />
                    <span className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: FAINT }}>Forecast confidence</span>
                    <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 15 }}>{conf}%</span>
                    <span className="c2ui text-[13px] font-semibold" style={{ color: confColor }}>{confLabel}</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Cars" value={String(chain.cars)} /><MiniStat label="ARO" value={usd0(chain.aro)} />
                <MiniStat label="GP $" value={usdK(chain.gp$)} /><MiniStat label="GP %" value={chain.gpPct.toFixed(1) + '%'} />
              </div>
            </div>
          </div>
        )}
        {projTab === 'districts' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {chain.districts.map((d) => { const sc = norm(d.goal ? d.expected / d.goal : 1, 0.82, 1.04); return (
              <div key={d.name} className="rounded-3xl p-5" style={heatCell(sc)}>
                <div className="flex items-baseline justify-between"><div className="c2disp" style={{ color: INK, fontSize: 19 }}>{d.name}</div>{d.goal ? <div className="c2ui text-[12.5px] font-semibold uppercase tracking-wide" style={{ color: INK2 }}>{Math.round(d.expected / d.goal * 100)}% of goal</div> : null}</div>
                <div className="c2disp tabular-nums mt-2" style={{ color: INK, fontSize: 30, letterSpacing: '-0.02em' }}>{usd(d.expected)}</div>
                <div className="c2ui text-[13px] mt-2 flex gap-4" style={{ color: INK2 }}><span>{d.cars} cars</span>{d.goal ? <span>Goal {usdK(d.goal)}</span> : null}</div>
              </div>); })}
          </div>
        )}
        {projTab === 'shops' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {chain.shops.map((s) => { const sc = norm(s.goal ? s.expected / s.goal : 1, 0.80, 1.05); const gap = (s.goal ?? 0) ? s.expected - (s.goal as number) : 0; return (
              <div key={s.name} className="rounded-3xl p-5" style={heatCell(sc)}>
                <div className="flex items-center justify-between"><div className="c2disp" style={{ color: INK, fontSize: 17 }}>{s.name}</div><span className="c2ui text-[12.5px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5" style={{ background: 'rgba(255,255,255,0.6)', color: INK2 }}>{s.district}</span></div>
                <div className="c2disp tabular-nums mt-2" style={{ color: INK, fontSize: 28, letterSpacing: '-0.02em' }}>{usd(s.expected)}</div>
                {s.goal ? <div className="c2ui text-[13px] font-semibold mt-1" style={{ color: gap >= 0 ? '#3E8E5E' : '#C05A2E' }}>{gap >= 0 ? '+' : '−'}{usdK(Math.abs(gap))} vs goal{s.ramping && <span className="ml-2 font-medium" style={{ color: INK2 }}>· ramping</span>}</div> : null}
                <div className="c2ui text-[13px] mt-2 flex gap-3" style={{ color: INK2 }}><span>{s.cars} cars</span><span>{usd0(s.aro)} ARO</span><span>{Math.round(s.gpPct)}% GP</span></div>
              </div>); })}
          </div>
        )}
      </Card>

      {/* GP PROJECTION — mirrors Revenue Projection, but for gross-profit
          dollars. This is the TOP of the diagnostic tree: the section below
          decomposes exactly this GP$ gap down to each shop's biggest lever. */}
      <Card id="gp-projection" eyebrow={completed ? 'Last Week' : 'Forecast'} title={completed ? 'GP$ — Actuals' : 'GP Projection'}
        sub={completed ? 'Last week’s gross-profit dollars by shop, district and portfolio.' : 'Projected gross-profit dollars — the top of the diagnostic tree below (GP$ = Revenue × GP%).'}
        right={<Tabs value={gpTab} onChange={(v) => setGpTab(v as any)} tabs={[['portfolio', 'Portfolio'], ['districts', 'Districts'], ['shops', 'Shop-by-Shop']]} />}>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 mb-5 c2ui text-[13px]" style={{ color: INK2 }}>
          <span>GP$ Goal <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 16 }}>{usd(gpPort.goal)}</span></span>
          <span>GP % <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 16 }}>{gpPortPct.toFixed(1)}%</span> <span style={{ color: FAINT }}>· target 58%</span></span>
          <span>Revenue <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 16 }}>{usd(gpPort.rev)}</span></span>
        </div>
        {gpTab === 'portfolio' && (() => { const gap = gpPort.gp$ - gpPort.goal; const pctGoal = gpPort.goal ? (gpPort.gp$ / gpPort.goal) * 100 : 0; return (
          <div className="rounded-3xl p-6" style={{ background: 'linear-gradient(160deg, rgba(139,205,197,0.12), rgba(242,206,112,0.08) 55%, rgba(232,134,62,0.10))', border: `1px solid ${LINE}` }}>
            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-center">
              <div>
                <BigStat label={completed ? 'Actual GP$' : 'Projected GP$'} value={usd(gpPort.gp$)} sub={<span style={{ color: gap >= 0 ? '#3E8E5E' : '#C05A2E' }} className="font-semibold">{gap >= 0 ? '+' : '−'}{usdK(Math.abs(gap))} vs goal · GP {gpPortPct.toFixed(1)}%</span>} />
                {!completed && <div className="mt-5"><ForecastBar worst={gpWorst} expected={gpPort.gp$} best={gpBest} /></div>}
                {!completed && conf != null && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5" style={{ background: 'rgba(255,255,255,0.6)', border: `1px solid ${confColor}55` }}>
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: confColor }} />
                    <span className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: FAINT }}>Forecast confidence</span>
                    <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 15 }}>{conf}%</span>
                    <span className="c2ui text-[13px] font-semibold" style={{ color: confColor }}>{confLabel}</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="GP %" value={gpPortPct.toFixed(1) + '%'} /><MiniStat label="Revenue" value={usdK(gpPort.rev)} />
                <MiniStat label="Cars" value={String(gpPort.cars)} /><MiniStat label="% of Goal" value={Math.round(pctGoal) + '%'} />
              </div>
            </div>
          </div>); })()}
        {gpTab === 'districts' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {gpDistricts.map((d) => { const sc = norm(d.goal ? d.gp$ / d.goal : 1, 0.82, 1.04); return (
              <div key={d.name} className="rounded-3xl p-5" style={heatCell(sc)}>
                <div className="flex items-baseline justify-between"><div className="c2disp" style={{ color: INK, fontSize: 19 }}>{d.name}</div>{d.goal ? <div className="c2ui text-[12.5px] font-semibold uppercase tracking-wide" style={{ color: INK2 }}>{Math.round(d.gp$ / d.goal * 100)}% of GP goal</div> : null}</div>
                <div className="c2disp tabular-nums mt-2" style={{ color: INK, fontSize: 30, letterSpacing: '-0.02em' }}>{usd(d.gp$)}</div>
                <div className="c2ui text-[13px] mt-2 flex gap-4" style={{ color: INK2 }}><span>{d.gpPct.toFixed(1)}% GP</span>{d.goal ? <span>Goal {usdK(d.goal)}</span> : null}</div>
              </div>); })}
          </div>
        )}
        {gpTab === 'shops' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {gpShops.map((s) => { const sc = norm(s.goal ? s.gp$ / s.goal : 1, 0.80, 1.05); const gap = s.goal ? s.gp$ - s.goal : 0; return (
              <div key={s.num} className="rounded-3xl p-5" style={heatCell(sc)}>
                <div className="flex items-center justify-between"><div className="c2disp" style={{ color: INK, fontSize: 17 }}>{s.name}</div><span className="c2ui text-[12.5px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5" style={{ background: 'rgba(255,255,255,0.6)', color: INK2 }}>{s.district}</span></div>
                <div className="c2disp tabular-nums mt-2" style={{ color: INK, fontSize: 28, letterSpacing: '-0.02em' }}>{usd(s.gp$)}</div>
                {s.goal ? <div className="c2ui text-[13px] font-semibold mt-1" style={{ color: gap >= 0 ? '#3E8E5E' : '#C05A2E' }}>{gap >= 0 ? '+' : '−'}{usdK(Math.abs(gap))} vs goal{s.ramping && <span className="ml-2 font-medium" style={{ color: INK2 }}>· ramping</span>}</div> : null}
                <div className="c2ui text-[13px] mt-2 flex gap-3" style={{ color: INK2 }}><span>{s.gpPct.toFixed(1)}% GP</span><span>{usdK(s.rev)} rev</span><span>{s.cars} cars</span></div>
              </div>); })}
          </div>
        )}
      </Card>

      {/* DIAGNOSTIC — GP$ tree: GP$ → Revenue/GP% → Cars/ARO → root cause */}
      <Card id="opportunity" eyebrow="Operational Diagnostic" title="Where GP$ is leaking"
        sub={`The tree starts at GP$. For every shop ${completed ? 'that came up short of' : 'projected short of'} its GP$ goal ${periodLabel === 'this week' ? 'this week' : (completed ? '' : 'for ') + periodLabel}, we split the gap into Revenue vs GP%, then Car count vs ARO, and name the single operational lever — each metric measured against the level the shop runs in the weeks it actually hits goal. Change the timeframe (top right) to re-examine the whole diagnostic on that basis.`}
        right={<div className="text-right"><div className="c2disp tabular-nums" style={{ color: AMBER, fontSize: 30 }}>{usdK(totalGpGap)}</div><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>GP$ to goal · {periodLabel}</div></div>}>

        {leaks.length === 0 ? (
          <div className="c2ui text-[13px] py-3" style={{ color: '#3E8E5E' }}>Every shop {completed ? 'hit' : 'is projected to hit'} its GP$ goal {periodLabel === 'this week' ? 'this week' : (completed ? '' : 'for ') + periodLabel}. ✓</div>
        ) : (<>
          {/* #1 lever to move GP$ + portfolio split */}
          {topLever && (
            <div className="rounded-3xl p-6 mb-5" style={{ background: 'linear-gradient(150deg, rgba(232,134,62,0.12), rgba(242,206,112,0.10))', border: `1px solid rgba(232,134,62,0.25)` }}>
              <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: '#B5631F' }}>#1 lever to move GP$ · {periodLabel}</div>
              <div className="c2disp mt-1.5" style={{ color: INK, fontSize: 30, letterSpacing: '-0.01em' }}>{topLever.label}</div>
              <div className="c2ui text-[13.5px] mt-2 leading-relaxed" style={{ color: INK2 }}>
                <span style={{ color: INK, fontWeight: 600 }}>{usdK(topLever.dollars)}</span> of the GP$ gap is {topLever.label.toLowerCase()}{topLever.shops.length === 1 ? ' at ' : ' across '}<span style={{ color: INK, fontWeight: 600 }}>{topLever.shops.slice(0, 4).map((t) => t.name).join(', ')}</span>{topLever.shops.length > 4 ? ` +${topLever.shops.length - 4} more` : ''}.
                {' '}Of the {usdK(totalGpGap)} total gap, <span style={{ color: INK, fontWeight: 600 }}>{usdK(portRev)}</span> is revenue ({usdK(portCars)} car count · {usdK(portAro)} ARO) and <span style={{ color: INK, fontWeight: 600 }}>{usdK(portMargin)}</span> is margin (GP%).
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {leverGroups.map((g) => (
                  <span key={g.key} className="c2ui inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px]" style={{ background: 'rgba(255,255,255,0.65)', border: `1px solid ${LINE}` }}>
                    <span style={{ color: INK, fontWeight: 600 }}>{g.label}</span>
                    <span className="c2disp tabular-nums" style={{ color: '#B5631F' }}>{usdK(g.dollars)}</span>
                    <span style={{ color: INK2 }}>{g.shops.map((t) => t.name).join(', ')}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* context tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}><div className="c2ui text-[12.5px] uppercase tracking-wide font-semibold" style={{ color: FAINT }}>GP$ to goal</div><div className="c2disp tabular-nums mt-1" style={{ color: INK, fontSize: 24 }}>{usdK(totalGpGap)}</div></div>
            <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}><div className="c2ui text-[12.5px] uppercase tracking-wide font-semibold" style={{ color: FAINT }}>Shops below GP$ goal</div><div className="c2disp tabular-nums mt-1" style={{ color: INK, fontSize: 24 }}>{leaks.length} / {trees.filter((t) => t.hasGoal).length}</div></div>
            <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}><div className="c2ui text-[12.5px] uppercase tracking-wide font-semibold" style={{ color: FAINT }}>Biggest single gap</div>{biggestShop ? <div className="c2disp mt-1 flex items-baseline gap-2" style={{ color: INK, fontSize: 22 }}><span>{biggestShop.name}</span><span className="tabular-nums" style={{ color: '#B5631F', fontSize: 16 }}>{usdK(biggestShop.gap)}</span></div> : <div className="c2disp mt-1" style={{ color: INK, fontSize: 22 }}>—</div>}</div>
          </div>
        </>)}

        {/* per-shop GP$ tree rows */}
        <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.14em] mb-2" style={{ color: FAINT }}>By shop — tap to walk the GP$ tree</div>
        <div className="space-y-2">
          {trees.map((t) => {
            const open = openShop === t.num;
            const sc = !t.hasGoal ? 0.5 : t.onTrack ? 0.9 : norm(t.gp$Goal > 0 ? t.gp$Proj / t.gp$Goal : 1, 0.80, 1.02);
            const carsLeaf = t.leaves.find((l) => l.key === 'cars')!;
            const aroLeaf = t.leaves.find((l) => l.key === 'aro')!;
            const gpLeaf = t.leaves.find((l) => l.key === 'gpPct')!;
            // Full decision tree. $ nodes carry a dollar attribution; branch
            // nodes are the named root causes (shown only under a leaf that's
            // actually leaking, so you only walk down where there's a problem).
            type TNode = { kind: '$' | 'branch'; depth: number; label: string; gp$?: number; cur?: string; goal?: string; detail?: string; active?: boolean; note?: string };
            const nodes: TNode[] = [
              { kind: '$', depth: 0, label: 'Revenue', gp$: t.revGp$, cur: usdK(t.revProj), goal: usdK(t.revGoal) },
              { kind: '$', depth: 1, label: carsLeaf.label, gp$: carsLeaf.gp$, cur: carsLeaf.metricCur, goal: carsLeaf.metricGoal },
              ...(carsLeaf.gp$ > 0 ? carsLeaf.branches.map((br) => ({ kind: 'branch' as const, depth: 2, label: br.label, detail: br.detail, active: br.active })) : []),
              { kind: '$', depth: 1, label: aroLeaf.label, gp$: aroLeaf.gp$, cur: aroLeaf.metricCur, goal: aroLeaf.metricGoal },
              ...(aroLeaf.gp$ > 0 ? aroLeaf.branches.map((br) => ({ kind: 'branch' as const, depth: 2, label: br.label, detail: br.detail, active: br.active })) : []),
              { kind: '$', depth: 0, label: gpLeaf.label, gp$: gpLeaf.gp$, cur: gpLeaf.metricCur, goal: gpLeaf.metricGoal, note: gpLeaf.gp$ > 0 ? gpLeaf.note : undefined },
              ...(gpLeaf.gp$ > 0 ? gpLeaf.branches.map((br) => ({ kind: 'branch' as const, depth: 1, label: br.label, detail: br.detail, active: br.active })) : []),
            ];
            return (
              <div key={t.num} className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
                <button onClick={() => setOpenShop(open ? null : t.num)} className="w-full text-left px-4 py-3 flex items-center gap-3" style={heatCell(sc)}>
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="c2ui font-semibold shrink-0" style={{ color: INK, fontSize: 13, width: 110 }}>{t.name}{t.ramping && <span className="c2ui font-normal" style={{ color: FAINT, fontSize: 12.5 }}> · ramping</span>}</span>
                  <span className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
                    {t.onTrack ? (
                      <span className="c2ui text-[13px]" style={{ color: '#3E8E5E' }}>On GP$ goal ✓</span>
                    ) : t.primary ? (
                      <span className="c2ui inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12.5px]" style={{ background: 'rgba(255,255,255,0.6)' }}>
                        <span style={{ color: INK, fontWeight: 600 }}>{t.primary.label}</span>
                        <span style={{ color: '#B5631F' }}>{usdK(t.primary.gp$)}</span>
                        <span style={{ color: INK2 }}>via {t.primary.primaryCause.toLowerCase()}</span>
                      </span>
                    ) : <span className="c2ui text-[13px]" style={{ color: INK2 }}>—</span>}
                  </span>
                  <span className="c2disp tabular-nums shrink-0 text-right" style={{ color: t.onTrack ? '#3E8E5E' : '#B5631F', fontSize: 15, width: 88 }}>{t.onTrack ? '✓' : usdK(t.gap) + ' short'}</span>
                </button>
                {open && (
                  <div className="px-4 py-4" style={{ background: 'rgba(255,255,255,0.7)' }}>
                    <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                      <div className="c2ui text-[12.5px]" style={{ color: INK2 }}>
                        <span className="c2disp" style={{ color: INK, fontSize: 16 }}>GP$ {usdK(t.gp$Proj)}</span> {completed ? 'actual' : 'projected'} vs <span style={{ fontWeight: 600, color: INK }}>{usdK(t.gp$Goal)}</span> goal
                        {t.onTrack ? <span style={{ color: '#3E8E5E', fontWeight: 600 }}> · on goal ✓</span> : <span style={{ color: '#B5631F', fontWeight: 600 }}> · short {usdK(t.gap)} {periodLabel}</span>}
                      </div>
                      <span className="c2ui text-[12.5px]" style={{ color: FAINT }}>{t.method === 'goal-met' ? `benchmarked vs ${t.goalWeeks} goal-hitting week${t.goalWeeks === 1 ? '' : 's'}` : `best-weeks benchmark · rarely hits goal (${t.sampleWeeks} wks)`}</span>
                    </div>
                    {!t.onTrack && (
                      <div className="space-y-1.5">
                        {nodes.map((nd, i) => {
                          if (nd.kind === 'branch') {
                            // named root cause — highlight the one the data points to
                            return (
                              <div key={i} className="flex items-stretch gap-2" style={{ paddingLeft: nd.depth * 22 }}>
                                <span className="shrink-0 self-stretch" style={{ width: 2, borderRadius: 2, background: nd.active ? 'rgba(232,134,62,0.5)' : 'rgba(34,32,28,0.10)' }} />
                                <div className="flex-1 rounded-xl px-3 py-2" style={nd.active ? { background: 'rgba(232,134,62,0.10)', border: '1px solid rgba(232,134,62,0.35)' } : { background: 'rgba(34,32,28,0.03)', border: `1px solid ${LINE}` }}>
                                  <div className="flex items-center gap-2">
                                    <span className="c2ui font-semibold" style={{ color: nd.active ? INK : INK2, fontSize: 13 }}>{nd.label}</span>
                                    {nd.active && <span className="c2ui text-[13px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{ background: 'rgba(232,134,62,0.18)', color: '#B5631F' }}>likely cause</span>}
                                  </div>
                                  <div className="c2ui text-[12.5px] mt-0.5" style={{ color: nd.active ? INK2 : FAINT }}>{nd.detail}</div>
                                </div>
                              </div>
                            );
                          }
                          const leak = (nd.gp$ ?? 0) > 0;
                          const nsc = leak ? leakScore(nd.gp$ ?? 0, t.gap) : 0.85;
                          return (
                            <div key={i} className="flex items-stretch gap-2" style={{ paddingLeft: nd.depth * 22 }}>
                              {nd.depth > 0 && <span className="shrink-0 self-stretch" style={{ width: 2, borderRadius: 2, background: 'rgba(34,32,28,0.10)' }} />}
                              <div className="flex-1 rounded-xl px-3 py-2" style={leak ? heatCell(nsc) : { background: 'rgba(62,142,94,0.07)', border: `1px solid ${LINE}` }}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="c2ui font-semibold" style={{ color: INK, fontSize: nd.depth ? 12 : 13 }}>{nd.label}</span>
                                  <span className="c2disp tabular-nums" style={{ color: leak ? '#B5631F' : '#3E8E5E', fontSize: 12.5 }}>{leak ? usdK(nd.gp$ ?? 0) + ' short' : '+' + usdK(-(nd.gp$ ?? 0)) + ' ahead'}</span>
                                </div>
                                <div className="c2ui text-[12.5px] mt-0.5" style={{ color: INK2 }}>
                                  <span className="tabular-nums">{nd.cur}</span> → <span className="tabular-nums" style={{ color: INK, fontWeight: 600 }}>{nd.goal}</span>
                                </div>
                                {nd.note && leak && <div className="c2ui text-[12.5px] mt-0.5" style={{ color: FAINT }}>{nd.note}</div>}
                              </div>
                            </div>
                          );
                        })}
                        {t.primary && <div className="c2ui text-[13px] mt-3" style={{ color: INK2 }}><span style={{ color: INK, fontWeight: 600 }}>Start here:</span> {t.primary.label} → {t.primary.primaryCause} — the biggest single GP$ lever for {t.name} {periodLabel} ({usdK(t.primary.gp$)}; {t.primary.primaryFix}).</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="c2ui text-[12.5px] mt-4 leading-relaxed" style={{ color: FAINT }}>Method: GP$ sits at the top, decomposed exactly — GP$ = Revenue × GP%, then the Revenue gap = Car count × ARO. <span style={{ color: INK2, fontWeight: 600 }}>Car count</span> → Call volume vs Call conversion (never re-books). <span style={{ color: INK2, fontWeight: 600 }}>ARO</span> → Close rate (declined-work follow-up / financing). <span style={{ color: INK2, fontWeight: 600 }}>GP%</span> → Parts GP% (big low-GP jobs / pricing matrix) vs Labor GP% (comebacks / discounted labor). Goal levels are the median of each metric across the weeks the shop actually hit its revenue goal (best weeks where goal is rare). Everything scales to the selected timeframe.</div>
      </Card>

      {/* Shop comparison — metric + range + granularity + comparison */}
      <ComparisonSection />

      {/* Shop Performance heatmap — 12 weeks × shops, metric selector */}
      <HeatmapMatrix shops={hmShops} weeks={hmWeeks} metric={hmMetric} setMetric={setHmMetric} />

      {/* Performance trends — real current vs prior period */}
      <TrendsSection />

      {/* Accounts Receivable — modes + by-shop + trend */}
      <ConceptAR />

      {/* Return Customers */}
      <ReturnCustomers />

      {/* Past Trophies Earned this Quarter — moved here from the Employee
          view at user request so the YTD trophy ledger lives at the END of
          the Diagnostic page. The Employee view keeps the THIS-WEEK trophy
          tally; this is the cumulative season-to-date leaderboard. */}
      <div id="trophies-ytd" className="scroll-mt-6 mb-6"><TrophyTallyQuarter /></div>

      <footer className="c2ui text-center text-[12.5px] py-8" style={{ color: FAINT }}>The Mango Matrix · Diagnostic · concept 2 · live data + functionality</footer>
    </Shell>
  );
}

// ── Shop Comparison — full hybrid (production parity) ──────────────────────
// Revenue keeps range + daily/weekly/monthly granularity + comparison-period
// (current solid vs comparison dashed), sourced from /api/metrics dailyByShop.
// Every other metric is weekly lines from the heatmap (8/12/26 weeks).
const CMP_METRICS: { key: string; label: string; fmt: (n: number) => string; field: string; scale: number }[] = [
  { key: 'revenue', label: 'Revenue', fmt: usdK, field: '', scale: 1 },
  { key: 'gpPct', label: 'GP %', fmt: (n) => n.toFixed(1) + '%', field: 'gpPct', scale: 100 },
  { key: 'gpDollars', label: 'GP $', fmt: usdK, field: 'gpDollars', scale: 1 },
  { key: 'cars', label: 'Cars', fmt: (n) => String(Math.round(n)), field: 'cars', scale: 1 },
  { key: 'aro', label: 'ARO', fmt: usd0, field: 'aro', scale: 1 },
  { key: 'closeRate', label: 'Close Rate', fmt: (n) => n.toFixed(0) + '%', field: 'closeRate', scale: 100 },
  { key: 'conversion', label: 'Call Conversion', fmt: (n) => n.toFixed(0) + '%', field: 'conversion', scale: 1 },
  { key: 'rebook', label: 'Re-Book', fmt: (n) => n.toFixed(0) + '%', field: 'rebook', scale: 1 },
  { key: 'comebacks', label: 'Comebacks $', fmt: usdK, field: 'comebackDollars', scale: 1 },
  { key: 'hours', label: 'Hours', fmt: (n) => Math.round(n) + 'h', field: 'billedHours', scale: 1 },
];
const CMP_RANGES = [
  { key: 'this_week', label: 'This Week' }, { key: 'last_week', label: 'Last Week' },
  { key: 'this_month', label: 'This Month' }, { key: 'last_month', label: 'Last Month' },
  { key: 'this_quarter', label: 'This Quarter' }, { key: 'this_year', label: 'This Year' },
  { key: 'last_year', label: 'Last Year' }, { key: 'last_90_days', label: 'Last 90 Days' },
];
const CMP_GRAN = [{ key: 'daily', label: 'Daily' }, { key: 'weekly', label: 'Weekly' }, { key: 'monthly', label: 'Monthly' }];
const CMP_COMPARE = [{ key: 'none', label: 'No Comparison' }, { key: 'previous_period', label: 'Previous Period' }, { key: 'same_period_last_year', label: 'Same Period Last Year' }];
// Non-revenue metrics are weekly snapshots (heatmap), so a timeframe maps to a
// trailing number of weeks of data — keeps the SAME timeframe dropdown the rest
// of the dashboard uses instead of an odd "N weeks" selector.
const rangeToWeeks = (r: string): number => (({ this_week: 6, last_week: 6, this_month: 6, last_month: 9, this_quarter: 13, this_year: 26, last_year: 26, last_90_days: 13 } as Record<string, number>)[r] ?? 12);
function isWeekendStr(ymd: string): boolean { const [y, m, d] = ymd.split('-').map(Number); const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return dow === 0 || dow === 6; }

// ── localStorage snapshot cache for Shop-by-shop over time ────────────────
// The default range is `this_quarter` which is a 90-day daily-by-shop pull —
// the heaviest fetch on the page, and it sits below the fold so by the time
// the user scrolls to it they're staring at a "Loading…" spinner. Snapshot
// the last successful payload per (range, compare, metric) into
// localStorage; on remount, hydrate state from that snapshot immediately so
// the chart renders with last-seen data while a fresh fetch updates it in
// the background. 24h TTL bounds the staleness.
const CMP_SNAP_NS = 'c2diag_cmp_snap_v1';
const CMP_SNAP_TTL_MS = 24 * 60 * 60 * 1000;
function cmpSnapRead<T>(scope: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${CMP_SNAP_NS}:${scope}`);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (!t || Date.now() - t > CMP_SNAP_TTL_MS) return null;
    return v as T;
  } catch { return null; }
}
function cmpSnapWrite<T>(scope: string, v: T) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(`${CMP_SNAP_NS}:${scope}`, JSON.stringify({ t: Date.now(), v })); } catch { /* quota */ }
}

function ComparisonSection() {
  const [metric, setMetric] = useState('revenue');
  const [shopSel, setShopSel] = useState('all');
  const [range, setRange] = useState('this_quarter');
  const [gran, setGran] = useState('weekly');
  const [compare, setCompare] = useState('none');
  const [focus, setFocus] = useState<string | null>(null);
  // Lazy initializers read the last seen snapshot for the DEFAULT (initial)
  // scope so the chart renders with data immediately on first mount, before
  // the fetch resolves. Subsequent range/compare/metric changes go through
  // the useEffects below which also hydrate from snapshot before fetching.
  const [cur, setCur] = useState<any | null>(() => cmpSnapRead<any>(`cur:revenue:this_quarter`));
  const [cmp, setCmp] = useState<any | null>(() => cmpSnapRead<any>(`cmp:this_quarter:none`));
  const [heat, setHeat] = useState<any | null>(() => cmpSnapRead<any>(`heat:revenue:this_quarter`));
  const isRevenue = metric === 'revenue';
  const cfg = CMP_METRICS.find((m) => m.key === metric)!;

  useEffect(() => {
    if (!isRevenue) return;
    const scope = `cur:revenue:${range}`;
    const snap = cmpSnapRead<any>(scope);
    setCur(snap ?? null);
    let c = false;
    safe<any>(`/api/metrics?range=${range}`).then((d) => {
      if (c) return;
      if (d?.dailyByShop) { setCur(d.dailyByShop); cmpSnapWrite(scope, d.dailyByShop); }
    });
    return () => { c = true; };
  }, [isRevenue, range]);
  useEffect(() => {
    if (!isRevenue || compare === 'none') { setCmp(null); return; }
    const scope = `cmp:${range}:${compare}`;
    const snap = cmpSnapRead<any>(scope);
    setCmp(snap ?? null);
    let c = false;
    const q = new URLSearchParams({ range: 'custom', compare, base: range });
    safe<any>(`/api/metrics?${q}`).then((d) => {
      if (c) return;
      if (d?.dailyByShop) { setCmp(d.dailyByShop); cmpSnapWrite(scope, d.dailyByShop); }
    });
    return () => { c = true; };
  }, [isRevenue, compare, range]);
  useEffect(() => {
    if (isRevenue) return;
    const scope = `heat:${metric}:${range}`;
    const snap = cmpSnapRead<any>(scope);
    setHeat(snap ?? null);
    let c = false;
    safe<any>(`/api/shop-performance-heatmap?weeks=${rangeToWeeks(range)}`).then((d) => {
      if (c) return;
      if (d?.shops) { setHeat(d); cmpSnapWrite(scope, d); }
    });
    return () => { c = true; };
  }, [isRevenue, range, metric]);

  function bucketize(input: { date: string; v: number }[]): { date: string; v: number }[] {
    let pts = input;
    if (gran === 'daily') pts = pts.filter((p) => !isWeekendStr(p.date));
    else if (gran === 'weekly') { const m = new Map<string, number>(); for (const p of pts) { const [y, mo, d] = p.date.split('-').map(Number); const dt = new Date(Date.UTC(y, mo - 1, d)); const dow = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - dow); const k = dt.toISOString().slice(0, 10); m.set(k, (m.get(k) || 0) + p.v); } pts = [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, v })); }
    else if (gran === 'monthly') { const m = new Map<string, number>(); for (const p of pts) { const k = p.date.slice(0, 7) + '-01'; m.set(k, (m.get(k) || 0) + p.v); } pts = [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, v })); }
    return pts;
  }

  const shopsList = META.filter((m) => shopSel === 'all' || shopSel === m.num);
  let xLabels: string[] = []; let stepMode = false; let loading = false;
  let series: { num: string; name: string; color: string; cur: (number | null)[]; cmp: (number | null)[] | null }[] = [];
  if (isRevenue) {
    loading = !cur;
    if (cur) {
      const useStep = !!cmp && compare !== 'none';
      stepMode = useStep;
      const built = shopsList.map((m) => ({ m, curB: bucketize((cur[m.num] || []).map((p: any) => ({ date: p.date, v: p.revenue }))), cmpB: useStep && cmp ? bucketize((cmp[m.num] || []).map((p: any) => ({ date: p.date, v: p.revenue }))) : null }));
      const maxLen = Math.max(1, ...built.map((b) => (useStep ? Math.max(b.curB.length, b.cmpB?.length || 0) : b.curB.length)));
      xLabels = useStep
        ? Array.from({ length: maxLen }, (_, i) => (gran === 'daily' ? `D${i + 1}` : gran === 'weekly' ? `W${i + 1}` : `M${i + 1}`))
        : (built.find((b) => b.curB.length)?.curB || []).map((p) => p.date);
      series = built.map(({ m, curB, cmpB }) => ({ num: m.num, name: m.name, color: m.color, cur: xLabels.map((_, i) => curB[i]?.v ?? null), cmp: cmpB ? xLabels.map((_, i) => cmpB[i]?.v ?? null) : null }));
    }
  } else {
    loading = !heat;
    if (heat) {
      xLabels = heat.weeks || [];
      series = shopsList.map((m) => { const row = (heat.shops || []).find((s: any) => s.shopNum === m.num); const curr = (heat.weeks || []).map((_: any, i: number) => { const cell = row?.cells?.[i]; const raw = cell ? cell[cfg.field] : null; return raw == null ? null : (cfg.scale ? raw * cfg.scale : raw); }); return { num: m.num, name: m.name, color: m.color, cur: curr, cmp: null }; });
    }
  }

  const allVals = series.flatMap((s) => [...s.cur, ...(s.cmp || [])]).filter((v): v is number => v != null && isFinite(v));
  const min = allVals.length ? Math.min(...allVals) : 0, max = allVals.length ? Math.max(...allVals) : 1;
  // comparison loaded but every shop's comparison series is empty (e.g. the
  // comparison window has no data) → tell the user instead of a silent no-op
  const cmpRequested = isRevenue && compare !== 'none';
  const cmpEmpty = cmpRequested && !!cmp && !series.some((s) => s.cmp && s.cmp.some((v) => v != null));
  const n = xLabels.length, W = 900, H = 240, padX = 10, padT = 12, padB = 8;
  const xAt = (i: number) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (W - padX * 2));
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);
  const pathFor = (vals: (number | null)[]) => { let d = '', st = false; vals.forEach((v, i) => { if (v == null || !isFinite(v)) return; d += `${st ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)} `; st = true; }); return d.trim(); };
  const fmtX = (l: string) => (stepMode || !/^\d{4}-\d{2}-\d{2}$/.test(l) ? l : new Date(l + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }));
  const labelStep = Math.max(1, Math.ceil(n / 8));

  const controls = (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <Dropdown value={metric} onChange={(v) => { setMetric(v); setFocus(null); }} opts={CMP_METRICS.map((m) => ({ key: m.key, label: m.label }))} />
      <Dropdown value={shopSel} onChange={setShopSel} opts={[{ key: 'all', label: 'All Shops' }, ...META.map((m) => ({ key: m.num, label: m.name }))]} />
      <Dropdown value={range} onChange={setRange} opts={CMP_RANGES} />
      {isRevenue && (<>
        <Dropdown value={gran} onChange={setGran} opts={CMP_GRAN} />
        <Dropdown value={compare} onChange={setCompare} opts={CMP_COMPARE} />
      </>)}
    </div>
  );

  return (
    <Card id="comparison" eyebrow="Shop Comparison" title="Shop-by-shop over time"
      sub={isRevenue ? `${cfg.label} per shop · ${gran}${compare !== 'none' ? ' · solid = current, dashed = comparison' : ''}` : `Weekly ${cfg.label} per shop — click a shop to isolate it.`}
      right={controls}>
      {loading ? <div className="c2ui text-[13px] py-6" style={{ color: INK2 }}>Loading…</div> : !series.length || !n ? <div className="c2ui text-[13px] py-6" style={{ color: INK2 }}>No data for this selection.</div> : (
        <div className="w-full overflow-hidden">
          {cmpEmpty && <div className="c2ui text-[13px] mb-2" style={{ color: '#B5631F' }}>No data in the comparison window for this selection — only the current period is shown.</div>}
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
            {[0, 0.5, 1].map((f) => <line key={f} x1={0} x2={W} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} stroke="rgba(34,32,28,0.06)" strokeWidth={1} />)}
            {/* comparison (dashed) drawn first so the solid current period sits on top */}
            {series.map((s) => s.cmp ? <path key={s.num + 'c'} d={pathFor(s.cmp)} fill="none" stroke={s.color} strokeWidth={1.6} strokeDasharray="5 4" strokeLinecap="round" opacity={focus && focus !== s.num ? 0.05 : 0.55} /> : null)}
            {series.map((s) => <path key={s.num} d={pathFor(s.cur)} fill="none" stroke={s.color} strokeWidth={focus === s.num ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" opacity={focus && focus !== s.num ? 0.08 : 0.95} />)}
            {series.map((s) => { if (focus && focus !== s.num) return null; const li = s.cur.map((v, i) => [v, i] as [number | null, number]).filter(([v]) => v != null) as [number, number][]; if (!li.length) return null; const [v, i] = li[li.length - 1]; return <circle key={s.num} cx={xAt(i)} cy={yAt(v)} r={3.5} fill="#fff" stroke={s.color} strokeWidth={2} />; })}
          </svg>
          <div className="flex justify-between c2ui text-[12.5px] tabular-nums mt-1" style={{ color: FAINT }}>{xLabels.map((l, i) => (i % labelStep === 0 || i === n - 1) ? <span key={i}>{fmtX(l)}</span> : <span key={i} />)}</div>
          <div className="flex flex-wrap gap-2 mt-4">
            {[...series].sort((a, b) => { const av = [...a.cur].reverse().find((v) => v != null) ?? -Infinity; const bv = [...b.cur].reverse().find((v) => v != null) ?? -Infinity; return (bv as number) - (av as number); }).map((s) => { const last = [...s.cur].reverse().find((v) => v != null) as number | undefined; const on = !focus || focus === s.num; return (
              <button key={s.num} onClick={() => setFocus(focus === s.num ? null : s.num)} className="c2ui inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px]" style={{ background: on ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)', border: `1px solid ${LINE}`, opacity: on ? 1 : 0.45 }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color }} /><span style={{ color: INK, fontWeight: 600 }}>{s.name}</span>{last != null && <span className="c2disp tabular-nums" style={{ color: INK2 }}>{cfg.fmt(last)}</span>}
              </button>); })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Heatmap matrix (shops × 12 weeks, metric selector, real tiers) ─────────
const HM_METRICS = [
  { key: 'revenue', label: 'Revenue' }, { key: 'gpPct', label: 'GP %' }, { key: 'gpDollars', label: 'GP $' },
  { key: 'cars', label: 'Cars' }, { key: 'aro', label: 'ARO' }, { key: 'closeRate', label: 'Close Rate' },
  { key: 'conversion', label: 'Call Conversion' }, { key: 'rebook', label: 'Re-Books' }, { key: 'comebacks', label: 'Comebacks' },
  { key: 'billedHours', label: 'Hours' }, { key: 'rating', label: 'Google Rating' },
];
function rowMed(cells: any[], pick: (c: any) => number) { const xs = cells.filter(Boolean).map(pick).filter((v) => v > 0).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : 0; }
function HeatmapMatrix({ shops, weeks, metric, setMetric }: { shops: any[]; weeks: string[]; metric: string; setMetric: (v: string) => void }) {
  const now = new Date();
  function revGoal(num: string, wkISO: string): number | undefined {
    const weekly = DEFAULT_GOALS[num]?.revenueWeekly; if (!weekly) return undefined;
    const ws = new Date(wkISO + 'T12:00:00'); const we = new Date(ws); we.setDate(we.getDate() + 6); we.setHours(23, 59, 59);
    if (we > now) { const total = workingDaysBetween(ws, we); const done = workingDaysBetween(ws, now); return total ? weekly * (done / total) : undefined; }
    return weekly;
  }
  function colMax(pick: (c: any) => number) { let m = 0; for (const s of shops) for (const c of (s.cells || [])) { const v = c ? pick(c) : 0; if (v > m) m = v; } return m; }
  // Conversion bunches up against the absolute 60% target (everything reads
  // warm). Shade it RELATIVE to the spread actually in view so the heatmap
  // differentiates shops/weeks — best in view = cool, worst = warm.
  const _conv = shops.flatMap((s: any) => (s.cells || []).map((c: any) => (c && c.conversion != null && c.conversion >= 0 ? c.conversion : null))).filter((v: any): v is number => v != null);
  const convMin = _conv.length ? Math.min(..._conv) : 0;
  const convMax = _conv.length ? Math.max(..._conv) : 1;
  function cellRender(s: any, c: any, wkISO: string): { tier: Tier | null; big: string } {
    if (!c) return { tier: null, big: '—' };
    switch (metric) {
      case 'revenue': { const g = revGoal(s.shopNum, wkISO); if (!g) return { tier: null, big: usdK(c.revenue) }; const r = c.revenue / g; return { tier: pctTier(r), big: Math.round(r * 100) + '%' }; }
      case 'cars': { const m = rowMed(s.cells, (x) => x.cars); const r = m ? c.cars / m : null; return { tier: pctTier(r), big: String(c.cars) }; }
      case 'aro': { const m = rowMed(s.cells, (x) => x.aro); const r = m ? c.aro / m : null; return { tier: pctTier(r), big: '$' + Math.round(c.aro) }; }
      case 'gpDollars': { const m = rowMed(s.cells, (x) => x.gpDollars); const r = m ? c.gpDollars / m : null; return { tier: pctTier(r), big: usdK(c.gpDollars) }; }
      case 'gpPct': return { tier: gpTier(c.gpPct), big: (c.gpPct * 100).toFixed(0) + '%' };
      case 'closeRate': return { tier: closeTier(c.closeRate), big: (c.closeRate * 100).toFixed(0) + '%' };
      case 'conversion': { const v = c.conversion == null || c.conversion < 0 ? null : c.conversion; if (v == null) return { tier: null, big: '—' }; const rel = convMax > convMin ? (v - convMin) / (convMax - convMin) : 0.6; const tier = (1 + Math.round((1 - rel) * 4)) as Tier; return { tier, big: v.toFixed(0) + '%' }; }
      case 'rebook': { const v = c.rebook == null || c.rebook < 0 ? null : c.rebook; return { tier: rebookTier(v), big: v == null ? '—' : v.toFixed(0) + '%' }; }
      case 'comebacks': { const v = c.comebackDollars ?? 0; return { tier: comebackTier(v, colMax((x) => x.comebackDollars ?? 0)), big: usdK(v) }; }
      case 'billedHours': { const m = rowMed(s.cells, (x) => x.billedHours ?? 0); const v = c.billedHours ?? 0; const r = m ? v / m : null; return { tier: pctTier(r), big: Math.round(v) + 'h' }; }
      case 'rating': { const v = c.rating ?? null; return { tier: ratingTier(v), big: v == null ? '—' : v.toFixed(1) }; }
      default: return { tier: null, big: '—' };
    }
  }
  const wkLabel = (iso: string, i: number) => (i === weeks.length - 1 ? 'now' : new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }));
  return (
    <Card id="performance" eyebrow="Shop Performance" title="Performance heatmap" sub="Every shop across the last 12 weeks. Cooler = on pace, warmer = needs attention."
      right={<Dropdown value={metric} onChange={setMetric} opts={HM_METRICS} />} pad={false}>
      <div className="overflow-x-auto px-6 py-5">
        <table className="border-separate" style={{ borderSpacing: '5px', width: '100%', tableLayout: 'fixed', minWidth: 760 }}>
          <thead><tr>
            <th className="c2ui text-left text-[12.5px] font-semibold uppercase tracking-wide pb-1 pr-3" style={{ color: FAINT, width: 118 }}>Shop</th>
            {weeks.map((w, i) => <th key={w} className="c2ui text-center text-[12.5px] font-medium pb-1 px-1" style={{ color: FAINT }}>{wkLabel(w, i)}</th>)}
          </tr></thead>
          <tbody>
            {shops.map((s) => { const meta = META.find((m) => m.num === s.shopNum); return (
              <tr key={s.shopNum}>
                <td className="c2ui pr-3 text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: INK }}><span className="inline-flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: meta?.color || FAINT }} />{meta?.name || s.shopName}</span></td>
                {weeks.map((w, i) => { const c = (s.cells || [])[i]; const { tier, big } = cellRender(s, c, w); return (
                  <td key={w} className="rounded-lg text-center align-middle" style={{ ...(c ? heatCell(tierScore(tier)) : { background: 'rgba(34,32,28,0.03)' }), height: 42 }}>
                    <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 12.5 }}>{big}</span>
                  </td>); })}
              </tr>); })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Trends — real period-comparison (current vs prior), all metrics ────────
const PC_METRICS: { key: string; label: string; val: (w: any) => number; fmt: (n: number) => string }[] = [
  { key: 'revenue', label: 'Revenue', val: (w) => w.revenue || 0, fmt: usdK },
  { key: 'gpDollars', label: 'GP $', val: (w) => w.gpDollars || 0, fmt: usdK },
  { key: 'gpPct', label: 'GP %', val: (w) => (w.revenue ? (w.gpDollars / w.revenue) * 100 : 0), fmt: (n) => n.toFixed(1) + '%' },
  { key: 'cars', label: 'Cars', val: (w) => w.cars || 0, fmt: (n) => String(Math.round(n)) },
  { key: 'aro', label: 'ARO', val: (w) => (w.cars ? w.revenue / w.cars : 0), fmt: usd0 },
  { key: 'comebacks', label: 'Comebacks $', val: (w) => w.comebacks || 0, fmt: usdK },
  { key: 'hours', label: 'Hours', val: (w) => w.hours || 0, fmt: (n) => Math.round(n) + 'h' },
];
const PC_RANGES = [{ key: 'this_month', label: 'This Month' }, { key: 'this_quarter', label: 'This Quarter' }, { key: 'this_year', label: 'This Year' }];
const PC_COMPARE = [{ key: 'same_period_last_year', label: 'vs Last Year' }, { key: 'previous_period', label: 'vs Previous Period' }];
// Granularity toggle — defaults to weekly so the existing chart behavior is
// unchanged when the user lands on the page. Daily fans out to per-day
// buckets; monthly rolls weeks up into months.
const PC_GRANULARITY = [{ key: 'daily', label: 'Daily' }, { key: 'weekly', label: 'Weekly' }, { key: 'monthly', label: 'Monthly' }];
function TrendsSection() {
  const [data, setData] = useState<any | null>(null);
  const [metric, setMetric] = useState('revenue');
  const [range, setRange] = useState('this_quarter');
  const [compare, setCompare] = useState('same_period_last_year');
  const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  useEffect(() => { let alive = true; setData(null); safe<any>(`/api/period-comparison?range=${range}&compare=${compare}&granularity=${granularity}`).then((d) => { if (alive) setData(d && d.current && d.comparison ? d : null); }); return () => { alive = false; }; }, [range, compare, granularity]);
  const M = PC_METRICS.find((m) => m.key === metric)!;
  const cur = (data?.current?.weeks ?? []).map(M.val) as number[];
  const pri = (data?.comparison?.weeks ?? []).map(M.val) as number[];
  const labels = (data?.current?.weeks ?? []).map((w: any) => w.weekStart);
  const right = (
    <div className="flex items-center gap-2">
      <Dropdown value={range} onChange={setRange} opts={PC_RANGES} />
      <Dropdown value={granularity} onChange={(v) => setGranularity(v as 'daily' | 'weekly' | 'monthly')} opts={PC_GRANULARITY} />
      <Dropdown value={compare} onChange={setCompare} opts={PC_COMPARE} />
      <Dropdown value={metric} onChange={setMetric} opts={PC_METRICS.map((m) => ({ key: m.key, label: m.label }))} />
    </div>
  );
  if (!data) return <Card id="trends" eyebrow="Performance Trends" title="Current vs prior period" right={right}><div className="c2ui text-[13px] py-4" style={{ color: INK2 }}>Loading period comparison…</div></Card>;
  if (!cur.length) return <Card id="trends" eyebrow="Performance Trends" title="Current vs prior period" right={right}><div className="c2ui text-[13px] py-4" style={{ color: INK2 }}>No data for this period.</div></Card>;
  const n = Math.max(cur.length, pri.length);
  const all = [...cur, ...pri].filter((v) => isFinite(v));
  const min = Math.min(...all, 0), max = Math.max(...all, 1);
  const W = 900, H = 210, padX = 10, padT = 12, padB = 8;
  const xAt = (i: number) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (W - padX * 2));
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);
  const pathFor = (vals: number[]) => vals.map((v, i) => (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1)).join(' ');
  const curArea = `${pathFor(cur)} L ${xAt(cur.length - 1).toFixed(1)} ${H} L ${xAt(0).toFixed(1)} ${H} Z`;
  const curTotal = cur.reduce((a, b) => a + b, 0), priTotal = pri.reduce((a, b) => a + b, 0);
  const isRate = metric === 'gpPct' || metric === 'aro';
  const curAgg = isRate ? (cur.length ? curTotal / cur.length : 0) : curTotal;
  const priAgg = isRate ? (pri.length ? priTotal / pri.length : 0) : priTotal;
  const delta = priAgg ? (curAgg - priAgg) / priAgg : 0;
  return (
    <Card id="trends" eyebrow="Performance Trends" title="Current vs prior period" right={right}>
      <div className="w-full overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
          <defs><linearGradient id="c2trend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(63,156,176,0.30)" /><stop offset="60%" stopColor="rgba(95,169,214,0.12)" /><stop offset="100%" stopColor="rgba(139,205,197,0.03)" /></linearGradient></defs>
          {[0, 0.5, 1].map((f) => <line key={f} x1={0} x2={W} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} stroke="rgba(34,32,28,0.06)" strokeWidth={1} />)}
          {pri.length > 0 && <path d={pathFor(pri)} fill="none" stroke="#9AA7AE" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" opacity={0.85} />}
          <path d={curArea} fill="url(#c2trend)" />
          <path d={pathFor(cur)} fill="none" stroke="#3E9CB0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          {cur.map((v, i) => <circle key={i} cx={xAt(i)} cy={yAt(v)} r={i === cur.length - 1 ? 4.5 : 2} fill="#fff" stroke="#3E9CB0" strokeWidth="2" />)}
        </svg>
        <div className="flex justify-between c2ui text-[12.5px] tabular-nums mt-1" style={{ color: FAINT }}>
          {labels.map((l: string, i: number) => (i % Math.ceil(n / 8 || 1) === 0 || i === n - 1) ? <span key={i}>{new Date(l + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</span> : <span key={i} />)}
        </div>
        <div className="c2ui mt-3 text-[13px] flex items-center gap-4" style={{ color: INK2 }}>
          <span className="inline-flex items-center gap-1.5"><span style={{ width: 14, height: 3, background: '#3E9CB0', display: 'inline-block', borderRadius: 2 }} /> current</span>
          <span className="inline-flex items-center gap-1.5"><span style={{ width: 14, height: 0, borderTop: '2px dashed #9AA7AE', display: 'inline-block' }} /> {compare === 'previous_period' ? 'previous period' : 'last year'}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-wide" style={{ color: FAINT }}>{data.current?.label || 'Current Period'} · {M.label}</div>
          <div className="c2disp tabular-nums mt-1" style={{ color: INK, fontSize: 24 }}>{M.fmt(curAgg)}</div>
        </div>
        <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-wide" style={{ color: FAINT }}>{data.comparison?.label || 'Comparison Period'} · {M.label}</div>
          <div className="c2disp tabular-nums mt-1" style={{ color: INK2, fontSize: 24 }}>{M.fmt(priAgg)}</div>
        </div>
        <div className="rounded-2xl px-4 py-3" style={{ background: delta >= 0 ? 'rgba(62,142,94,0.08)' : 'rgba(192,90,46,0.08)', border: `1px solid ${LINE}` }}>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-wide" style={{ color: FAINT }}>Change</div>
          <div className="c2disp tabular-nums mt-1" style={{ color: delta >= 0 ? '#3E8E5E' : '#C05A2E', fontSize: 24 }}>{delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}%</div>
        </div>
      </div>
    </Card>
  );
}

// ── Accounts Receivable — now the shared <ConceptAR/> (see ConceptAR.tsx),
// used identically here and on the Weekly Review. ────────────────────────────

// ── Return Customers — full retention detail (production parity) ───────────
// Status colors come from THE established cool→warm heat gradient (heatRGB):
// low churn = cool (blue/teal), high churn = warm (coral). So "Healthy" reads
// cool, matching every other heat surface on the page.
function churnBand(c: number): { label: string; color: string; bg: string } {
  const band = c < 0.35 ? { label: 'Strong retention', s: 0.95 }
    : c < 0.55 ? { label: 'Healthy', s: 0.72 }
    : c < 0.70 ? { label: 'Watch', s: 0.40 }
    : { label: 'High churn risk', s: 0.10 };
  const [r, g, b] = heatRGB(band.s);
  return { label: band.label, bg: `rgba(${r},${g},${b},0.20)`, color: `rgb(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)})` };
}
const pctR = (v: number) => (v * 100).toFixed(1) + '%';
function ReturnCustomers() {
  const [data, setData] = useState<{ shops: any[]; chain: any } | null>(null);
  useEffect(() => { let alive = true; safe<any>('/api/extras?view=return-customers').then((d) => { if (alive) setData(d?.shops ? { shops: d.shops, chain: d.chain || {} } : null); }); return () => { alive = false; }; }, []);
  const metaFor = (num: string) => META.find((m) => m.num === num);
  return (
    <Card id="return-customers" eyebrow="Return Customers" title="Return Customers — This Week"
      sub="Ranking: this week (Mon → today MT) return % (primary), 12-month return % (tiebreaker). Unique customers, not repair orders.">
      {!data ? <div className="c2ui text-[13px] py-4" style={{ color: INK2 }}>Loading…</div> : (() => {
        const ready = data.shops.filter((s) => !s.pending);
        const pending = data.shops.filter((s) => s.pending);
        const ranked = [...ready].sort((a, b) => { const p = (b.returnWtdPct ?? 0) - (a.returnWtdPct ?? 0); return p !== 0 ? p : (b.return12moPct ?? 0) - (a.return12moPct ?? 0); });
        const c = data.chain || {}; const cb = churnBand(c.churnPct ?? 0);
        const maxRet = Math.max(0.0001, ...ranked.map((s: any) => s.returnWtdPct ?? 0));
        const GRID = '26px 1.3fr 1.8fr 0.8fr 0.8fr 0.8fr 1.15fr';
        const rankTint = (i: number) => ['#C9A227', '#9AA0A6', '#B97A56'][i] || FAINT;
        return (<>
          {/* company summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.6)', border: `1px solid ${LINE}` }}><div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: FAINT }}>12-Month Return</div><div className="c2disp tabular-nums leading-none mt-1.5" style={{ color: INK, fontSize: 30 }}>{pctR(c.return12moPct ?? 0)}</div><div className="c2ui text-[12.5px] mt-1.5" style={{ color: INK2 }}>{(c.returns12mo ?? 0).toLocaleString()} of {(c.total12mo ?? 0).toLocaleString()} customers</div></div>
            <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.6)', border: `1px solid ${LINE}` }}><div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: FAINT }}>Avg Visits / Year</div><div className="c2disp tabular-nums leading-none mt-1.5" style={{ color: INK, fontSize: 30 }}>{(c.avgVisitsPerYearReturning ?? 0).toFixed(2)}</div><div className="c2ui text-[12.5px] mt-1.5" style={{ color: INK2 }}>returning customers only</div></div>
            <div className="rounded-2xl p-4" style={{ background: cb.bg, border: `1px solid ${LINE}` }}><div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: cb.color, opacity: 0.9 }}>Churn Rate</div><div className="c2disp tabular-nums leading-none mt-1.5" style={{ color: cb.color, fontSize: 30 }}>{pctR(c.churnPct ?? 0)}</div><div className="c2ui text-[12.5px] mt-1.5" style={{ color: cb.color, opacity: 0.85 }}>{(c.churned ?? 0).toLocaleString()} of {(c.previouslyActive ?? 0).toLocaleString()} lapsed</div></div>
            <div className="rounded-2xl p-4 flex flex-col justify-center" style={{ background: cb.bg, border: `1px solid ${LINE}` }}><div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: cb.color, opacity: 0.9 }}>Retention Status</div><div className="c2disp leading-tight mt-1.5" style={{ color: cb.color, fontSize: 22 }}>{cb.label}</div></div>
          </div>

          {/* shop leaderboard */}
          <div className="overflow-x-auto">
            <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${LINE}`, minWidth: 720 }}>
              <div className="grid items-center px-4 py-2.5 c2ui text-[12.5px] font-semibold uppercase tracking-[0.12em]" style={{ gridTemplateColumns: GRID, color: FAINT, background: 'rgba(255,255,255,0.5)', borderBottom: `1px solid ${LINE}` }}>
                <div>#</div><div>Shop</div><div>This Week Return</div><div className="text-right">12-mo</div><div className="text-right">Visits/yr</div><div className="text-right">Churn</div><div className="text-right">Status</div>
              </div>
              {ranked.map((s, i) => { const b = churnBand(s.churnPct ?? 0); const meta = metaFor(s.shopNum); const ret = s.returnWtdPct ?? 0; const barW = Math.max(3, (ret / maxRet) * 100); return (
                <div key={s.shopNum} className="grid items-center px-4 py-3" style={{ gridTemplateColumns: GRID, background: i % 2 ? 'rgba(255,255,255,0.32)' : 'transparent', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                  <div className="c2disp" style={{ color: rankTint(i), fontSize: 15, fontWeight: 600 }}>{i + 1}</div>
                  <div className="c2ui font-medium flex items-center gap-2 min-w-0" style={{ color: INK, fontSize: 13 }}><span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: meta?.color || FAINT }} /><span className="truncate">{meta?.name || s.shopName}</span></div>
                  <div className="pr-4">
                    <div className="flex items-baseline gap-2"><span className="c2disp tabular-nums" style={{ color: meta?.color || INK, fontSize: 16 }}>{pctR(ret)}</span><span className="c2ui tabular-nums text-[12.5px]" style={{ color: FAINT }}>{s.returnsWtd ?? 0}/{s.totalWtd ?? 0}</span></div>
                    <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.06)' }}><div className="h-full rounded-full" style={{ width: `${barW}%`, background: `linear-gradient(90deg, ${(meta?.color || AMBER)}77, ${meta?.color || AMBER})` }} /></div>
                  </div>
                  <div className="c2disp tabular-nums text-right" style={{ color: INK, fontSize: 13 }}>{pctR(s.return12moPct ?? 0)}</div>
                  <div className="c2ui tabular-nums text-right" style={{ color: INK2, fontSize: 13 }}>{(s.avgVisitsPerYearReturning ?? 0).toFixed(2)}</div>
                  <div className="c2disp tabular-nums text-right font-semibold" style={{ color: b.color, fontSize: 13 }}>{pctR(s.churnPct ?? 0)}</div>
                  <div className="text-right"><span className="c2ui inline-flex rounded-full px-2 py-0.5 text-[12.5px] font-semibold" style={{ background: b.bg, color: b.color }}>{b.label}</span></div>
                </div>); })}
              {pending.map((s) => { const meta = metaFor(s.shopNum); return (
                <div key={s.shopNum} className="grid items-center px-4 py-3" style={{ gridTemplateColumns: GRID, opacity: 0.5, borderTop: `1px solid ${LINE}` }}>
                  <div />
                  <div className="c2ui font-medium flex items-center gap-2" style={{ color: INK2, fontSize: 13 }}><span className="inline-block w-2 h-2 rounded-full" style={{ background: meta?.color || FAINT }} />{meta?.name || s.shopName}</div>
                  <div className="c2ui italic text-[13px]" style={{ color: FAINT }}>warming up…</div>
                  <div /><div /><div /><div />
                </div>); })}
            </div>
          </div>

          {/* methodology footnote (lighter than the old header block) */}
          <div className="c2ui text-[12.5px] mt-4 leading-relaxed" style={{ color: FAINT }}>
            <span style={{ color: INK2, fontWeight: 600 }}>How these are calculated:</span> 12-month return % = unique customers with ≥2 posted ROs in the last 12 months ÷ those with ≥1. Avg visits/year = mean visits among customers with ≥2 in 12 months. Churn % = customers active 12–18 months ago who didn't return in the last 12 ÷ those previously active. Ranked by this-week (Mon→today MT) return %, then 12-month return %.
          </div>
        </>);
      })()}
    </Card>
  );
}

// ── Shell + header (with timeframe selector) ───────────────────────────────
const DIAG_SECTIONS = [
  { id: 'projection', label: 'Revenue Projection' },
  { id: 'gp-projection', label: 'GP Projection' },
  { id: 'opportunity', label: 'Where GP$ Leaks' },
  { id: 'comparison', label: 'Shop Comparison' },
  { id: 'performance', label: 'Shop Performance' },
  { id: 'trends', label: 'Performance Trends' },
  { id: 'receivables', label: 'Accounts Receivable' },
  { id: 'return-customers', label: 'Return Customers' },
  { id: 'trophies-ytd', label: 'Past Trophies' },
];
function Shell({ range, setRange, children }: { range: string; setRange: (v: string) => void; children: React.ReactNode }) {
  return (
    <ConceptShell active="diagnostic" title="Diagnostic" sub="Operational analytics · multi-state portfolio · live data" sections={DIAG_SECTIONS}
      headerRight={<Dropdown value={range} onChange={setRange} opts={RANGES.map((r) => ({ key: r.key, label: r.label }))} />}>
      {children}
    </ConceptShell>
  );
}
function LoadingSkeleton() {
  return (<div className="space-y-4">{[0, 1, 2, 3].map((i) => <div key={i} className="rounded-[26px]" style={{ height: i === 0 ? 220 : 160, background: 'rgba(255,255,255,0.5)', border: `1px solid ${LINE}` }} />)}</div>);
}
