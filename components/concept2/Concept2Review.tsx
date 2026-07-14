'use client';

// CONCEPT 2 -- Weekly Review (corporate finance review) in the bespoke luxury
// design. Same data + same finance logic as the production FinanceView (last
// week + MTD vs goal, GP$ goal proration, per-shop review, diagnostic callouts,
// live A/R, waterfall, expenses) -- only the presentation is the editorial
// concept-2 system. Endpoints, goals, proration and severity rules are
// reproduced verbatim so nothing is dropped.

import { useEffect, useMemo, useState } from 'react';
import { customRange } from '@/lib/dates';
import { loadGoals, revenueGoalForRange, prorateRevenueGoal, isWorkingDay, workingDaysBetween, DEFAULT_GOALS } from '@/lib/goals';
import { SHOPS, SHOP_BY_NUM, ShopNum } from '@/lib/shops';
import type { ChainKpi, ShopKpi } from '@/lib/metrics';
import { startOfWeek, endOfWeek, addDays } from 'date-fns';
import {
  Card, MiniStat, Pill, INK, INK2, FAINT, LINE, AMBER, GOOD, WARN, BAD, COOL,
  usd, usdK, safe, heatRGB, norm,
} from './kit';
import ConceptAR from './ConceptAR';

// ── benchmarks (mirror FinanceView) ────────────────────────────────────────
const GP_TARGET = 0.58, PARTS_GP_TARGET = 0.55, LABOR_GP_TARGET = 0.65;
const ARO_TARGET = 750, CR_TARGET = 0.40, CALL_CONV_TARGET = 0.60, WEEKS_PER_YEAR = 52;
const num = (n: number) => Math.round(n || 0).toLocaleString('en-US');
const pct = (v: number) => (v * 100).toFixed(1) + '%';

// ── severity ────────────────────────────────────────────────────────────────
type Sev = 'ok' | 'watch' | 'problem' | 'critical';
function paceSev(p: number | null): Sev { if (p === null) return 'watch'; if (p >= 1.0) return 'ok'; if (p >= 0.95) return 'watch'; if (p >= 0.8) return 'problem'; return 'critical'; }
function gpSev(gp: number, t: number): Sev { const g = (t - gp) / t; if (g <= 0) return 'ok'; if (g < 0.04) return 'watch'; if (g < 0.1) return 'problem'; return 'critical'; }
function arSev(o: number): Sev { if (o < 1000) return 'ok'; if (o < 10000) return 'watch'; if (o < 25000) return 'problem'; return 'critical'; }
const SEV_LABEL: Record<Sev, string> = { ok: 'Healthy', watch: 'Watch', problem: 'Problem', critical: 'Critical' };
const sevTone = (s: Sev): 'good' | 'warn' | 'bad' => (s === 'ok' ? 'good' : s === 'watch' ? 'warn' : 'bad');
const sevColor = (s: Sev) => (s === 'ok' ? GOOD : s === 'watch' ? WARN : s === 'critical' ? '#A33523' : BAD);
const sevFill = (s: Sev) => { const c = sevColor(s); return `linear-gradient(90deg, ${c}55, ${c}aa)`; };

// Returns a human-readable holiday name for a non-working weekday (null if unknown).
function holidayName(d: Date): string | null {
  const m = d.getMonth(), day = d.getDate(), dow = d.getDay();
  if (m === 0 && (day === 1 || (day === 2 && dow === 1) || (day === 31 && dow === 5))) return "New Year's Day";
  if (m === 4 && dow === 1 && day >= 25) return 'Memorial Day';
  if (m === 6 && day >= 3 && day <= 5) return 'Independence Day';
  if (m === 8 && dow === 1 && day <= 7) return 'Labor Day';
  if (m === 10 && dow === 4 && day >= 22 && day <= 28) return 'Thanksgiving';
  if (m === 10 && dow === 5 && day >= 23 && day <= 29) return 'Day after Thanksgiving';
  if (m === 11 && day >= 23 && day <= 26) return 'Christmas';
  return null;
}

// ── heat gradient for bar fills (matches diagnostic heatmap + projection) ──
// All progress bars on this page render on the continuous blue->teal->yellow->
// orange->coral spectrum instead of binary green/red. Score 0 = coral (way
// behind), 0.5 = yellow (mid), 1.0 = cool blue (on/above goal). Calibration:
// 80% of goal -> score 0 (coral); 105% of goal -> score 1 (cool). Below 80% all
// reads coral; above 105% all reads cool. Matches the existing convention used
// across the Employee leaderboard and the diagnostic heatmap.
const heatScoreFromPct = (pctOfGoal: number) => norm(pctOfGoal, 0.8, 1.05);
const heatScoreFromGpPct = (gp: number) => norm(gp, 0.5, 0.6); // matches Employee leaderboard
const heatColor = (score: number) => { const [r, g, b] = heatRGB(score); return `rgb(${r},${g},${b})`; };
const heatFill = (score: number) => { const [r, g, b] = heatRGB(score); return `linear-gradient(90deg, rgba(${r},${g},${b},0.55), rgba(${r},${g},${b},0.95))`; };
const heatCell = (score: number): React.CSSProperties => { const [r, g, b] = heatRGB(score); return { background: `radial-gradient(135% 160% at 28% -10%, rgba(${r},${g},${b},0.50), rgba(${r},${g},${b},0.16) 70%, rgba(${r},${g},${b},0.08))`, boxShadow: `inset 0 0 0 1px rgba(${r},${g},${b},0.28)` }; };

// ── GP$ diagnostic tree (exact copy of Diagnostic's buildGpTree) ─────────────
const pf = (v: number) => (v * 100).toFixed(0) + '%';
const pn = (v: number | null) => (v == null ? '--' : v.toFixed(0) + '%');
const leakScore = (gp$: number, gap: number) => (gp$ <= 0 ? 0.85 : Math.max(0.05, 1 - Math.min(1, (gap > 0 ? gp$ / gap : 0) / 0.6)));
interface BenchLevels { revenue: number; cars: number; aro: number; closeRate: number; gpPct: number; conversion: number | null; rebook: number | null }
interface ShopBenchmark { shopNum: string; goalWeeks: number; sampleWeeks: number; method: 'goal-met' | 'best-weeks'; benchmark: BenchLevels; recent: BenchLevels }
type LeafKey = 'cars' | 'aro' | 'gpPct';
interface GpBranch { label: string; detail: string; active: boolean }
interface GpLeaf { key: LeafKey; label: string; gp$: number; metricCur: string; metricGoal: string; branches: GpBranch[]; primaryCause: string; primaryFix: string; note?: string }
interface GpTree {
  num: string; name: string; district: string; color: string; ramping: boolean;
  hasGoal: boolean; onTrack: boolean;
  gp$Proj: number; gp$Goal: number; gap: number;
  revGp$: number; gpPctGp$: number;
  revProj: number; revGoal: number; gpPctProj: number; gpPctGoal: number;
  carsGp$: number; aroGp$: number;
  carsProj: number; carsGoal: number; aroProj: number; aroGoal: number;
  leaves: GpLeaf[]; primary: GpLeaf | null;
  method: 'goal-met' | 'best-weeks'; goalWeeks: number; sampleWeeks: number;
}
interface ProjShopForTree { num: string; name: string; district: string; color: string; expected: number; goal: number | null; cars: number; aro: number; gpPct: number; ramping?: boolean }
function buildGpTree(p: ProjShopForTree, b: ShopBenchmark | undefined, cur?: { closeRate?: number; conversion?: number | null; rebook?: number | null; partsGp?: number | null; laborGp?: number | null }): GpTree {
  const revProj = p.expected, revGoal = p.goal ?? 0;
  const gpPctProj = (p.gpPct ?? 0) / 100, gpPctGoal = DEFAULT_GOALS[p.num as ShopNum]?.gpPct ?? 0.58;
  const carsProj = p.cars, aroProj = p.aro;
  const gp$Proj = revProj * gpPctProj, gp$Goal = revGoal * gpPctGoal;
  const gap = gp$Goal - gp$Proj, hasGoal = revGoal > 0;
  const onTrack = !hasGoal || gap <= gp$Goal * 0.005;
  const aroGoal = b && b.benchmark.aro > 0 ? b.benchmark.aro : aroProj;
  const carsGoal = aroGoal > 0 ? revGoal / aroGoal : carsProj;
  const revGapRev = revGoal - revProj;
  const carsGp$ = gpPctProj * aroProj * (carsGoal - carsProj);
  const aroGp$ = gpPctProj * carsGoal * (aroGoal - aroProj);
  const revGp$ = gpPctProj * revGapRev;
  const gpPctGp$ = revGoal * (gpPctGoal - gpPctProj);
  const convCur = cur?.conversion ?? b?.recent.conversion ?? null, convGoal = b?.benchmark.conversion ?? null;
  const closeCur = cur?.closeRate ?? b?.recent.closeRate ?? 0, closeGoal = b?.benchmark.closeRate ?? 0;
  const partsGp = cur?.partsGp ?? null, laborGp = cur?.laborGp ?? null;
  const convAvail = convGoal != null && convCur != null && convGoal > 0;
  const convBelow = convAvail && (convCur as number) < (convGoal as number) * 0.98;
  const carsBranches: GpBranch[] = [
    { label: 'Call volume', detail: !convAvail ? 'inbound calls / leads -- marketing & phone coverage' : convBelow ? 'conversion is the constraint here, not lead volume' : `conversion already at goal (${pn(convGoal)}) -- the gap is inbound calls & leads: marketing & phone coverage`, active: convAvail ? !convBelow : false },
    { label: 'Call conversion', detail: !convAvail ? 'booking rate of the calls you get (no history yet)' : convBelow ? `${pn(convCur)} → ${pn(convGoal)} -- book more of the calls you already get` : `${pn(convCur)} -- already at the goal-week level`, active: convBelow },
  ];
  const carsPrimaryCause = !convAvail ? 'Calls & conversion' : convBelow ? 'Call conversion' : 'Call volume';
  const carsPrimaryFix = !convAvail ? 'check inbound call volume and booking rate' : convBelow ? `lift conversion ${pn(convCur)} → ${pn(convGoal)}` : 'grow inbound call & lead volume (marketing, phone coverage)';
  const aroBranches: GpBranch[] = [
    { label: 'Close rate', detail: `${pf(closeCur)} → ${pf(closeGoal)} -- presentation, financing, declined-work follow-up`, active: true },
    { label: 'Ticket size (AWRO)', detail: 'recommend more work per car -- thorough inspections', active: false },
  ];
  let partsActive = false, laborActive = false;
  if (partsGp != null && laborGp != null) { if (partsGp <= laborGp) partsActive = true; else laborActive = true; }
  else if (partsGp != null) partsActive = true;
  else if (laborGp != null) laborActive = true;
  const gpBranches: GpBranch[] = [
    { label: 'Parts GP%', detail: `${partsGp != null ? pf(partsGp) : '--'} (margin on parts sales) -- big jobs at low GP%, or parts not run through the pricing matrix`, active: partsActive },
    { label: 'Labor GP%', detail: `${laborGp != null ? pf(laborGp) : '--'} (margin on labor sales) -- comebacks eating hours, or labor discounted on the ticket`, active: laborActive },
  ];
  const gpPrimaryCause = partsActive ? 'Parts GP%' : laborActive ? 'Labor GP%' : 'Parts & labor margin';
  const gpPrimaryFix = partsActive ? 'lift parts GP% -- pricing matrix + check big low-GP jobs' : laborActive ? 'lift labor GP% -- cut comebacks + stop discounting labor' : 'check parts & labor margin';
  const leaves: GpLeaf[] = ([
    { key: 'cars' as LeafKey, label: 'Car count', gp$: carsGp$, metricCur: Math.round(carsProj) + ' cars', metricGoal: Math.round(carsGoal) + ' cars', branches: carsBranches, primaryCause: carsPrimaryCause, primaryFix: carsPrimaryFix },
    { key: 'aro' as LeafKey, label: 'ARO', gp$: aroGp$, metricCur: usd(aroProj), metricGoal: usd(aroGoal), branches: aroBranches, primaryCause: 'Close rate', primaryFix: `raise close rate ${pf(closeCur)} → ${pf(closeGoal)}` },
    { key: 'gpPct' as LeafKey, label: 'GP %', gp$: gpPctGp$, metricCur: pf(gpPctProj), metricGoal: pf(gpPctGoal), branches: gpBranches, primaryCause: gpPrimaryCause, primaryFix: gpPrimaryFix, note: 'blended GP% runs higher than each component because fees & shop supplies carry near-100% margin' },
  ] as GpLeaf[]).sort((a, c) => c.gp$ - a.gp$);
  const primary = leaves[0] && leaves[0].gp$ > 0 ? leaves[0] : null;
  return {
    num: p.num, name: p.name, district: p.district, color: p.color, ramping: !!p.ramping,
    hasGoal, onTrack, gp$Proj, gp$Goal, gap,
    revGp$, gpPctGp$, revProj, revGoal, gpPctProj, gpPctGoal,
    carsGp$, aroGp$, carsProj, carsGoal, aroProj, aroGoal,
    leaves, primary,
    method: b?.method ?? 'best-weeks', goalWeeks: b?.goalWeeks ?? 0, sampleWeeks: b?.sampleWeeks ?? 0,
  };
}

// ── data shapes ──────────────────────────────────────────────────────────────
interface ARCustomer { customerId: number; customerName: string; shopNum: string; shopName: string; roNumber: number; invoiceDate: string; daysOverdue: number; balance: number; totalOwedByCustomer: number }
interface ARPayload { summary: { total: number; count: number; byShop: { shopNum: string; shopName: string; amount: number; count: number }[] }; customers: ARCustomer[] }
interface DriftBreakdown { labor: number; parts: number; sublet: number; fee: number; discount: number }
interface DriftLogEntry {
  id: string; roId: number; roNumber: number; shopNum: string; shopName: string;
  shopTekmetricId: number; weekStart: string; detectedAt: string;
  revenueBefore: number; revenueAfter: number; delta: number;
  statusBefore: string; statusAfter: string; updatedAt?: string; snapshotBased: boolean;
  breakdownBefore?: DriftBreakdown; breakdownAfter?: DriftBreakdown;
  status: 'pending' | 'approved' | 'rejected'; notes: string; reviewedAt?: string; reviewedBy?: string;
}
type ShopARState = { kind: 'loading' } | { kind: 'no-data' } | { kind: 'loaded'; total: number; over30: number; customers: ARCustomer[] };
interface ShopRow {
  shopNum: string; shopName: string; bays: number;
  lwActual: number; lwTarget: number; lwVar: number; lwPct: number | null; lwSev: Sev;
  mtdActual: number; mtdTarget: number; mtdFullMonth: number; mtdVar: number; mtdPct: number | null; mtdSev: Sev;
  mtdFullPct: number; mtdExpectedPct: number;
  gpPct: number; gpSev_: Sev; partsGpPct: number; laborGpPct: number;
  lwGpActual: number; lwGpGoal: number; mtdGpActual: number; mtdGpGoal: number; fullMonthGpGoal: number;
  approvedSales: number; aro: number; carCount: number; revPerBayPerWeek: number; revPerBayPerYear: number;
  ar: ShopARState;
}

// ── frosted panel style (matches kit Card surface) ──────────────────────────
const FROST: React.CSSProperties = { background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.58))', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '1px solid rgba(255,255,255,0.75)', boxShadow: '0 1px 0 rgba(255,255,255,0.9) inset, 0 18px 48px -28px rgba(40,34,26,0.30), 0 2px 8px -4px rgba(40,34,26,0.10)' };
const INSET: React.CSSProperties = { background: 'rgba(255,255,255,0.88)', border: `1px solid rgba(255,255,255,0.75)` };

// ── localStorage snapshot cache ─────────────────────────────────────────────
// Re-opening the Weekly Review showed an empty skeleton for ~2–6s every time
// because every fetch starts from null state. We now persist the last
// successful payload per window into localStorage and hydrate from it on
// mount -- the user sees the last-seen data instantly while a fresh fetch
// runs in the background. Stale data is auto-replaced as soon as the new
// fetch lands. 24h TTL bounds the staleness.
const SNAP_NS = 'c2review_snap_v1';
const SNAP_TTL_MS = 24 * 60 * 60 * 1000;
function snapKey(name: string, scope: string) { return `${SNAP_NS}:${name}:${scope}`; }
function snapRead<T>(name: string, scope: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(snapKey(name, scope));
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (!t || Date.now() - t > SNAP_TTL_MS) return null;
    return v as T;
  } catch { return null; }
}
function snapWrite<T>(name: string, scope: string, v: T) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(snapKey(name, scope), JSON.stringify({ t: Date.now(), v })); } catch { /* quota */ }
}

// Returns the Monday ISO string for the latest completed work week.
// Holiday-aware: a Thursday after 6 PM whose Friday is a holiday counts as
// the week being closed, so THIS Monday is the anchor (not last Monday).
function lastCompletedMonday(): string {
  const now = new Date();
  const dow = now.getDay();
  const hr = now.getHours();
  // Use local midnight so isWorkingDay()'s toISOString() check produces the
  // correct LOCAL date — addDays() at 7 PM MT gives 1 AM UTC (next day UTC).
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowIsHolidayWeekday = tomorrow.getDay() >= 1 && tomorrow.getDay() <= 5 && !isWorkingDay(tomorrow);
  const workWeekClosed =
    (dow === 5 && hr >= 18) ||
    dow === 6 ||
    dow === 0 ||
    (dow >= 1 && dow <= 4 && hr >= 18 && tomorrowIsHolidayWeekday);
  const thisMon = startOfWeek(now, { weekStartsOn: 1 });
  return (workWeekClosed ? thisMon : addDays(thisMon, -7)).toISOString().slice(0, 10);
}

export default function Concept2Review() {
  const [lwKpi, setLwKpi] = useState<ChainKpi | null>(null);
  const [mtdKpi, setMtdKpi] = useState<ChainKpi | null>(null);
  const [ar, setAr] = useState<ARPayload | null>(null);
  const [arError, setArError] = useState<string | null>(null);
  const [calls, setCalls] = useState<{ chain: { bookedRatePct: number; eligible: number } } | null>(null);
  const [driftLog, setDriftLog] = useState<DriftLogEntry[]>([]);
  const [driftTab, setDriftTab] = useState<'review' | 'approved'>('review');
  const [driftLoading, setDriftLoading] = useState(true);
  const [driftRefreshing, setDriftRefreshing] = useState(false);
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [gpBench, setGpBench] = useState<Record<string, any>>({});
  const [partsGpDiag, setPartsGpDiag] = useState<{
    weekStart: string;
    summary: { actualGpPct: number; totalDragDollars: number; top5ConcentrationPct: number; likelyCause: 'canned-jobs' | 'mixed' | 'manual-overrides'; uniqueJobNames: number };
    topOffenders: Array<{ jobName: string; roCount: number; partsSoldDollars: number; actualGpPct: number; dragDollars: number }>;
  } | null>(null);

  // ── Week rollback: the Review can step back to any prior completed week.
  // Default = last completed Monday. weekStart drives every fetch + the MTD
  // anchor, so reviewing Feb's third week shows that week's actuals against
  // its prorated MTD goal -- same logic as the production "frozen Monday" view,
  // just with an adjustable cursor.
  const [weekStart, setWeekStart] = useState<string>(lastCompletedMonday);
  // Auto-advance when the work week closes (e.g. at 6 PM on the last working
  // day). Without this, a page opened before 6 PM stays on the prior week.
  useEffect(() => {
    const id = setInterval(() => {
      setWeekStart(prev => {
        const latest = lastCompletedMonday();
        return prev < latest ? latest : prev;
      });
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const weekEnd = useMemo(() => {
    const [y, m, d] = weekStart.split('-').map(Number);
    const e = new Date(y, m - 1, d); e.setDate(e.getDate() + 4); // Mon→Fri work week
    return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
  }, [weekStart]);
  const lwWin = useMemo(() => customRange(weekStart, weekEnd), [weekStart, weekEnd]);
  const lwWorkingDays = useMemo(() => workingDaysBetween(lwWin.start, lwWin.end), [lwWin]);
  const lwHolidayNote = useMemo(() => {
    if (lwWorkingDays >= 5) return null;
    const names: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = addDays(lwWin.start, i);
      if (!isWorkingDay(d)) { const n = holidayName(d); if (n && !names.includes(n)) names.push(n); }
    }
    return names.length > 0 ? names.join(' & ') : null;
  }, [lwWorkingDays, lwWin]);
  const lwEndDate = useMemo(() => { const [y, m, d] = weekEnd.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59); }, [weekEnd]);
  const mtdStartStr = useMemo(() => `${weekEnd.slice(0, 7)}-01`, [weekEnd]);
  const mtdEndStr = weekEnd;
  // navigation guards
  const atLatest = weekStart === lastCompletedMonday();
  const stepWeek = (delta: number) => {
    const [y, m, d] = weekStart.split('-').map(Number);
    const next = new Date(y, m - 1, d); next.setDate(next.getDate() + 7 * delta);
    const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    if (delta > 0 && iso > lastCompletedMonday()) return; // can't go beyond last completed
    setWeekStart(iso);
  };

  // Window-scoped snapshot hydration: when the week changes, IMMEDIATELY swap
  // in whatever we saw for THIS window last time (if anything) so the user
  // sees data instead of an empty skeleton. Then fetch fresh in the
  // background and overwrite when the new payload lands. Stale data shown
  // for ~0.5–3s is far better than skeleton-for-3s.
  useEffect(() => {
    const lwScope = `${weekStart}_${weekEnd}`;
    const mtdScope = `${mtdStartStr}_${mtdEndStr}`;
    const cachedLw = snapRead<ChainKpi>('lwKpi', lwScope);
    const cachedMtd = snapRead<ChainKpi>('mtdKpi', mtdScope);
    if (cachedLw) setLwKpi(cachedLw); else setLwKpi(null);
    if (cachedMtd) setMtdKpi(cachedMtd); else setMtdKpi(null);
    safe<any>(`/api/metrics?range=custom&start=${weekStart}&end=${weekEnd}`).then((d) => {
      const k = d?.kpi ?? null;
      setLwKpi(k);
      if (k) snapWrite('lwKpi', lwScope, k);
    });
    safe<any>(`/api/metrics?range=custom&start=${mtdStartStr}&end=${mtdEndStr}`).then((d) => {
      const k = d?.kpi ?? null;
      setMtdKpi(k);
      if (k) snapWrite('mtdKpi', mtdScope, k);
    });
    setPartsGpDiag(null);
    safe<any>(`/api/extras?view=parts-gp-diagnosis&weekStart=${weekStart}`).then((d) => {
      if (d?.summary) setPartsGpDiag(d);
    });
  }, [weekStart, weekEnd, mtdStartStr, mtdEndStr]);
  // Drift log — load once on mount (persists across week navigation).
  useEffect(() => {
    safe<{ entries: DriftLogEntry[] }>('/api/drift-log').then(d => {
      if (d?.entries) setDriftLog(d.entries);
      setDriftLoading(false);
    });
  }, []);

  const refreshDrift = async () => {
    setDriftRefreshing(true);
    try {
      const res = await fetch('/api/drift-log', { method: 'POST' });
      const d = await res.json();
      if (d?.entries) setDriftLog(d.entries);
    } finally {
      setDriftRefreshing(false);
    }
  };

  // GP benchmarks (goal-meeting week ARO/close/conversion rates) -- once on mount.
  // Used to correctly decompose the GP$ gap into cars vs ARO vs GP% per shop.
  useEffect(() => {
    safe<any>('/api/exec-metrics?view=goal-benchmarks').then((d) => {
      const m: Record<string, any> = {};
      for (const sb of d?.shops ?? []) m[sb.shopNum] = sb;
      setGpBench(m);
    });
  }, []);

  // A/R + calls are range-independent (live / chain-level) -- fetch once.
  // Hydrate from the same snapshot store so the A/R panel doesn't show
  // "Loading A/R…" on every re-open.
  useEffect(() => {
    const cachedAr = snapRead<ARPayload>('ar', 'chain');
    if (cachedAr) setAr(cachedAr);
    const cachedCalls = snapRead<{ chain: { bookedRatePct: number; eligible: number } }>('calls', 'chain');
    if (cachedCalls) setCalls(cachedCalls);
    safe<any>('/api/exec-metrics?view=ar&mode=total').then((d) => {
      if (d?.summary) { setAr(d); snapWrite('ar', 'chain', d); }
      else setArError(d?.error || 'A/R endpoint returned no summary');
    });
    safe<any>('/api/extras?view=booked-rate&strict=1').then((d) => {
      if (d) { setCalls(d); snapWrite('calls', 'chain', d); }
    });
  }, []);

  const goals = useMemo(() => loadGoals(), []);

  const arByShop = useMemo<Record<string, ShopARState>>(() => {
    const out: Record<string, ShopARState> = {};
    for (const s of SHOPS) out[s.num] = { kind: 'loading' };
    if (ar !== null) {
      for (const s of SHOPS) out[s.num] = { kind: 'no-data' };
      for (const sum of (ar.summary?.byShop ?? [])) if (out[sum.shopNum]) out[sum.shopNum] = { kind: 'loaded', total: sum.amount, over30: 0, customers: [] };
      for (const c of (ar.customers ?? [])) { const st = out[c.shopNum]; if (st?.kind === 'loaded' && c.daysOverdue >= 30) { st.over30 += c.balance; st.customers.push(c); } }
      for (const k of Object.keys(out)) { const s = out[k]; if (s.kind === 'loaded') s.customers.sort((a, b) => b.balance - a.balance); }
    }
    return out;
  }, [ar]);

  const shopRows = useMemo<ShopRow[]>(() => {
    if (!lwKpi || !mtdKpi) return [];
    const lwBy: Record<string, ShopKpi> = {}; const mtdBy: Record<string, ShopKpi> = {};
    for (const s of lwKpi.byShop) lwBy[s.shopNum] = s;
    for (const s of mtdKpi.byShop) mtdBy[s.shopNum] = s;
    return SHOPS.map((shop): ShopRow => {
      const lw = lwBy[shop.num]; const mtd = mtdBy[shop.num];
      const fullWeekGoal = revenueGoalForRange(goals[shop.num as ShopNum], 'last_week') || 0;
      const lwTarget = fullWeekGoal ? fullWeekGoal * (lwWorkingDays / 5) : 0;
      const fullMonthGoal = revenueGoalForRange(goals[shop.num as ShopNum], 'this_month') || 0;
      const mtdTarget = fullMonthGoal ? prorateRevenueGoal(fullMonthGoal, 'this_month', lwEndDate, lwEndDate, lwEndDate) : 0;
      const lwActual = lw?.revenue ?? 0; const mtdActual = mtd?.revenue ?? 0;
      const lwPct = lwTarget > 0 ? lwActual / lwTarget : null;
      const mtdPct = mtdTarget > 0 ? mtdActual / mtdTarget : null;
      const mtdFullPct = fullMonthGoal > 0 ? mtdActual / fullMonthGoal : 0;
      const mtdExpectedPct = fullMonthGoal > 0 ? mtdTarget / fullMonthGoal : 0;
      const lwGpGoal = lwTarget * GP_TARGET; const mtdGpGoal = mtdTarget * GP_TARGET; const fullMonthGpGoal = fullMonthGoal * GP_TARGET;
      const gpPctVal = lw?.gpPct ?? 0; const revPerBay = lwActual / Math.max(shop.bays, 1);
      return {
        shopNum: shop.num, shopName: shop.name, bays: shop.bays,
        lwActual, lwTarget, lwVar: lwActual - lwTarget, lwPct, lwSev: paceSev(lwPct),
        mtdActual, mtdTarget, mtdFullMonth: fullMonthGoal, mtdVar: mtdActual - mtdTarget, mtdPct, mtdSev: paceSev(mtdPct),
        mtdFullPct, mtdExpectedPct,
        gpPct: gpPctVal, gpSev_: gpSev(gpPctVal, GP_TARGET), partsGpPct: lw?.partsGpPct ?? 0, laborGpPct: lw?.laborGpPct ?? 0,
        lwGpActual: lw?.gpDollars ?? 0, lwGpGoal, mtdGpActual: mtd?.gpDollars ?? 0, mtdGpGoal, fullMonthGpGoal,
        approvedSales: lw?.approvedDollars ?? 0, aro: lw?.aro ?? 0, carCount: lw?.cars ?? 0,
        revPerBayPerWeek: revPerBay, revPerBayPerYear: revPerBay * WEEKS_PER_YEAR,
        ar: arByShop[shop.num] ?? { kind: 'loading' },
      };
    });
  }, [lwKpi, mtdKpi, arByShop, goals, lwWorkingDays]);

  // GP$ diagnostic trees for the currently displayed week -- full GpTree objects,
  // same shape and logic as Concept2Diagnostic so the expandable tree is identical.
  const gpTrees = useMemo<Record<string, GpTree>>(() => {
    if (!lwKpi) return {};
    const byShop: Record<string, any> = {};
    for (const s of lwKpi.byShop) byShop[s.shopNum] = s;
    const out: Record<string, GpTree> = {};
    for (const shop of SHOPS) {
      const lw = byShop[shop.num];
      if (!lw) continue;
      const weekly = revenueGoalForRange(goals[shop.num as ShopNum], 'last_week') || 0;
      const revGoal = weekly ? weekly * (lwWorkingDays / 5) : 0;
      const p: ProjShopForTree = {
        num: shop.num, name: shop.name, district: shop.district, color: shop.color,
        expected: lw.revenue ?? 0,
        goal: revGoal || null,
        cars: lw.cars ?? 0,
        aro: lw.aro ?? 0,
        gpPct: (lw.gpPct ?? 0) * 100,  // buildGpTree expects 0-100
      };
      const cur = {
        closeRate: lw.closeRate ?? undefined,
        partsGp: lw.partsGpPct ?? null,
        laborGp: lw.laborGpPct ?? null,
        conversion: null as null,
      };
      out[shop.num] = buildGpTree(p, gpBench[shop.num] as ShopBenchmark | undefined, cur);
    }
    return out;
  }, [lwKpi, goals, gpBench, lwWorkingDays]);

  const summary = useMemo(() => {
    if (!lwKpi || !mtdKpi) return null;
    let lwGoal = 0, mtdGoalFull = 0;
    for (const s of SHOPS) {
      const w = revenueGoalForRange(goals[s.num], 'last_week') || 0; if (w) lwGoal += w * (lwWorkingDays / 5);
      const m = revenueGoalForRange(goals[s.num], 'this_month') || 0; if (m) mtdGoalFull += m;
    }
    const mtdGoal = mtdGoalFull ? prorateRevenueGoal(mtdGoalFull, 'this_month', lwEndDate, lwEndDate, lwEndDate) : 0;
    const lwRev = lwKpi.totalRevenue; const mtdRev = mtdKpi.totalRevenue;
    const totalGpD = lwKpi.byShop.reduce((s, k) => s + (k.gpDollars || 0), 0);
    const totalGpP = lwRev ? totalGpD / lwRev : 0;
    const partsGpP = lwRev ? lwKpi.byShop.reduce((s, k) => s + (k.partsGpPct || 0) * (k.revenue || 0), 0) / lwRev : 0;
    const mtdGpDollars = mtdKpi.byShop.reduce((s, k) => s + (k.gpDollars || 0), 0);
    const arTotal = ar?.summary?.total ?? 0;
    const arOver30 = ar?.customers?.filter((c) => c.daysOverdue >= 30).reduce((s, c) => s + c.balance, 0) ?? 0;
    return {
      lwRev, lwGoal, lwVar: lwRev - lwGoal, mtdRev, mtdGoal, mtdVar: mtdRev - mtdGoal,
      totalGpD, totalGpP, partsGpP, mtdGpDollars,
      lwGpGoal: lwGoal * GP_TARGET, mtdGpGoal: mtdGoal * GP_TARGET, mtdFullMonthGpGoal: mtdGoalFull * GP_TARGET,
      arTotal, arOver30,
    };
  }, [lwKpi, mtdKpi, ar, goals, lwWorkingDays]);

  const diagnostic = useMemo(() => {
    if (!lwKpi || !summary) return null;
    const lwRev = summary.lwRev;
    const laborGpPct = lwRev ? lwKpi.byShop.reduce((s, k) => s + (k.laborGpPct || 0) * (k.revenue || 0), 0) / lwRev : 0;
    return { partsGpPct: summary.partsGpP, laborGpPct, cr: lwKpi.closeRate, aro: lwKpi.averageAro, chainConv: calls?.chain?.bookedRatePct ?? null };
  }, [lwKpi, summary, calls]);

  function shortActor(email: string) { const at = email.indexOf('@'); return at > 0 ? email.slice(0, at) : email; }

  async function handleDriftUpdate(id: string, patch: { status?: DriftLogEntry['status']; notes?: string }) {
    // Optimistic update
    setDriftLog(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    try {
      const res = await fetch('/api/drift-log/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setDriftLog(prev => prev.map(e => e.id === id ? data.entry : e));
    } catch {
      // Revert optimistic update on failure by re-fetching
      safe<{ entries: DriftLogEntry[] }>('/api/drift-log').then(d => {
        if (d?.entries) setDriftLog(d.entries);
      });
    }
  }

  const fmtYmd = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const snapLabel = useMemo(() => `${fmtYmd(weekStart)} – ${fmtYmd(weekEnd)}, ${weekEnd.slice(0, 4)}`, [weekStart, weekEnd]);
  const mtdRangeLabel = useMemo(() => `${fmtYmd(mtdStartStr)} – ${fmtYmd(mtdEndStr)}`, [mtdStartStr, mtdEndStr]);

  if (!lwKpi || !mtdKpi || !summary) {
    return <div className="space-y-4">{[0, 1, 2, 3].map((i) => <div key={i} className="rounded-[26px]" style={{ height: i === 0 ? 180 : 150, background: 'rgba(255,255,255,0.5)', border: `1px solid ${LINE}` }} />)}</div>;
  }

  const tiles = [
    { label: 'Last Week Revenue', sev: paceSev(summary.lwGoal > 0 ? summary.lwRev / summary.lwGoal : null), value: usd(summary.lwRev), target: `${((summary.lwRev / Math.max(summary.lwGoal, 1)) * 100).toFixed(0)}% of ${usdK(summary.lwGoal)}`, variance: summary.lwVar >= 0 ? `+${usdK(summary.lwVar)}` : `${usdK(summary.lwVar)}`, vTone: summary.lwVar >= 0 },
    { label: 'MTD Revenue', sev: paceSev(summary.mtdGoal > 0 ? summary.mtdRev / summary.mtdGoal : null), value: usd(summary.mtdRev), target: `${((summary.mtdRev / Math.max(summary.mtdGoal, 1)) * 100).toFixed(0)}% of MTD goal . ${mtdRangeLabel}`, variance: summary.mtdVar >= 0 ? `+${usdK(summary.mtdVar)}` : `${usdK(summary.mtdVar)}`, vTone: summary.mtdVar >= 0 },
    { label: 'Total GP %', sev: gpSev(summary.totalGpP, GP_TARGET), value: pct(summary.totalGpP), target: `${Math.round(GP_TARGET * 100)}% target` },
    { label: 'Parts GP %', sev: gpSev(summary.partsGpP, PARTS_GP_TARGET), value: pct(summary.partsGpP), target: `${Math.round(PARTS_GP_TARGET * 100)}% matrix midpoint` },
    { label: 'Total A/R', live: true, value: usdK(summary.arTotal), target: 'all outstanding' },
    { label: 'Past Due > 30 Days', live: true, sev: arSev(summary.arOver30), value: usdK(summary.arOver30), target: 'collections priority' },
  ];

  return (
    <div>
      {arError && <div className="rounded-2xl px-4 py-3 mb-6 c2ui text-[12.5px]" style={{ background: 'rgba(232,134,62,0.10)', border: '1px solid rgba(232,134,62,0.3)', color: INK2 }}><strong style={{ color: INK }}>A/R diagnostic:</strong> {arError}. Per-shop A/R will show "No data" until this resolves.</div>}

      {/* ── Drift Review Log ─────────────────────────────────────────────── */}
      {(() => {
        const needsReview = driftLog.filter(e => e.status === 'pending' || e.status === 'rejected');
        const approved = driftLog.filter(e => e.status === 'approved');
        const activeList = driftTab === 'review' ? needsReview : approved;

        if (driftLoading) return (
          <div className="rounded-2xl px-4 py-3 mb-6 c2ui text-[12.5px]" style={{ background: 'rgba(255,255,255,0.5)', border: `1px solid ${LINE}`, color: FAINT }}>
            Loading ticket edit history…
          </div>
        );

        if (driftLog.length === 0) return (
          <div className="rounded-2xl px-4 py-3 mb-6 c2ui text-[12.5px] flex items-center justify-between gap-2" style={{ background: 'rgba(79,180,119,0.08)', border: '1px solid rgba(79,180,119,0.28)', color: INK2 }}>
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GOOD} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              <span>No post-close ticket edits on record — all weeks clean.</span>
            </div>
            <button
              onClick={refreshDrift}
              disabled={driftRefreshing}
              className="c2ui rounded-full px-3 py-1 text-[12.5px] font-semibold transition flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.7)', color: driftRefreshing ? FAINT : INK2, border: `1px solid ${LINE}`, opacity: driftRefreshing ? 0.6 : 1 }}
            >
              {driftRefreshing ? 'Scanning…' : '↻ Scan now'}
            </button>
          </div>
        );

        return (
          <div className="rounded-2xl px-4 py-4 mb-6 c2ui text-[12.5px]" style={{ background: 'rgba(163,53,35,0.07)', border: '1px solid rgba(163,53,35,0.22)', color: INK2 }}>
            {/* Header + tabs */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <span className="font-semibold text-[13px]" style={{ color: '#A33523' }}>Ticket Edit Review</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setDriftTab('review')}
                  className="c2ui rounded-full px-3 py-1 text-[12.5px] font-semibold transition"
                  style={{ background: driftTab === 'review' ? 'rgba(163,53,35,0.15)' : 'rgba(255,255,255,0.5)', color: driftTab === 'review' ? '#A33523' : FAINT, border: driftTab === 'review' ? '1px solid rgba(163,53,35,0.3)' : `1px solid ${LINE}` }}
                >
                  Needs Review {needsReview.length > 0 && <span className="ml-1 inline-flex items-center justify-center rounded-full px-1.5 text-[11px] font-bold" style={{ background: 'rgba(163,53,35,0.2)', color: '#A33523', minWidth: 18 }}>{needsReview.length}</span>}
                </button>
                <button
                  onClick={() => setDriftTab('approved')}
                  className="c2ui rounded-full px-3 py-1 text-[12.5px] font-semibold transition"
                  style={{ background: driftTab === 'approved' ? 'rgba(79,180,119,0.15)' : 'rgba(255,255,255,0.5)', color: driftTab === 'approved' ? '#2A7A4F' : FAINT, border: driftTab === 'approved' ? '1px solid rgba(79,180,119,0.3)' : `1px solid ${LINE}` }}
                >
                  Approved {approved.length > 0 && <span className="ml-1 inline-flex items-center justify-center rounded-full px-1.5 text-[11px] font-bold" style={{ background: 'rgba(79,180,119,0.2)', color: '#2A7A4F', minWidth: 18 }}>{approved.length}</span>}
                </button>
                <button
                  onClick={refreshDrift}
                  disabled={driftRefreshing}
                  className="c2ui rounded-full px-3 py-1 text-[12.5px] font-semibold transition"
                  style={{ background: 'rgba(255,255,255,0.5)', color: driftRefreshing ? FAINT : INK2, border: `1px solid ${LINE}`, opacity: driftRefreshing ? 0.6 : 1 }}
                  title="Re-scan last 4 weeks for post-close edits"
                >
                  {driftRefreshing ? 'Scanning…' : '↻ Refresh'}
                </button>
              </div>
            </div>

            {activeList.length === 0 ? (
              <div className="py-3 text-center text-[12.5px]" style={{ color: FAINT }}>
                {driftTab === 'review' ? 'Nothing pending review — all caught up.' : 'No approved items yet.'}
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(163,53,35,0.12)' }}>
                <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr className="uppercase tracking-wide text-[11.5px]" style={{ background: 'rgba(163,53,35,0.06)', borderBottom: '1px solid rgba(163,53,35,0.1)' }}>
                      <th className="text-left px-3 py-2 font-semibold" style={{ color: FAINT }}>Shop</th>
                      <th className="text-left px-3 py-2 font-semibold" style={{ color: FAINT }}>RO #</th>
                      <th className="text-right px-3 py-2 font-semibold" style={{ color: FAINT }}>Revenue change</th>
                      <th className="text-left px-3 py-2 font-semibold" style={{ color: FAINT }}>What changed</th>
                      <th className="text-left px-3 py-2 font-semibold" style={{ color: FAINT }}>Detected</th>
                      <th className="text-left px-3 py-2 font-semibold" style={{ color: FAINT }}>Notes</th>
                      {driftTab === 'review' && <th className="text-left px-3 py-2 font-semibold" style={{ color: FAINT }}>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {activeList.map((entry, i) => {
                      const isApproved = entry.status === 'approved';
                      const isRejected = entry.status === 'rejected';
                      const rowStyle: React.CSSProperties = { borderTop: i > 0 ? '1px solid rgba(163,53,35,0.07)' : undefined, opacity: isApproved ? 0.7 : 1, background: isRejected ? 'rgba(163,53,35,0.06)' : undefined };
                      const textDecor: React.CSSProperties = isApproved ? { textDecoration: 'line-through', color: FAINT } : {};
                      const detectedDate = new Date(entry.detectedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

                      // Compute line-item movers from breakdown (snapshot-based only)
                      const lineMovers: { label: string; delta: number }[] = [];
                      if (entry.breakdownBefore && entry.breakdownAfter) {
                        const { breakdownBefore: b, breakdownAfter: a } = entry;
                        [
                          { label: 'Labor',   delta: a.labor   - b.labor   },
                          { label: 'Parts',   delta: a.parts   - b.parts   },
                          { label: 'Sublet',  delta: a.sublet  - b.sublet  },
                          { label: 'Fee',     delta: a.fee     - b.fee     },
                          { label: 'Discount',delta: a.discount - b.discount},
                        ].forEach(m => { if (Math.abs(m.delta) >= 1) lineMovers.push(m); });
                        lineMovers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
                      }

                      const changeType = entry.statusBefore === '(new)' ? 'Added after close'
                        : entry.statusAfter === '(removed)' ? 'Voided / removed'
                        : 'Revenue edited';

                      return (
                        <tr key={entry.id} style={rowStyle}>
                          <td className="px-3 py-2 font-medium" style={{ color: INK, ...textDecor }}>
                            {entry.shopName}
                            {isRejected && <span className="ml-2 c2ui text-[11px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{ background: 'rgba(163,53,35,0.18)', color: '#A33523', border: '1px solid rgba(163,53,35,0.3)' }}>Not Approved</span>}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            <a href={`https://shop.tekmetric.com/admin/shop/${entry.shopTekmetricId}/repair-orders/${entry.roId}`} target="_blank" rel="noopener noreferrer" className="c2ui" style={{ color: isApproved ? FAINT : COOL, textDecoration: isApproved ? 'line-through' : 'none', fontWeight: 600 }}>#{entry.roNumber}</a>
                            {isApproved && entry.reviewedBy && (
                              <div className="c2ui text-[11px] mt-0.5" style={{ color: FAINT }}>by {shortActor(entry.reviewedBy)}</div>
                            )}
                          </td>

                          {/* Revenue change column */}
                          <td className="px-3 py-2 tabular-nums text-right" style={textDecor}>
                            {entry.snapshotBased ? (
                              <>
                                {/* Before → after context */}
                                {entry.statusBefore !== '(new)' && entry.statusAfter !== '(removed)' && (
                                  <div className="c2ui text-[10.5px]" style={{ color: FAINT }}>
                                    {usd(entry.revenueBefore)} → {usd(entry.revenueAfter)}
                                  </div>
                                )}
                                {/* Delta — the headline number */}
                                <div className="font-semibold text-[13px]" style={{ color: isApproved ? FAINT : (entry.delta < 0 ? BAD : GOOD) }}>
                                  {entry.delta >= 0 ? '+' : ''}{usd(entry.delta)}
                                </div>
                                {entry.statusBefore === '(new)' && (
                                  <div className="c2ui text-[10.5px]" style={{ color: FAINT }}>ticket total</div>
                                )}
                              </>
                            ) : (
                              <div className="c2ui text-[11px]" style={{ color: isApproved ? FAINT : INK2 }}>
                                No baseline —<br />open RO to verify
                              </div>
                            )}
                          </td>

                          {/* What changed column */}
                          <td className="px-3 py-2 text-[12px]">
                            {entry.snapshotBased ? (
                              <div>
                                <div className="font-medium" style={{ color: isApproved ? FAINT : INK2 }}>{changeType}</div>
                                {lineMovers.slice(0, 2).map(m => (
                                  <div key={m.label} className="c2ui text-[10.5px] mt-0.5 tabular-nums" style={{ color: m.delta < 0 ? BAD : GOOD }}>
                                    {m.label}: {m.delta >= 0 ? '+' : ''}{usd(m.delta)}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="c2ui text-[11px]" style={{ color: FAINT }}>
                                Updated {entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                              </span>
                            )}
                          </td>

                          {/* Detected column */}
                          <td className="px-3 py-2 text-[12px]" style={{ color: FAINT, whiteSpace: 'nowrap' }}>
                            {detectedDate}
                          </td>

                          <td className="px-3 py-2" style={{ minWidth: 160 }}>
                            {isApproved ? (
                              <span className="text-[12px]" style={{ color: FAINT, fontStyle: entry.notes ? undefined : 'italic' }}>{entry.notes || 'No notes'}</span>
                            ) : (
                              <input
                                type="text"
                                placeholder="Add notes…"
                                value={pendingNotes[entry.id] ?? entry.notes}
                                onChange={e => setPendingNotes(prev => ({ ...prev, [entry.id]: e.target.value }))}
                                onBlur={e => {
                                  const v = e.target.value;
                                  if (v !== entry.notes) handleDriftUpdate(entry.id, { notes: v });
                                }}
                                className="c2ui w-full rounded-lg px-2 py-1 text-[12.5px] outline-none"
                                style={{ background: 'rgba(255,255,255,0.8)', border: `1px solid ${LINE}`, color: INK }}
                              />
                            )}
                          </td>
                          {driftTab === 'review' && (
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => handleDriftUpdate(entry.id, { status: 'approved' })}
                                  title="Approve"
                                  className="c2ui rounded-full w-7 h-7 flex items-center justify-center transition"
                                  style={{ background: 'rgba(79,180,119,0.15)', border: '1px solid rgba(79,180,119,0.35)', color: '#2A7A4F' }}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                                </button>
                                <button
                                  onClick={() => handleDriftUpdate(entry.id, { status: isRejected ? 'pending' : 'rejected' })}
                                  title={isRejected ? 'Clear flag' : 'Flag — Not Approved'}
                                  className="c2ui rounded-full w-7 h-7 flex items-center justify-center transition"
                                  style={{ background: isRejected ? 'rgba(163,53,35,0.2)' : 'rgba(163,53,35,0.08)', border: isRejected ? '1px solid rgba(163,53,35,0.45)' : '1px solid rgba(163,53,35,0.2)', color: '#A33523' }}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* Week stepper -- roll back to any prior completed week. */}
      <div className="inline-flex items-center gap-1 rounded-full p-1 mb-6" style={{ background: 'rgba(255,255,255,0.6)', border: `1px solid ${LINE}` }}>
        <button onClick={() => stepWeek(-1)} className="c2ui rounded-full w-8 h-8 flex items-center justify-center transition" style={{ color: INK2 }} aria-label="Previous week">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="px-3 flex items-center gap-2 select-none">
          <span className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>Week of</span>
          <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 14 }}>{snapLabel}</span>
          {atLatest && <span className="c2ui text-[12.5px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{ background: 'rgba(232,134,62,0.14)', color: '#B5631F' }}>Latest</span>}
        </div>
        <button onClick={() => stepWeek(1)} disabled={atLatest} className="c2ui rounded-full w-8 h-8 flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed" style={{ color: INK2 }} aria-label="Next week">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        {!atLatest && <button onClick={() => setWeekStart(lastCompletedMonday())} className="c2ui ml-1 text-[13px] font-semibold rounded-full px-3 py-1 transition" style={{ color: '#B5631F', background: 'rgba(232,134,62,0.12)' }}>Jump to latest</button>}
      </div>

      {/* Holiday week banner — shown when the work week has fewer than 5 working days */}
      {lwWorkingDays < 5 && (
        <div className="mb-6 rounded-2xl px-5 py-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.92)', border: `1.5px solid ${COOL}` }}>
          <span style={{ color: COOL, fontSize: 16, flexShrink: 0, fontWeight: 700 }}>◆</span>
          <span className="c2ui text-[13px]" style={{ color: INK }}>
            <span style={{ color: COOL, fontWeight: 700 }}>{lwWorkingDays}-day week{lwHolidayNote ? ` · ${lwHolidayNote}` : ''}</span>
            {' — '}revenue and GP$ goals adjusted to {lwWorkingDays}/5 of the weekly target.
          </span>
        </div>
      )}

      {/* THE WEEK -- editorial 2-up hero: revenue + GP$ as huge Fraunces
          numbers with variance, pace, and a placement track. This is the
          first thing a leader reads on Monday. */}
      <section id="vitals" className="scroll-mt-6 mb-7">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <HeroNumber kicker="Last week . revenue" value={summary.lwRev} goal={summary.lwGoal} variance={summary.lwVar} sev={paceSev(summary.lwGoal > 0 ? summary.lwRev / summary.lwGoal : null)} footnote="* Excludes refund invoices" />
          <HeroNumber kicker="Last week . gross profit" value={summary.totalGpD} goal={summary.lwGpGoal} variance={summary.totalGpD - summary.lwGpGoal} sev={paceSev(summary.lwGpGoal > 0 ? summary.totalGpD / summary.lwGpGoal : null)} footnote={<>GP% <span className="c2disp tabular-nums" style={{ color: INK, fontWeight: 600 }}>{pct(summary.totalGpP)}</span> . target {Math.round(GP_TARGET * 100)}% . Parts GP <span className="c2disp tabular-nums" style={{ color: INK, fontWeight: 600 }}>{pct(summary.partsGpP)}</span></>} />
        </div>
        {/* Running stats strip -- editorial flow with dividers */}
        <div className="mt-5 rounded-[26px] px-7 py-5 flex flex-wrap items-start gap-x-9 gap-y-4" style={FROST}>
          <StatPair label="Cars" value={num(lwKpi.totalCars)} />
          <Div />
          <StatPair label="ARO" value={usd(lwKpi.averageAro)} />
          <Div />
          <StatPair label="AWRO" value={usd(lwKpi.totalCars > 0 ? lwKpi.byShop.reduce((s, r) => s + r.presentedDollars, 0) / lwKpi.totalCars : 0)} />
          <Div />
          <StatPair label="Close" value={pct(lwKpi.byShop.length ? lwKpi.byShop.reduce((s, r) => s + r.closeRate, 0) / lwKpi.byShop.length : 0)} />
          <Div />
          <StatPair label="Approved" value={usdK(lwKpi.byShop.reduce((s, r) => s + ((r as any).approvedDollars || 0), 0))} />
          <Div />
          <StatPair label="A/R total" live value={usdK(summary.arTotal)} />
          <Div />
          <StatPair label="Past due > 30d" live value={usdK(summary.arOver30)} valueColor={summary.arOver30 >= 25000 ? BAD : summary.arOver30 >= 10000 ? WARN : INK} />
        </div>
      </section>

      {/* GP $ vs Target -- elevated to the second hero. Larger bullet bars,
          editorial framing, MTD as the right column anchored to full-month. */}
      <section id="gp-goal" className="scroll-mt-6 mb-7">
        <div className="mb-5">
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em] mb-1" style={{ color: AMBER }}>Gross profit . the bottom line</div>
          <h2 className="c2disp leading-tight" style={{ color: INK, fontSize: 28, letterSpacing: '-0.02em' }}>GP $ vs target</h2>
          <p className="c2ui text-[12.5px] mt-1 max-w-2xl" style={{ color: INK2 }}>GP $ goal = revenue goal × {Math.round(GP_TARGET * 100)}%. The MTD target is working-day-prorated through end of last week so the bar is honest about pace.</p>
        </div>
        <div className="rounded-[26px] p-7" style={FROST}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <GpBar label="Last week" actual={summary.totalGpD} target={summary.lwGpGoal} />
            <GpBar label="Month-to-date" windowLabel={mtdRangeLabel} actual={summary.mtdGpDollars} target={summary.mtdGpGoal} fullMonthGoal={summary.mtdFullMonthGpGoal} />
          </div>
        </div>
      </section>

      {/* 02 Shop-by-shop */}
      <Section eyebrow="02 . Per-shop review" title="Shop-by-shop weekly performance" sub="Last week . MTD . GP $ goal progress . operations . live A/R for every shop." />
      <div className="grid gap-4 grid-cols-1 xl:grid-cols-2 mb-8">
        {shopRows.map((r) => <ShopCard key={r.shopNum} row={r} mtdRangeLabel={mtdRangeLabel} gpTree={gpTrees[r.shopNum]} />)}
      </div>

      {/* 03 Diagnostic callouts */}
      {diagnostic && (
        <>
          <Section eyebrow="03 . Diagnostic callouts" title="If something missed, here's the likely cause" sub="Compact summaries -- the full GP$ tree lives on the Diagnostic." />
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 mb-8">
            <CalloutCard title="Revenue gap" lines={revenueGapLines(summary, lwKpi, diagnostic)} />
            <CalloutCard title="Gross profit gap" lines={gpGapLines(summary, diagnostic, partsGpDiag)} />
          </div>
        </>
      )}

      {/* 03b Parts GP breakdown -- only shown when parts GP is the primary drag
          and the diagnosis has loaded. Replaces the vague "manual overrides"
          guess with an actual ranked job-name table. */}
      {partsGpDiag && diagnostic && (PARTS_GP_TARGET - diagnostic.partsGpPct) >= 0.005 && (
        <div className="mb-8">
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em] mb-3" style={{ color: FAINT }}>Parts GP . job-level breakdown</div>
          <div className="rounded-[26px] overflow-hidden" style={{ background: 'linear-gradient(180deg,rgba(255,255,255,0.94),rgba(255,255,255,0.82))', border: '1px solid rgba(255,255,255,0.80)', boxShadow: '0 18px 48px -28px rgba(40,34,26,0.22)' }}>
            <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-4 flex-wrap" style={{ borderBottom: `1px solid ${LINE}` }}>
              <div>
                <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: FAINT }}>Parts GP diagnosis</div>
                <div className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 20, letterSpacing: '-0.015em' }}>
                  {partsGpDiag.summary.likelyCause === 'canned-jobs' ? 'Canned job pricing' : partsGpDiag.summary.likelyCause === 'manual-overrides' ? 'Manual price overrides' : 'Mixed cause'}
                  {' -- '}${Math.round(partsGpDiag.summary.totalDragDollars).toLocaleString()} below 55% target
                </div>
                <div className="c2ui text-[13px] mt-1" style={{ color: INK2 }}>
                  Top 5 job names account for {partsGpDiag.summary.top5ConcentrationPct}% of the drag across {partsGpDiag.summary.uniqueJobNames} unique job names.
                  {partsGpDiag.summary.likelyCause === 'canned-jobs' && ' Fix the matrix price on those jobs to recover most of the gap.'}
                  {partsGpDiag.summary.likelyCause === 'manual-overrides' && ' Drag is scattered -- advisors are discounting parts on individual ROs.'}
                  {partsGpDiag.summary.likelyCause === 'mixed' && ' Both canned job pricing and individual overrides are contributing.'}
                </div>
              </div>
              <span className="c2ui text-[12.5px] font-bold px-3 py-1.5 rounded-full shrink-0" style={{
                background: partsGpDiag.summary.likelyCause === 'canned-jobs' ? 'rgba(163,53,35,0.10)' : partsGpDiag.summary.likelyCause === 'manual-overrides' ? 'rgba(232,134,62,0.14)' : 'rgba(95,169,214,0.14)',
                color: partsGpDiag.summary.likelyCause === 'canned-jobs' ? '#A33523' : partsGpDiag.summary.likelyCause === 'manual-overrides' ? '#B5631F' : COOL,
              }}>
                {partsGpDiag.summary.likelyCause === 'canned-jobs' ? 'Canned jobs' : partsGpDiag.summary.likelyCause === 'manual-overrides' ? 'Manual overrides' : 'Mixed'}
              </span>
            </div>
            <div className="overflow-auto">
              <table className="w-full c2ui text-[12.5px]">
                <thead style={{ background: 'rgba(247,244,238,0.90)' }}>
                  <tr style={{ color: FAINT, borderBottom: `1px solid ${LINE}` }}>
                    <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wide">#</th>
                    <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wide">Job Name</th>
                    <th className="text-right px-4 py-2.5 font-semibold uppercase tracking-wide">ROs</th>
                    <th className="text-right px-4 py-2.5 font-semibold uppercase tracking-wide">Parts Sold</th>
                    <th className="text-right px-4 py-2.5 font-semibold uppercase tracking-wide">Actual GP%</th>
                    <th className="text-right px-4 py-2.5 font-semibold uppercase tracking-wide">GP$ Drag</th>
                  </tr>
                </thead>
                <tbody>
                  {partsGpDiag.topOffenders.slice(0, 12).map((r: any, i: number) => {
                    const maxDrag = partsGpDiag.topOffenders[0]?.dragDollars || 1;
                    const barPct = Math.max(2, (r.dragDollars / maxDrag) * 100);
                    const gpColor = r.actualGpPct < 30 ? BAD : r.actualGpPct < 45 ? WARN : INK2;
                    return (
                      <tr key={r.jobName} style={{ borderTop: `1px solid ${LINE}`, background: i % 2 ? 'rgba(255,255,255,0.35)' : 'transparent' }}>
                        <td className="px-4 py-2 tabular-nums" style={{ color: i < 3 ? AMBER : FAINT }}>{i + 1}</td>
                        <td className="px-4 py-2 font-medium max-w-xs" style={{ color: INK }}>
                          <div className="truncate">{r.jobName}</div>
                          <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.07)', width: '100%' }}>
                            <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: `linear-gradient(90deg,${BAD}66,${BAD}bb)` }} />
                          </div>
                        </td>
                        <td className="px-4 py-2 tabular-nums text-right" style={{ color: INK2 }}>{r.roCount}</td>
                        <td className="px-4 py-2 tabular-nums text-right" style={{ color: INK2 }}>{usd(r.partsSoldDollars)}</td>
                        <td className="px-4 py-2 tabular-nums text-right font-semibold" style={{ color: gpColor }}>{r.actualGpPct.toFixed(1)}%</td>
                        <td className="px-4 py-2 tabular-nums text-right font-semibold" style={{ color: BAD }}>{usd(r.dragDollars)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {partsGpDiag.topOffenders.length > 12 && (
              <div className="px-6 py-3 c2ui text-[12.5px]" style={{ color: FAINT, borderTop: `1px solid ${LINE}` }}>
                Showing top 12 of {partsGpDiag.topOffenders.length} job names with below-target parts GP.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 04 A/R -- the FULL shared workbench (modes / time-period / per-shop /
          trend / sortable customer detail). Matches production parity: the
          /review page embeds the same AccountsReceivable component the
          operational dashboard does. */}
      <ConceptAR id="ar" eyebrow="04 . A/R . live" />

      {/* 05 Waterfall -- pending the QuickBooks integration. Wrapped in a
          PlaceholderStamp so reviewers see at a glance that the cost layers
          below Parts + Labor are speculative projections, not real numbers. */}
      <PlaceholderStamp>
        <Card id="waterfall" eyebrow="05 . Profit flow" title="Financial Waterfall" sub="Revenue and cost layers from Tekmetric. P&L lines from QuickBooks integration pending.">
          <Waterfall rev={summary.lwRev} parts={summary.lwRev * (1 - summary.partsGpP) * 0.45} labor={summary.lwRev * (1 - (diagnostic?.laborGpPct ?? LABOR_GP_TARGET)) * 0.45} />
        </Card>
      </PlaceholderStamp>

      {/* 06 Expenses -- same QuickBooks-integration-pending caveat applies. */}
      <PlaceholderStamp>
        <Card id="expenses" eyebrow="06 . Cost structure" title="Expense Classification" sub="Fixed structural costs, controllable operations, one-time distortions -- QuickBooks integration pending for most lines.">
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
            {['Fixed / Structural', 'Controllable Operations', 'One-Time Distortions'].map((t) => (
              <div key={t} className="rounded-2xl p-5" style={INSET}>
                <div className="c2ui text-[12.5px] uppercase tracking-[0.1em] font-semibold mb-3" style={{ color: FAINT }}>{t}</div>
                <div className="c2ui text-[13px] text-center py-6" style={{ color: INK2 }}>QuickBooks integration pending</div>
              </div>
            ))}
          </div>
        </Card>
      </PlaceholderStamp>

      <footer className="c2ui text-center text-[12.5px] py-6 leading-relaxed" style={{ color: FAINT }}>
        Weekly Review . Snapshot {snapLabel} . A/R live . Working-day-prorated MTD targets . GP $ goals at {Math.round(GP_TARGET * 100)}% of revenue goal.
      </footer>
    </div>
  );
}

// ── section header (text only) ──────────────────────────────────────────────
function Section({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em] mb-1" style={{ color: FAINT }}>{eyebrow}</div>
      <h2 className="c2disp leading-tight" style={{ color: INK, fontSize: 30, letterSpacing: '-0.02em' }}>{title}</h2>
      {sub && <div className="c2ui text-[12.5px] mt-1" style={{ color: INK2 }}>{sub}</div>}
    </div>
  );
}

// ── GP $ bullet bar ──────────────────────────────────────────────────────────
function GpBar({ label, windowLabel, actual, target, fullMonthGoal, compact }: { label: string; windowLabel?: string; actual: number; target: number; fullMonthGoal?: number; compact?: boolean }) {
  const pctVal = target > 0 ? actual / target : null;
  const variance = actual - target;
  const sev: Sev = pctVal === null ? 'watch' : pctVal >= 1 ? 'ok' : pctVal >= 0.95 ? 'watch' : pctVal >= 0.8 ? 'problem' : 'critical';
  const score = pctVal === null ? 0.5 : heatScoreFromPct(pctVal);
  const hasFull = !!fullMonthGoal && fullMonthGoal > target;
  const denom = hasFull ? fullMonthGoal! : target * 1.1;
  const fillW = denom > 0 ? Math.min((actual / denom) * 100, 100) : 0;
  const targetPct = denom > 0 ? (target / denom) * 100 : 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
        <div className="c2ui text-[12.5px] uppercase tracking-wide font-semibold" style={{ color: FAINT }}>{label}</div>
        {windowLabel && <div className="c2ui text-[12.5px]" style={{ color: FAINT }}>{windowLabel}</div>}
      </div>
      <div className={`flex items-baseline gap-3 flex-wrap ${compact ? 'mb-2' : 'mb-3'}`}>
        <span className="c2disp tabular-nums leading-none" style={{ color: INK, fontSize: compact ? 22 : 34, letterSpacing: '-0.02em' }}>{usd(actual)}</span>
        <span className="c2ui" style={{ color: INK2, fontSize: compact ? 11.5 : 12.5 }}>/ {usd(target)} target</span>
        {pctVal !== null && <span className="c2disp tabular-nums font-bold" style={{ color: heatColor(score), fontSize: compact ? 11.5 : 12.5 }}>{(pctVal * 100).toFixed(0)}%</span>}
      </div>
      <div className={`relative rounded-md overflow-hidden ${compact ? 'h-6' : 'h-8'}`} style={{ background: 'rgba(34,32,28,0.06)' }}>
        <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${fillW}%`, background: heatFill(score) }} />
        <div className="absolute top-0 bottom-0 w-px" style={{ left: `${targetPct}%`, background: 'rgba(34,32,28,0.55)' }} />
        <div className="absolute top-1/2 c2ui text-[13px] font-bold uppercase tracking-wider rounded px-1" style={{ left: `${targetPct}%`, transform: `translate(${targetPct > 80 ? '-100%' : '4px'}, -50%)`, background: 'rgba(255,255,255,0.85)', color: INK }}>Target</div>
        {hasFull && <><div className="absolute top-0 bottom-0 w-[2px]" style={{ right: 0, background: 'rgba(34,32,28,0.3)' }} /><div className="absolute top-1/2 c2ui text-[13px] font-bold uppercase tracking-wider rounded px-1" style={{ right: '4px', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.85)', color: FAINT }}>Full mo</div></>}
      </div>
      <div className="flex items-center justify-between c2ui text-[13px] mt-2 flex-wrap gap-2">
        <span className="font-semibold" style={{ color: variance >= 0 ? GOOD : BAD }}>{variance >= 0 ? `↑ +${usdK(variance)} over target` : `↓ ${usdK(variance)} under target`}</span>
        {hasFull && fullMonthGoal && <span style={{ color: FAINT }}>Full-month GP goal: <span className="font-semibold" style={{ color: INK2 }}>{usdK(fullMonthGoal)}</span></span>}
      </div>
    </div>
  );
}

// ── per-shop card -- editorial shop profile ──────────────────────────────────
// New composition: shop-color top stripe + headline shop name in big Fraunces,
// hero Last-Week revenue as a dominant number with shop-tinted track to goal,
// MTD as a smaller right-column echo, monthly-pace strip, then GP$ progress
// (compact bullet bars + parts/labor chips), Operations as a flowing inline
// row, and the A/R strip last. Reads like a one-page shop profile.
function ShopCard({ row, mtdRangeLabel, gpTree }: { row: ShopRow; mtdRangeLabel: string; gpTree?: GpTree }) {
  // REVERTED (user request): the heat-tinted background wash made every
  // card a different color -- eight wildly different surfaces side by side
  // read as visual noise, not signal. Returned to the white-frosted card
  // style that matches every other concept2 card. Signal still lives where
  // it should: the LW bar's heat-fill, the variance pill, the GP%/Parts/
  // Labor figures -- readers compare those values, not the card chrome.
  const [open, setOpen] = useState(false);
  const [openTree, setOpenTree] = useState(false);
  const hasOverdue = row.ar.kind === 'loaded' && row.ar.customers.length > 0;
  const shopColor = SHOP_BY_NUM[row.shopNum as ShopNum]?.color ?? FAINT;
  const meta = SHOP_BY_NUM[row.shopNum as ShopNum];
  const lwRatio = row.lwTarget > 0 ? row.lwActual / row.lwTarget : 0;
  const lwScore = row.lwTarget > 0 ? heatScoreFromPct(lwRatio) : 0.5;
  const lwCap = Math.max(row.lwTarget * 1.1, row.lwActual);
  const lwFillW = lwCap > 0 ? Math.min(100, (row.lwActual / lwCap) * 100) : 0;
  const lwGoalX = lwCap > 0 ? Math.min(100, (row.lwTarget / lwCap) * 100) : 100;
  return (
    <div className="rounded-[28px] overflow-hidden" style={{
      // Unified white-frosted surface -- same chrome as every other concept2
      // card. The shop-color identity stripe at the top + the dot beside
      // the shop name provide shop identification; the LW bar's heat fill
      // (not the card background) carries the performance signal.
      background: 'rgba(255,255,255,0.62)',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.7), 0 18px 48px -28px rgba(40,34,26,0.18), 0 2px 8px -4px rgba(40,34,26,0.06)',
      border: `1px solid ${LINE}`,
    }}>
      {/* Shop-color identity stripe -- kept (taller, more presence). */}
      <div style={{ height: 7, background: `linear-gradient(90deg, ${shopColor}, ${shopColor}aa 70%, ${shopColor}55)` }} />
      <div className="p-7">
        {/* Header -- shop name as headline, byline below. District as a small
            light pill on the right (concept 1 signature) instead of severity
            pills (which the heat wash now communicates). */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
          <div className="min-w-0 flex items-center gap-3">
            <span className="inline-block rounded-full shrink-0" style={{ width: 14, height: 14, background: shopColor, boxShadow: `0 0 0 4px ${shopColor}22` }} />
            <div>
              <div className="c2disp leading-tight" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>{row.shopName}</div>
              <div className="c2ui text-[12.5px] mt-0.5" style={{ color: INK2 }}>Shop {row.shopNum} . {row.bays} bays{meta?.city ? ` . ${meta.city}, ${meta.state}` : ''}</div>
            </div>
          </div>
          {meta?.district && (
            <span className="c2ui inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold uppercase tracking-[0.14em]" style={{ background: 'rgba(255,255,255,0.55)', color: INK2, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.6)' }}>{meta.district}</span>
          )}
        </div>

        {/* HERO -- bigger LW revenue (clamp 2.6->3.8rem) + MTD echo. The
            numbers sit directly on the heat surface, unboxed, with confident
            typography. */}
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-7 mb-6">
          <div>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: INK2 }}>Last week</div>
            <div className="c2disp tabular-nums leading-none mt-2" style={{ color: INK, fontSize: 44, letterSpacing: '-0.03em' }}>{usd(row.lwActual)}</div>
            <div className="c2ui text-[13px] mt-2.5 flex items-baseline gap-2 flex-wrap" style={{ color: INK2 }}>
              <span className="c2disp tabular-nums font-bold" style={{ color: INK }}>{row.lwVar >= 0 ? '↑ +' : '↓ '}{usdK(Math.abs(row.lwVar))}</span>
              <span>vs {usdK(row.lwTarget)} goal</span>
              <span style={{ color: INK2 }}>.</span>
              <span className="c2disp tabular-nums font-bold" style={{ color: INK }}>{(lwRatio * 100).toFixed(0)}%</span>
            </div>
            {/* LW bar -- heat fill, shop-color goal tick. Track is a
                translucent-white inset so the bar reads cleanly on the heat
                wash background. */}
            {/* Track: grey-tinted so the heat fill reads on the white card.
                (Used to be translucent-white because the card itself was
                heat-tinted; on the unified white surface, white-on-white
                would render the empty track invisible.) */}
            <div className="mt-4 relative h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.08)' }}>
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${lwFillW}%`, background: heatFill(lwScore) }} />
              <div className="absolute -top-0.5 -bottom-0.5 w-[2px]" style={{ left: `${lwGoalX}%`, background: shopColor, boxShadow: '0 0 0 1px rgba(255,255,255,0.85)' }} />
            </div>
          </div>
          <div className="md:border-l md:pl-7" style={{ borderColor: 'rgba(34,32,28,0.12)' }}>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: INK2 }}>Month-to-date</div>
            <div className="c2disp tabular-nums leading-none mt-2" style={{ color: INK, fontSize: 22, letterSpacing: '-0.02em' }}>{usd(row.mtdActual)}</div>
            <div className="c2ui text-[12.5px] mt-2 flex items-baseline gap-2 flex-wrap" style={{ color: INK2 }}>
              <span className="font-bold" style={{ color: INK }}>{row.mtdVar >= 0 ? '+' : ''}{usdK(row.mtdVar)}</span>
              <span>vs {usdK(row.mtdTarget)} pace</span>
            </div>
            <div className="c2ui text-[13px] mt-1" style={{ color: INK2 }}>{(row.mtdFullPct * 100).toFixed(0)}% of {usdK(row.mtdFullMonth)} full-month goal</div>
          </div>
        </div>

        {/* Monthly pace bar -- same component, sits naturally on the heat
            surface since its track is already translucent. */}
        <PaceBar actualPct={row.mtdFullPct} expectedPct={row.mtdExpectedPct} actualLabel={usdK(row.mtdActual)} expectedLabel={usdK(row.mtdTarget)} fullLabel={usdK(row.mtdFullMonth)} />

        {/* GP block -- bigger total GP%, parts/labor + 2 bullet bars. */}
        <div className="mt-7 pt-6" style={{ borderTop: '1px solid rgba(34,32,28,0.10)' }}>
          <div className="flex items-baseline gap-4 mb-4 flex-wrap">
            <div>
              <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: INK2 }}>Gross profit</div>
              <div className="c2disp tabular-nums leading-none mt-1.5" style={{ color: INK, fontSize: 30, letterSpacing: '-0.02em' }}>{pct(row.gpPct)}</div>
            </div>
            <span className="c2ui text-[13px]" style={{ color: INK2 }}>target {Math.round(GP_TARGET * 100)}% . Parts <span className="c2disp tabular-nums" style={{ color: INK, fontWeight: 600 }}>{pct(row.partsGpPct)}</span> / {Math.round(PARTS_GP_TARGET * 100)}% . Labor <span className="c2disp tabular-nums" style={{ color: INK, fontWeight: 600 }}>{pct(row.laborGpPct)}</span> / {Math.round(LABOR_GP_TARGET * 100)}%</span>
          </div>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            <GpBar label="Last Week GP $" actual={row.lwGpActual} target={row.lwGpGoal} compact />
            <GpBar label="MTD GP $" actual={row.mtdGpActual} target={row.mtdGpGoal} fullMonthGoal={row.fullMonthGpGoal} compact />
          </div>
          {gpTree && (() => {
            const t = gpTree;
            const sc = !t.hasGoal ? 0.5 : t.onTrack ? 0.9 : norm(t.gp$Goal > 0 ? t.gp$Proj / t.gp$Goal : 1, 0.80, 1.02);
            const carsLeaf = t.leaves.find((l) => l.key === 'cars')!;
            const aroLeaf = t.leaves.find((l) => l.key === 'aro')!;
            const gpLeaf = t.leaves.find((l) => l.key === 'gpPct')!;
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
              <div className="mt-4 rounded-2xl overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
                <button onClick={() => setOpenTree(!openTree)} className="w-full text-left px-4 py-3 flex items-center gap-3" style={heatCell(sc)}>
                  <span className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
                    {t.onTrack ? (
                      <span className="c2ui text-[13px]" style={{ color: '#3E8E5E' }}>On GP$ goal ✓</span>
                    ) : t.primary ? (
                      <span className="c2ui inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12.5px]" style={{ background: 'rgba(255,255,255,0.6)' }}>
                        <span style={{ color: INK, fontWeight: 600 }}>{t.primary.label}</span>
                        <span style={{ color: '#B5631F' }}>{usdK(t.primary.gp$)}</span>
                        <span style={{ color: INK2 }}>via {t.primary.primaryCause.toLowerCase()}</span>
                      </span>
                    ) : <span className="c2ui text-[13px]" style={{ color: INK2 }}>--</span>}
                  </span>
                  <span className="c2disp tabular-nums shrink-0 text-right" style={{ color: t.onTrack ? '#3E8E5E' : '#B5631F', fontSize: 15, width: 88 }}>{t.onTrack ? '✓' : usdK(t.gap) + ' short'}</span>
                </button>
                {openTree && (
                  <div className="px-4 py-4" style={{ background: 'rgba(255,255,255,0.7)' }}>
                    <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                      <div className="c2ui text-[12.5px]" style={{ color: INK2 }}>
                        <span className="c2disp" style={{ color: INK, fontSize: 16 }}>GP$ {usdK(t.gp$Proj)}</span> actual vs <span style={{ fontWeight: 600, color: INK }}>{usdK(t.gp$Goal)}</span> goal
                        {t.onTrack ? <span style={{ color: '#3E8E5E', fontWeight: 600 }}> · on goal ✓</span> : <span style={{ color: '#B5631F', fontWeight: 600 }}> · short {usdK(t.gap)} last week</span>}
                      </div>
                      <span className="c2ui text-[12.5px]" style={{ color: FAINT }}>{t.method === 'goal-met' ? `benchmarked vs ${t.goalWeeks} goal-hitting week${t.goalWeeks === 1 ? '' : 's'}` : `best-weeks benchmark · rarely hits goal (${t.sampleWeeks} wks)`}</span>
                    </div>
                    <div className="space-y-1.5">
                      {nodes.map((nd, i) => {
                        if (nd.kind === 'branch') {
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
                      {t.primary && <div className="c2ui text-[13px] mt-3" style={{ color: INK2 }}><span style={{ color: INK, fontWeight: 600 }}>Start here:</span> {t.primary.label} → {t.primary.primaryCause} -- the biggest single GP$ lever for {t.name} last week ({usdK(t.primary.gp$)}; {t.primary.primaryFix}).</div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Operations -- flowing inline row */}
        <div className="mt-7 pt-6 flex flex-wrap items-baseline gap-x-9 gap-y-3" style={{ borderTop: '1px solid rgba(34,32,28,0.10)' }}>
          <div>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: INK2 }}>Approved</div>
            <div className="c2disp tabular-nums mt-1" style={{ color: INK, fontSize: 19 }}>{usdK(row.approvedSales)}</div>
          </div>
          <div>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: INK2 }}>ARO</div>
            <div className="c2disp tabular-nums mt-1" style={{ color: INK, fontSize: 19 }}>{usd(row.aro)}</div>
          </div>
          <div>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: INK2 }}>Cars</div>
            <div className="c2disp tabular-nums mt-1" style={{ color: INK, fontSize: 19 }}>{num(row.carCount)}</div>
          </div>
          <div>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: INK2 }}>Rev / bay / wk</div>
            <div className="c2disp tabular-nums mt-1" style={{ color: INK, fontSize: 19 }}>{usdK(row.revPerBayPerWeek)}</div>
          </div>
          <div>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: INK2 }}>Annualized / bay</div>
            <div className="c2disp tabular-nums mt-1" style={{ color: INK2, fontSize: 17 }}>{usdK(row.revPerBayPerYear)}<span className="c2ui text-[12.5px] ml-1" style={{ color: INK2 }}>/ yr</span></div>
          </div>
        </div>

        {/* A/R . live */}
        <div className="mt-7 pt-6" style={{ borderTop: '1px solid rgba(34,32,28,0.10)' }}>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: INK2 }}>A/R . live</div>
          <ARStrip ar={row.ar} hasOverdue={hasOverdue} open={open} setOpen={setOpen} />
        </div>
      </div>
    </div>
  );
}

function Lbl({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`c2ui text-[12.5px] uppercase tracking-[0.1em] font-semibold mb-2 ${className ?? ''}`} style={{ color: FAINT }}>{children}</div>;
}
function Neutral({ label, value }: { label: string; value: string }) {
  return <div><div className="c2ui text-[12.5px] uppercase tracking-wide font-semibold leading-none mb-1" style={{ color: FAINT }}>{label}</div><div className="c2disp tabular-nums" style={{ color: INK, fontSize: 15 }}>{value}</div></div>;
}
function RevBlock({ title, actual, target, variance, pct: p, extra }: { title: string; actual: number; target: number; variance: number; pct: number | null; extra?: string }) {
  return (
    <div className="rounded-2xl px-3 py-3" style={INSET}>
      <div className="flex items-center justify-between mb-1">
        <span className="c2ui text-[12.5px] uppercase tracking-wide font-semibold" style={{ color: FAINT }}>{title}</span>
        <span className="c2ui text-[12.5px] font-bold tabular-nums" style={{ color: INK }}>{p !== null ? `${(p * 100).toFixed(0)}%` : '--'} of goal</span>
      </div>
      <div className="c2disp tabular-nums leading-tight" style={{ color: INK, fontSize: 22 }}>{usd(actual)}</div>
      <div className="c2ui text-[13px] mt-0.5" style={{ color: INK2 }}>Target {usdK(target)}</div>
      <div className="c2ui text-[13px] font-semibold mt-0.5" style={{ color: variance >= 0 ? GOOD : BAD }}>{variance >= 0 ? `↑ +${usdK(variance)}` : `↓ ${usdK(variance)}`}</div>
      {extra && <div className="c2ui text-[12.5px] mt-0.5" style={{ color: FAINT }}>{extra}</div>}
    </div>
  );
}
function PaceBar({ actualPct, expectedPct, actualLabel, expectedLabel, fullLabel }: { actualPct: number; expectedPct: number; actualLabel: string; expectedLabel: string; fullLabel: string }) {
  const cap = 1.1; const actualW = Math.min(actualPct, cap) / cap * 100; const expectedX = Math.min(expectedPct, cap) / cap * 100;
  const onPace = actualPct >= expectedPct * 0.95;
  // Heat score: relative to *expected pace*, not full goal. Mid-month pacing
  // at 50% is on-track if expected is 50% -- that should read cool, not coral.
  const paceRatio = expectedPct > 0 ? actualPct / expectedPct : (actualPct >= 1 ? 1 : 0);
  const score = heatScoreFromPct(paceRatio);
  return (
    <div>
      <div className="flex items-center justify-between c2ui text-[12.5px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: FAINT }}>
        <span>Monthly pace</span>
        <span style={{ color: heatColor(score) }}>{onPace ? 'on pace' : 'behind pace'} . {(actualPct * 100).toFixed(0)}% of full goal</span>
      </div>
      <div className="relative h-5 rounded-md overflow-hidden" style={{ background: 'rgba(34,32,28,0.06)' }}>
        <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${actualW}%`, background: heatFill(score) }} />
        <div className="absolute top-0 bottom-0 w-px" style={{ left: `${100 / cap}%`, background: 'rgba(34,32,28,0.7)' }} />
        <div className="absolute top-0 bottom-0 w-[2px]" style={{ left: `${expectedX}%`, background: AMBER }} />
      </div>
      <div className="flex items-center justify-between c2ui text-[12.5px] mt-1.5" style={{ color: INK2 }}>
        <span>Actual <span className="font-semibold" style={{ color: INK }}>{actualLabel}</span></span>
        <span>Projected MTD <span className="font-semibold" style={{ color: INK }}>{expectedLabel}</span></span>
        <span>Full month <span className="font-semibold" style={{ color: INK }}>{fullLabel}</span></span>
      </div>
    </div>
  );
}
type ARSortKey = 'customer' | 'balance' | 'days' | 'ro';
function ARStrip({ ar, hasOverdue, open, setOpen }: { ar: ShopARState; hasOverdue: boolean; open: boolean; setOpen: (v: boolean) => void }) {
  // Sort state lives in the panel so each shop's expand keeps its own choice.
  // Default = balance DESC (the most expensive overdue surfaces first, which
  // is the most common collection workflow).
  const [sortKey, setSortKey] = useState<ARSortKey>('balance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  if (ar.kind === 'loading') return <div className="rounded-2xl px-3 py-3 c2ui text-[13px]" style={{ ...INSET, color: INK2 }}>Loading A/R…</div>;
  if (ar.kind === 'no-data') return <div className="rounded-2xl px-3 py-3 c2ui text-[13px]" style={{ ...INSET, color: INK2 }}>No outstanding A/R found.</div>;
  const sev = arSev(ar.over30); const showColor = sev === 'problem' || sev === 'critical';
  // ar.kind is narrowed to 'loaded' here by the early returns above, but the
  // IIFE creates a fresh closure scope so we annotate explicitly to keep
  // TypeScript happy without an extra cast.
  const sorted: ARCustomer[] = (() => {
    if (ar.kind !== 'loaded') return [];
    const list: ARCustomer[] = [...ar.customers];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === 'customer') return dir * (a.customerName || '').localeCompare(b.customerName || '');
      if (sortKey === 'balance') return dir * (a.balance - b.balance);
      if (sortKey === 'days') return dir * (a.daysOverdue - b.daysOverdue);
      return dir * (a.roNumber - b.roNumber);
    });
    return list;
  })();
  const toggle = (k: ARSortKey) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'customer' ? 'asc' : 'desc'); }
  };
  const arrow = (k: ARSortKey) => sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '⇅';
  const headCell = (k: ARSortKey, label: string, align: 'left' | 'right') => (
    <th onClick={() => toggle(k)} className={`cursor-pointer select-none px-3 py-2 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`} style={{ color: sortKey === k ? INK : FAINT }}>{label}<span className="opacity-50 text-[13px]">{arrow(k)}</span></span>
    </th>
  );
  return (
    <div className="rounded-2xl" style={INSET}>
      <div className="px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap c2ui text-[12.5px]">
          <span style={{ color: INK }}><span className="font-semibold tabular-nums">{usd(ar.total)}</span> <span style={{ color: INK2 }}>total</span></span>
          <span style={{ color: FAINT }}>.</span>
          <span style={{ color: showColor ? BAD : INK }}><span className="font-semibold tabular-nums">{usd(ar.over30)}</span> <span style={{ color: INK2 }}>&gt; 30d</span></span>
          {ar.customers.length > 0 && <><span style={{ color: FAINT }}>.</span><span style={{ color: INK2 }}>{ar.customers.length} overdue {ar.customers.length === 1 ? 'invoice' : 'invoices'}</span></>}
        </div>
        {hasOverdue && <button onClick={() => setOpen(!open)} className="c2ui text-[13px] font-medium" style={{ color: WARN }}>{open ? 'Hide ▲' : 'Show overdue ▾'}</button>}
      </div>
      {open && hasOverdue && ar.kind === 'loaded' && (
        <div style={{ borderTop: `1px solid ${LINE}` }}>
          {/* Full overdue list (no row cap) with sortable columns. Caps the
              visible height at ~360px and scrolls -- protects against very
              long lists making the shop card 5000px tall while still showing
              everything when the user wants to dig in. */}
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full c2ui text-[12.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead><tr className="c2ui text-[12.5px] uppercase tracking-wide sticky top-0 z-10" style={{ background: 'rgba(247,244,238,0.92)', backdropFilter: 'blur(6px)' }}>
                {headCell('customer', 'Customer', 'left')}
                {headCell('balance', 'Balance', 'right')}
                {headCell('days', 'Days', 'right')}
                {headCell('ro', 'RO #', 'right')}
              </tr></thead>
              <tbody>
                {sorted.map((c, i) => (
                  <tr key={`${c.roNumber}-${i}`} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td className="px-3 py-1.5 truncate" style={{ color: INK, maxWidth: 220 }}>{c.customerName}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold" style={{ color: INK }}>{usd(c.balance)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium" style={{ color: c.daysOverdue >= 90 ? BAD : c.daysOverdue >= 60 ? WARN : INK }}>{c.daysOverdue}d</td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: INK2 }}>#{c.roNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── diagnostic callout cards ──────────────────────────────────────────────────
type CalloutLine = { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; text: React.ReactNode };
function revenueGapLines(summary: any, lwKpi: ChainKpi, d: any): CalloutLine[] {
  if (summary.lwVar >= 0) return [{ label: 'Last week revenue', tone: 'good', text: <>at/above target ({usdK(summary.lwVar)} over).</> }];
  const carCount = lwKpi.totalCars;
  const aroBenchmarkGap = Math.max(0, ARO_TARGET - d.aro);
  const carsNeeded = summary.lwGoal > 0 ? Math.ceil(summary.lwGoal / ARO_TARGET) : 0;
  const carsGap = Math.max(0, carsNeeded - carCount);
  const carsWorse = carsGap / Math.max(carsNeeded, 1) > aroBenchmarkGap / ARO_TARGET;
  if (carsWorse) return [{ label: 'Primary: car count', tone: 'bad', text: <>Short by {num(carsGap)} cars at benchmark ARO. {d.chainConv !== null && d.chainConv < CALL_CONV_TARGET * 100 ? <>Call conversion at <strong>{d.chainConv.toFixed(1)}%</strong> vs {Math.round(CALL_CONV_TARGET * 100)}% target -- phone handling / booking discipline.</> : <>Investigate inbound call volume and conversion.</>}</> }];
  return [{ label: 'Primary: ARO', tone: 'bad', text: <>ARO {usd(d.aro)} vs {usd(ARO_TARGET)} benchmark. CR {pct(d.cr)} -- {d.cr >= CR_TARGET ? 'high CR + low ARO = Easy Yes (advisors not writing enough on the ticket).' : 'low CR + low ARO = Weak Inspections (inspection depth and estimate construction).'}</> }];
}
function gpGapLines(summary: any, d: any, diag?: any): CalloutLine[] {
  if (summary.totalGpP >= GP_TARGET) return [{ label: 'GP %', tone: 'good', text: <>{pct(summary.totalGpP)} at/above {Math.round(GP_TARGET * 100)}% target.</> }];
  const partsGap = Math.max(0, PARTS_GP_TARGET - d.partsGpPct);
  const laborGap = Math.max(0, LABOR_GP_TARGET - d.laborGpPct);
  if (partsGap >= laborGap) {
    let causeText: React.ReactNode;
    if (diag) {
      const c = diag.summary.likelyCause;
      const conc = diag.summary.top5ConcentrationPct;
      const drag = diag.summary.totalDragDollars;
      if (c === 'canned-jobs') causeText = <>Diagnosis: <strong>canned job pricing</strong> -- top 5 job names account for {conc}% of the ${Math.round(drag).toLocaleString()} GP drag. Fix the matrix price on those jobs.</>;
      else if (c === 'manual-overrides') causeText = <>Diagnosis: <strong>manual price overrides</strong> -- drag is spread across {diag.summary.uniqueJobNames} job names (top 5 = {conc}%). Advisors are discounting parts individually. See breakdown below.</>;
      else causeText = <>Diagnosis: <strong>mixed</strong> -- top 5 job names = {conc}% of drag ({diag.summary.uniqueJobNames} unique jobs total). Both canned pricing and manual overrides likely. See breakdown below.</>;
    } else {
      causeText = <>Most common cause: <strong>manual parts price overrides</strong> or below-matrix canned job pricing. Loading breakdown...</>;
    }
    return [{ label: 'Primary: Parts GP', tone: 'bad', text: <>{pct(d.partsGpPct)} vs {Math.round(PARTS_GP_TARGET * 100)}% matrix midpoint. {causeText}</> }];
  }
  return [{ label: 'Primary: Labor GP', tone: 'bad', text: <>{pct(d.laborGpPct)} vs {Math.round(LABOR_GP_TARGET * 100)}% target -- operational review. Likely drivers: rate realization, discounting, warranty/comeback labor, productivity.</> }];
}
function CalloutCard({ title, lines }: { title: string; lines: CalloutLine[] }) {
  return (
    <div className="rounded-[26px] p-5" style={FROST}>
      <div className="c2ui text-[12.5px] uppercase tracking-[0.1em] font-bold mb-2" style={{ color: FAINT }}>{title}</div>
      <ul className="space-y-2">
        {lines.map((l, i) => {
          const c = l.tone === 'good' ? GOOD : l.tone === 'warn' ? WARN : l.tone === 'bad' ? BAD : FAINT;
          return <li key={i} className="flex items-start gap-2 c2ui text-[12.5px] leading-snug" style={{ color: INK2 }}><span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c }} /><div><span className="font-semibold" style={{ color: INK }}>{l.label}</span> -- {l.text}</div></li>;
        })}
      </ul>
    </div>
  );
}

// ── waterfall ──────────────────────────────────────────────────────────────
// ── Waterfall -- real cascading visualization. Each band is a vertical bar
// drawn from the previous running balance down to (running − cost), so the
// eye follows revenue cascading through costs to net profit. Pending lines
// render as dashed placeholders sized off a sensible projection so the
// composition is honest about what's known vs awaiting QuickBooks. ────────
function Waterfall({ rev, parts, labor }: { rev: number; parts: number; labor: number }) {
  // Projected placeholder costs so pending bars have a width that reads
  // (instead of zero-width hollow shells). These are sized off industry-typical
  // ratios; they're labeled "QuickBooks pending" so the user never confuses
  // them with realized values.
  const partsR = Math.round(parts);
  const laborR = Math.round(labor);
  const knownGp = rev - partsR - laborR; // GP $ before fixed costs (real)
  const projPayroll = Math.round(rev * 0.18);
  const projMarketing = Math.round(rev * 0.04);
  const projLicense = Math.round(rev * 0.05);
  const projOccupancy = Math.round(rev * 0.045);
  const projNet = Math.round(knownGp - projPayroll - projMarketing - projLicense - projOccupancy);

  type Band = { label: string; amount: number; tone: 'rev' | 'cost' | 'net'; pending?: boolean };
  const bands: Band[] = [
    { label: 'Revenue', amount: rev, tone: 'rev' },
    { label: 'Parts cost', amount: -partsR, tone: 'cost' },
    { label: 'Labor cost', amount: -laborR, tone: 'cost' },
    { label: 'Payroll', amount: -projPayroll, tone: 'cost', pending: true },
    { label: 'Marketing', amount: -projMarketing, tone: 'cost', pending: true },
    { label: 'License Fees', amount: -projLicense, tone: 'cost', pending: true },
    { label: 'Occupancy', amount: -projOccupancy, tone: 'cost', pending: true },
    { label: 'Net Profit', amount: projNet, tone: 'net', pending: true },
  ];

  // Y-scale: 0 -> revenue. Each cost band drops from running balance down by
  // its amount. The Net Profit band is the residual, drawn as a single bar
  // at the right anchored at 0.
  const H = 260, BAR_GAP = 8;
  const yMax = rev;
  const y = (v: number) => H - (Math.max(0, Math.min(yMax, v)) / yMax) * H;
  let running = 0;
  const drawn: Array<{ top: number; bottom: number; band: Band; runningAfter: number }> = [];
  for (const b of bands) {
    if (b.tone === 'rev') {
      const top = y(b.amount); const bottom = y(0);
      drawn.push({ top, bottom, band: b, runningAfter: b.amount });
      running = b.amount;
    } else if (b.tone === 'cost') {
      const beforeY = y(running); const afterY = y(running + b.amount); // amount is negative
      drawn.push({ top: beforeY, bottom: afterY, band: b, runningAfter: running + b.amount });
      running = running + b.amount;
    } else { // net -- bar from 0 -> net (positive) anchored on the right
      const top = y(b.amount); const bottom = y(0);
      drawn.push({ top, bottom, band: b, runningAfter: b.amount });
    }
  }

  const colorFor = (b: Band) => b.tone === 'rev' ? GOOD : b.tone === 'net' ? INK : '#7C8B98';

  return (
    <div className="rounded-2xl p-5" style={INSET}>
      <div className="relative" style={{ height: H + 64 }}>
        {/* horizontal baseline */}
        <div className="absolute left-0 right-0" style={{ top: H, height: 1, background: 'rgba(34,32,28,0.18)' }} />
        {/* y-axis gridlines + labels */}
        {[0, 0.5, 1].map((f) => {
          const yPx = H - f * H;
          const v = f * yMax;
          return (
            <div key={f} className="absolute left-0 right-0 flex items-center" style={{ top: yPx - 0.5 }}>
              <span className="c2ui text-[13px] tabular-nums" style={{ color: FAINT, width: 40 }}>{usdK(v)}</span>
              <span className="flex-1" style={{ height: 1, background: 'rgba(34,32,28,0.05)' }} />
            </div>
          );
        })}
        {/* the cascading bands */}
        <div className="absolute" style={{ left: 44, right: 0, top: 0, height: H, display: 'flex', gap: BAR_GAP }}>
          {drawn.map((d, i) => {
            const c = colorFor(d.band);
            const h = Math.max(3, Math.abs(d.bottom - d.top));
            const t = Math.min(d.top, d.bottom);
            return (
              <div key={i} className="relative flex-1 min-w-0">
                <div className="absolute rounded-lg" style={{ top: t, left: 0, right: 0, height: h, background: d.band.pending ? 'transparent' : `linear-gradient(180deg, ${c}cc, ${c}88)`, border: d.band.pending ? `1.5px dashed ${c}80` : '1px solid rgba(255,255,255,0.4)', opacity: d.band.pending ? 0.7 : 0.95 }} />
                {/* connecting tick between previous running balance and this one */}
                {i > 0 && d.band.tone === 'cost' && (
                  <div className="absolute" style={{ left: -BAR_GAP, top: d.top - 0.5, width: BAR_GAP, height: 1, background: 'rgba(34,32,28,0.3)' }} />
                )}
                {/* label group BELOW the bar */}
                <div className="absolute left-0 right-0 text-center" style={{ top: H + 6, lineHeight: 1.2 }}>
                  <div className="c2ui text-[12.5px] uppercase tracking-[0.1em] font-semibold truncate" style={{ color: d.band.pending ? FAINT : INK2 }}>{d.band.label}</div>
                  <div className="c2disp tabular-nums" style={{ color: d.band.tone === 'cost' ? BAD : d.band.tone === 'net' ? INK : GOOD, fontSize: 12.5 }}>
                    {d.band.tone === 'cost' ? '−' : ''}{usdK(Math.abs(d.band.amount))}
                  </div>
                  {d.band.pending && <div className="c2ui text-[13px] italic" style={{ color: FAINT }}>pending</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 c2ui text-[12.5px] leading-relaxed" style={{ color: FAINT }}>
        Revenue (left) cascades through cost bands to Net Profit (right). Parts &amp; Labor are real (from Tekmetric). Payroll, Marketing, License Fees, Occupancy and Net Profit are projected at typical ratios while the QuickBooks integration is pending -- they read as dashed placeholders.
      </div>
    </div>
  );
}

// ── HeroNumber -- editorial 2-up hero ────────────────────────────────────────
function HeroNumber({ kicker, value, goal, variance, sev, footnote }: { kicker: string; value: number; goal: number; variance: number; sev: Sev; footnote?: React.ReactNode }) {
  const pctOf = goal > 0 ? value / goal : 0;
  const score = goal > 0 ? heatScoreFromPct(pctOf) : 0.5;
  const c = heatColor(score);
  // Placement track: where actual landed in 0 -> goal × 1.1 (cap so >100% reads).
  const cap = Math.max(goal * 1.1, value);
  const fillW = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;
  const goalX = cap > 0 ? (goal / cap) * 100 : 100;
  return (
    <div className="rounded-[32px] p-7" style={FROST}>
      <div className="c2ui text-[12.5px] uppercase tracking-[0.22em] font-semibold" style={{ color: FAINT }}>{kicker}</div>
      <div className="c2disp tabular-nums leading-none mt-3" style={{ color: INK, fontSize: 44, letterSpacing: '-0.03em' }}>{usd(value)}{footnote && <sup className="c2ui" style={{ fontSize: 16, verticalAlign: 'super', letterSpacing: 0, color: FAINT, fontWeight: 600 }}>*</sup>}</div>
      <div className="mt-3 flex items-baseline gap-2 flex-wrap c2ui text-[13px]" style={{ color: INK2 }}>
        <span className="c2disp tabular-nums font-bold" style={{ color: c, fontSize: 15 }}>{variance >= 0 ? '↑ +' : '↓ '}{usdK(Math.abs(variance))}</span>
        <span>vs {usdK(goal)} goal</span>
        <span style={{ color: FAINT }}>.</span>
        <span className="c2disp tabular-nums" style={{ color: c, fontWeight: 700, fontSize: 15 }}>{(pctOf * 100).toFixed(0)}%</span>
        <span>of goal</span>
        <Pill tone={sevTone(sev)}>{SEV_LABEL[sev]}</Pill>
      </div>
      <div className="mt-5">
        <div className="relative h-3 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.08)' }}>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fillW}%`, background: heatFill(score) }} />
          <div className="absolute top-0 bottom-0 w-px" style={{ left: `${goalX}%`, background: 'rgba(34,32,28,0.55)' }} />
          <div className="absolute top-1/2 c2ui text-[13px] font-bold uppercase tracking-wider rounded px-1" style={{ left: `${goalX}%`, transform: `translate(${goalX > 80 ? '-100%' : '4px'}, -50%)`, background: 'rgba(255,255,255,0.9)', color: INK }}>Goal</div>
        </div>
      </div>
      {footnote && <div className="mt-4 c2ui text-[12.5px]" style={{ color: INK2 }}>{footnote}</div>}
    </div>
  );
}

function StatPair({ label, value, live, valueColor }: { label: string; value: string; live?: boolean; valueColor?: string }) {
  return (
    <div>
      <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em] flex items-center gap-1.5" style={{ color: FAINT }}>
        {label}
        {live && <span className="c2ui text-[13px] font-bold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{ background: 'rgba(62,156,176,0.14)', color: COOL }}>Live</span>}
      </div>
      <div className="c2disp tabular-nums leading-none mt-1.5" style={{ color: valueColor ?? INK, fontSize: 24, letterSpacing: '-0.01em' }}>{value}</div>
    </div>
  );
}
function Div() {
  return <div className="hidden sm:block self-stretch" style={{ width: 1, background: 'rgba(34,32,28,0.1)' }} />;
}

// ── PlaceholderStamp -- diagonal "PLACEHOLDER" overlay on top of a card ──────
// Used on the Waterfall + Expense Classification sections while QuickBooks
// integration is pending. The stamp is positioned absolute over the child and
// has pointer-events: none so the underlying content is still interactive.
// The wrapper adds a wash that desaturates the placeholder visualization a
// touch so it's clearly distinguishable from cards that show real data.
function PlaceholderStamp({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div style={{ filter: 'saturate(0.8) opacity(0.92)' }}>{children}</div>
      {/* The wash + stamp sit on top of the card. The wash is intentionally
          subtle so the underlying visualization is still legible -- the stamp
          is the dominant signal that this section is not real data yet. */}
      <div aria-hidden className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden" style={{ borderRadius: 26 }}>
        <div style={{ transform: 'rotate(-14deg)', padding: '10px 28px', border: '3px solid rgba(192,90,46,0.45)', borderRadius: 8, background: 'rgba(255,250,240,0.55)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', boxShadow: '0 6px 18px -8px rgba(124,72,12,0.25)' }}>
          <span className="c2disp tabular-nums" style={{ color: 'rgba(192,90,46,0.85)', fontSize: 'clamp(2.2rem, 5vw, 3.4rem)', letterSpacing: '0.06em', fontWeight: 700, textTransform: 'uppercase' }}>Placeholder</span>
        </div>
      </div>
    </div>
  );
}
