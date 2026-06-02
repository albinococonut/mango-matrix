'use client';

// Operational Diagnostics — the chain dashboard's command-center triage view.
//
// Replaces the old "KPI cards" layout. The eye walks a connected decision
// tree: WHAT is broken → WHY → what operational behavior fixes it → what
// fixing it is worth in dollars. Two trees:
//
//   Revenue Below Goal
//     ├─ Car Count problem ──► Qualified Calls │ Call Conversion
//     └─ ARO problem ──────────► Sales Effectiveness Quadrant (CR × ARO)
//
//   GP% Below Target
//     ├─ Parts GP issue ──► matrix-override doctrine
//     └─ Labor GP issue ──► operational review (no false attribution)
//
// Presentation-layer only. Same payload (chainKpi + sec extras), no new APIs.

import { Fragment, useEffect, useState } from 'react';
import {
  DollarSign, Car, Receipt, Target, Percent, CalendarCheck, RotateCcw,
  Phone, PhoneCall, Wrench, Package, AlertTriangle, ArrowRight,
} from 'lucide-react';
import { usd, usdK, num, pct } from '@/lib/format';
import type { ChainKpi, ShopKpi } from '@/lib/metrics';
import type { RangeKey } from '@/lib/dates';
import { resolveRange } from '@/lib/dates';
import { loadGoals, revenueGoalForRange, prorateRevenueGoal, weeklyMinuteProratedGoal } from '@/lib/goals';
import { SHOPS } from '@/lib/shops';

// --- Operational benchmarks (presentation-layer constants; tunable) --------

const GP_TARGET = 0.58;
const PARTS_GP_TARGET = 0.55;       // standard parts-matrix midpoint
const LABOR_GP_TARGET = 0.65;       // typical labor margin target
const CR_TARGET = 0.40;
const ARO_TARGET = 750;
const CALL_CONV_TARGET = 0.60;
// AWRO (Average Work Recommended per RO) stretch target. When close rate
// is already healthy, the lever to lift ARO further is to recommend more on
// each inspection — not push approvals higher.
const AWRO_STRETCH_TARGET = 2200;
// Approximate revenue mix used for "estimated $ lost margin" callouts.
// These are rough planning numbers, not Tekmetric-derived shares.
const PARTS_REV_MIX = 0.45;
const LABOR_REV_MIX = 0.45;

// --- Severity model --------------------------------------------------------

type Sev = 'ok' | 'watch' | 'problem' | 'critical';

const SEV: Record<Sev, { accent: string; bg: string; pillBg: string; pillFg: string; label: string }> = {
  ok:       { accent: '#10B981', bg: 'rgba(16,185,129,0.07)', pillBg: '#10B981', pillFg: '#FFFFFF', label: 'On Track' },
  watch:    { accent: '#F5A623', bg: 'rgba(245,166,35,0.09)', pillBg: '#F5A623', pillFg: '#1F2937', label: 'Watch' },
  problem:  { accent: '#E0731C', bg: 'rgba(224,115,28,0.10)', pillBg: '#E0731C', pillFg: '#FFFFFF', label: 'Problem' },
  critical: { accent: '#DC2626', bg: 'rgba(220,38,38,0.09)',  pillBg: '#DC2626', pillFg: '#FFFFFF', label: 'Critical' },
};

// pctOff = fraction below target. 0 = at target, 0.10 = 10% below.
function sevFromGap(pctOff: number): Sev {
  if (pctOff <= 0)    return 'ok';
  if (pctOff < 0.06)  return 'watch';
  if (pctOff < 0.18)  return 'problem';
  return 'critical';
}

// --- Connector primitives --------------------------------------------------

function Trunk({ h = 22 }: { h?: number }) {
  return <div className="mx-auto w-px bg-mango-line/70" style={{ height: h }} />;
}

// 2-branch fork. Mobile: trunks between stacked children. Desktop: ⊥ shape.
function Fork({ children }: { children: React.ReactNode }) {
  const kids = Array.isArray(children) ? children : [children];
  return (
    <>
      {/* Mobile: stacked with trunks */}
      <div className="md:hidden flex flex-col gap-3">
        {kids.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <Trunk h={18} />}
            <div>{c}</div>
          </Fragment>
        ))}
      </div>
      {/* Desktop: ⊥ fork with crossbar */}
      <div className="hidden md:block relative">
        {/* crossbar: spans between the centers of the two children */}
        <div className="absolute top-0 left-[25%] right-[25%] h-px bg-mango-line/70" />
        <div className="grid grid-cols-2 gap-5 pt-6">
          {kids.map((c, i) => (
            <div key={i} className="relative">
              <div className="absolute left-1/2 -top-6 w-px h-6 bg-mango-line/70 -translate-x-1/2" />
              {c}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// --- Node primitives -------------------------------------------------------

function RootNode({
  icon: Icon, kicker, title, value, statusSev, lossDollars, lossLabel, subtitle, emphasize,
}: {
  icon: any; kicker: string; title: string; value: string; statusSev: Sev;
  lossDollars?: number; lossLabel?: string; subtitle?: string; emphasize?: boolean;
}) {
  const s = SEV[statusSev];
  return (
    <div className="card !p-6 relative overflow-hidden" style={{
      background: s.bg,
      boxShadow: emphasize ? `0 0 0 2px ${s.accent}33, 0 1px 2px rgba(0,0,0,0.04)` : undefined,
    }}>
      <div className="absolute left-0 top-0 h-full w-1.5" style={{ background: s.accent }} />
      <div className="pl-2 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-mango-faint font-semibold">
            <Icon className="w-[14px] h-[14px]" style={{ color: s.accent }} />
            <span>{kicker}</span>
          </div>
          <div className="mt-1 text-[15px] font-semibold text-mango-ink leading-snug">{title}</div>
          {subtitle && <div className="text-[12px] text-mango-muted mt-0.5">{subtitle}</div>}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full whitespace-nowrap"
          style={{ color: s.pillFg, background: s.pillBg }}>{s.label}</span>
      </div>
      <div className="mt-3 pl-2 font-semibold tracking-[-0.02em] leading-tight text-mango-ink tnum text-[clamp(1.6rem,2.6vw,2.4rem)] break-words">{value}</div>
      {lossDollars !== undefined && statusSev !== 'ok' && (
        <div className="mt-2 pl-2 text-[12.5px] text-mango-ink/85">
          {lossLabel ?? 'Closing this gap is worth'} <span className="font-semibold text-mango-ink">+{usdK(lossDollars)}</span>
        </div>
      )}
    </div>
  );
}

function BranchNode({
  icon: Icon, label, value, target, statusSev, gainDollars, gainNote, doctrine, emphasize, children,
}: {
  icon: any; label: string; value: string; target?: string; statusSev: Sev;
  gainDollars?: number; gainNote?: string; doctrine?: React.ReactNode; emphasize?: boolean;
  children?: React.ReactNode;
}) {
  const s = SEV[statusSev];
  return (
    <div className="card !p-5 relative overflow-hidden h-full" style={{
      background: s.bg,
      boxShadow: emphasize ? `0 0 0 2px ${s.accent}33, 0 1px 2px rgba(0,0,0,0.04)` : undefined,
    }}>
      <div className="absolute left-0 top-0 h-full w-1.5" style={{ background: s.accent }} />
      <div className="pl-2 flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="kpi-label flex items-center gap-1.5 text-[11px]">
            <Icon className="w-[13px] h-[13px]" style={{ color: s.accent }} />
            <span className="truncate">{label}</span>
          </div>
        </div>
        <span className="text-[9.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ color: s.pillFg, background: s.pillBg }}>{s.label}</span>
      </div>
      <div className="mt-2 pl-2 flex items-end gap-2 flex-wrap">
        <div className="font-semibold tracking-[-0.02em] leading-none text-mango-ink tnum text-[clamp(1.25rem,2.1vw,1.8rem)]">{value}</div>
        {target && <div className="text-[11.5px] text-mango-muted mb-0.5">→ {target}</div>}
      </div>
      {gainDollars !== undefined && statusSev !== 'ok' && (
        <div className="mt-2 pl-2 text-[12px] text-mango-ink/85 flex items-center gap-1.5">
          <ArrowRight className="w-3 h-3 text-mango-faint" />
          <span>{gainNote ?? 'Closing this gap'} → <span className="font-semibold text-mango-ink">+{usdK(gainDollars)}</span></span>
        </div>
      )}
      {doctrine && (
        <div className="mt-3 pl-2 rounded-xl px-3 py-2 text-[11.5px] leading-snug text-mango-ink/85"
          style={{ background: 'rgba(255,255,255,0.55)', boxShadow: 'inset 0 0 0 1px rgba(31,41,55,0.06)' }}>
          {doctrine}
        </div>
      )}
      {children}
    </div>
  );
}

function LeafNode({
  icon: Icon, label, value, target, statusSev, gainDollars, gainNote,
}: {
  icon: any; label: string; value: string; target?: string; statusSev: Sev;
  gainDollars?: number; gainNote?: string;
}) {
  const s = SEV[statusSev];
  return (
    <div className="card !p-4 relative overflow-hidden h-full" style={{ background: s.bg }}>
      <div className="absolute left-0 top-0 h-full w-1" style={{ background: s.accent }} />
      <div className="pl-1.5 flex items-center justify-between gap-2 min-w-0">
        <span className="kpi-label text-[10.5px] flex items-center gap-1.5 min-w-0">
          <Icon className="w-[12px] h-[12px] flex-shrink-0" style={{ color: s.accent }} />
          <span className="truncate">{label}</span>
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap"
          style={{ color: s.pillFg, background: s.pillBg }}>{s.label}</span>
      </div>
      <div className="mt-1.5 pl-1.5 flex items-end gap-1.5 flex-wrap">
        <div className="font-semibold tracking-[-0.02em] leading-none text-mango-ink tnum text-[clamp(1.05rem,1.7vw,1.4rem)]">{value}</div>
        {target && <div className="text-[10.5px] text-mango-muted mb-0.5">→ {target}</div>}
      </div>
      {gainDollars !== undefined && statusSev !== 'ok' && (
        <div className="mt-1.5 pl-1.5 text-[11px] text-mango-ink/80">
          {gainNote ?? '+'}<span className="font-semibold text-mango-ink"> {usdK(gainDollars)}</span> opportunity
        </div>
      )}
    </div>
  );
}

// --- Sales Effectiveness Quadrant (embedded under ARO branch) --------------

type Quad = 'ideal' | 'easyYes' | 'overbuild' | 'weak';
function quadrantOf(cr: number, aro: number): Quad {
  const hCr = cr >= CR_TARGET; const hAro = aro >= ARO_TARGET;
  if (hCr && hAro) return 'ideal';
  if (hCr && !hAro) return 'easyYes';
  if (!hCr && hAro) return 'overbuild';
  return 'weak';
}
const QUAD_META: Record<Quad, { label: string; insight: string; accent: string }> = {
  ideal:     { label: 'Ideal',                 accent: '#10B981',
               insight: 'Inspections strong, presentation healthy, customers approving meaningful work.' },
  easyYes:   { label: 'Easy Yes Tickets',      accent: '#E0731C',
               insight: 'Customers are approving most quoted work, but tickets are small. Lift Average Work Recommended (AWRO) toward $2,200 per RO by writing more onto each inspection — that pulls ARO up through the same close rate.' },
  overbuild: { label: 'Presentation Friction', accent: '#CA8A04',
               insight: 'Healthy ARO but lower approvals — estimate overwhelm, financing friction, or weak prioritization at the counter.' },
  weak:      { label: 'Weak Inspections',      accent: '#DC2626',
               insight: 'Low close rate combined with weak ARO suggests insufficient estimate depth or thin vehicle discovery.' },
};

// Small, labeled 2×2 grid. The active quadrant fills in colour; everything
// else is a faded outline. Axes labeled in plain English on the perimeter.
function QuadrantGrid({ active }: { active: Quad }) {
  // Layout (HTML grid, row-major): TL → TR → BL → BR
  // Top row = HIGH CR, bottom row = LOW CR
  // Left col = LOW ARO,  right col = HIGH ARO
  const cells: { id: Quad; label: string; color: string }[] = [
    { id: 'easyYes',   label: 'EASY YES',  color: '#E0731C' },  // TL: high CR, low ARO
    { id: 'ideal',     label: 'IDEAL',     color: '#10B981' },  // TR: high CR, high ARO
    { id: 'weak',      label: 'WEAK',      color: '#DC2626' },  // BL: low CR, low ARO
    { id: 'overbuild', label: 'OVERBUILD', color: '#CA8A04' },  // BR: low CR, high ARO
  ];
  return (
    <div className="inline-flex items-stretch gap-2 select-none">
      {/* Y-axis labels */}
      <div className="flex flex-col justify-between text-[9.5px] font-bold text-mango-faint tracking-[0.06em] py-0.5">
        <span>HIGH<br/>CR</span>
        <span>LOW<br/>CR</span>
      </div>
      <div>
        <div className="grid grid-cols-2 grid-rows-2 gap-1.5 w-[210px] h-[140px]">
          {cells.map((c) => {
            const isActive = c.id === active;
            return (
              <div key={c.id}
                className="rounded-md flex items-center justify-center text-[10.5px] font-bold uppercase tracking-wide text-center px-1 relative"
                style={{
                  background: isActive ? c.color : `${c.color}10`,
                  color: isActive ? '#FFFFFF' : c.color,
                  boxShadow: isActive
                    ? `0 0 0 2px ${c.color}66, 0 1px 3px rgba(0,0,0,0.06)`
                    : `inset 0 0 0 1px ${c.color}33`,
                  opacity: isActive ? 1 : 0.65,
                }}>
                {c.label}
                {isActive && (
                  <span className="absolute -bottom-1 -right-1 inline-flex items-center gap-0.5 bg-mango-ink text-white text-[8.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shadow-sm">
                    YOU
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {/* X-axis labels */}
        <div className="flex justify-between text-[9.5px] font-bold text-mango-faint tracking-[0.06em] pt-1.5">
          <span>LOW ARO</span>
          <span>HIGH ARO</span>
        </div>
      </div>
    </div>
  );
}

function AroDiagnosticPanel({ kpi }: { kpi: ChainKpi }) {
  const cr = kpi.closeRate;
  const aro = kpi.averageAro;
  const q = quadrantOf(cr, aro);
  const meta = QUAD_META[q];
  const aroGap = Math.max(0, (ARO_TARGET - aro) / ARO_TARGET);
  const sev: Sev = q === 'ideal' ? 'ok' : q === 'overbuild' ? 'watch' : sevFromGap(aroGap);
  const s = SEV[sev];
  const dist: Record<Quad, number> = { ideal: 0, easyYes: 0, overbuild: 0, weak: 0 };
  for (const sh of kpi.byShop) dist[quadrantOf(sh.closeRate, sh.aro)]++;
  const aroLift = Math.max(0, ARO_TARGET - aro) * kpi.totalCars;
  const crHigh = cr >= CR_TARGET;
  const aroHigh = aro >= ARO_TARGET;
  // Real chain AWRO from raw job subtotals (sum of every job's $ presented /
  // RO count), aggregated across shops. Falls back to ARO/CR estimate only
  // if the backend hasn't emitted the new fields yet.
  const sumPresented = kpi.byShop.reduce((s, k) => s + (k.presentedDollars || 0), 0);
  const sumCars = kpi.byShop.reduce((s, k) => s + (k.cars || 0), 0);
  const awroReal = sumPresented > 0 && sumCars > 0 ? sumPresented / sumCars : null;
  const awro = awroReal !== null ? awroReal : (cr >= 0.05 && aro > 0 ? aro / cr : null);
  const awroGap = awro !== null ? Math.max(0, AWRO_STRETCH_TARGET - awro) : 0;
  // AWRO stretch is only meaningful when CR is healthy (otherwise lift CR first).
  const awroLift = awro !== null && awroGap > 0 && kpi.totalCars > 0 && crHigh
    ? awroGap * cr * kpi.totalCars : 0;

  return (
    <div className="card !p-5 relative overflow-hidden h-full" style={{ background: s.bg }}>
      <div className="absolute left-0 top-0 h-full w-1.5" style={{ background: s.accent }} />

      {/* Header */}
      <div className="pl-2 flex items-start justify-between gap-2 flex-wrap">
        <div className="kpi-label flex items-center gap-1.5 text-[11px]">
          <Receipt className="w-[13px] h-[13px]" style={{ color: s.accent }} />
          <span>ARO &amp; Close Rate · paired</span>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full whitespace-nowrap"
          style={{ color: '#FFFFFF', background: meta.accent }}>{meta.label}</span>
      </div>

      {/* Plain-English headline — leads the message */}
      <div className="mt-3 pl-2 text-[14px] leading-snug text-mango-ink">
        <span className="font-semibold">{plainEnglishHeadline(q)}</span>
      </div>
      <div className="mt-1 pl-2 text-[12.5px] leading-relaxed text-mango-ink/80">
        {meta.insight}
      </div>

      {/* Body: numbers + small quadrant grid */}
      <div className="mt-4 pl-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 items-start">
        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-4">
            <PairedMetric
              icon={Target}
              label="Close Rate"
              value={pct(cr)}
              targetLabel={`${Math.round(CR_TARGET * 100)}% target`}
              isHigh={crHigh}
              accent={s.accent}
            />
            <PairedMetric
              icon={Receipt}
              label="Average ARO"
              value={usd(aro)}
              targetLabel={`${usd(ARO_TARGET)} target`}
              isHigh={aroHigh}
              accent={s.accent}
            />
          </div>

          {aroLift > 0 && (
            <div className="mt-3 text-[12px] text-mango-ink/85 flex items-start gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 text-mango-faint mt-0.5 shrink-0" />
              <span>Lifting ARO to {usd(ARO_TARGET)} on current car count ≈ <span className="font-semibold text-mango-ink">+{usdK(aroLift)}</span></span>
            </div>
          )}

          {awroLift > 0 && (
            <div className="mt-2 rounded-xl px-3 py-2 text-[12px] text-mango-ink/85 flex items-start gap-2"
              style={{ background: 'rgba(14,116,144,0.08)', boxShadow: 'inset 0 0 0 1px rgba(14,116,144,0.20)' }}>
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#0E7490' }} />
              <span>
                <span className="font-semibold" style={{ color: '#0E7490' }}>AWRO stretch:</span>{' '}
                close rate is healthy — the lever is ticket size. Current AWRO is{' '}
                <span className="font-semibold">{usd(Math.round(awro!))}</span>; pushing toward{' '}
                <span className="font-semibold">{usd(AWRO_STRETCH_TARGET)}</span> per RO at current CR and car count ≈{' '}
                <span className="font-semibold text-mango-ink">+{usdK(awroLift)}</span> on top of the ARO benchmark.
              </span>
            </div>
          )}

          <div className="mt-3 text-[11px] text-mango-muted">
            How shops are distributed: <span className="text-mango-ink font-semibold">{dist.ideal}</span> Ideal ·{' '}
            <span className="text-mango-ink font-semibold">{dist.easyYes}</span> Easy Yes ·{' '}
            <span className="text-mango-ink font-semibold">{dist.overbuild}</span> Overbuild ·{' '}
            <span className="text-mango-ink font-semibold">{dist.weak}</span> Weak
          </div>
        </div>

        {/* Small labeled quadrant grid */}
        <div className="flex flex-col items-center md:items-start gap-2">
          <div className="text-[10px] uppercase tracking-wide text-mango-faint font-bold">CR × ARO map</div>
          <QuadrantGrid active={q} />
        </div>
      </div>
    </div>
  );
}

function plainEnglishHeadline(q: Quad): string {
  switch (q) {
    case 'ideal':     return 'Quoted work is converting and tickets are healthy.';
    case 'easyYes':   return 'Most quoted work is approving — but tickets are small.';
    case 'overbuild': return 'Ticket sizes are healthy — but customers are not approving.';
    case 'weak':      return 'Both ticket size and approval rate are weak.';
  }
}

function PairedMetric({
  icon: Icon, label, value, targetLabel, isHigh, accent,
}: { icon: any; label: string; value: string; targetLabel: string; isHigh: boolean; accent: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5"
      style={{ background: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 0 0 1px rgba(31,41,55,0.07)' }}>
      <div className="text-[10.5px] uppercase tracking-wide text-mango-muted font-semibold flex items-center gap-1.5">
        <Icon className="w-[12px] h-[12px] text-mango-faint" /> {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
        <div className="font-semibold tracking-[-0.02em] text-mango-ink tnum text-[clamp(1.3rem,2.1vw,1.8rem)] leading-none">{value}</div>
        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap"
          style={{ color: isHigh ? '#065F46' : '#991B1B', background: isHigh ? 'rgba(16,185,129,0.15)' : 'rgba(220,38,38,0.12)' }}>
          {isHigh ? 'HIGH ↑' : 'LOW ↓'}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-mango-muted">vs {targetLabel}</div>
    </div>
  );
}

// --- Section heading -------------------------------------------------------

function DiagnosticHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3 flex-wrap">
      <h3 className="text-[15px] font-semibold text-mango-ink tracking-tight">{title}</h3>
      {sub && <span className="text-[11.5px] text-mango-muted">{sub}</span>}
    </div>
  );
}

// Sub-header that visually anchors a full-width drill-down back to its branch.
function DrillHeader({ branch, question }: { branch: string; question: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[12px] leading-tight">
      <span className="text-mango-faint">↳</span>
      <span className="uppercase tracking-[0.06em] font-semibold text-mango-faint text-[10.5px]">{branch} drill-down</span>
      <span className="text-mango-muted">· {question}</span>
    </div>
  );
}

// --- Main component --------------------------------------------------------

export default function KpiCards({ kpi, range = 'this_week' }: { kpi: ChainKpi | null; range?: RangeKey }) {
  const [sec, setSec] = useState<{ rebookPct: number; comebacks: number; conversion: number; eligible: number } | null>(null);
  // dataAt is the instant the kpi prop most recently arrived. Used as the
  // proration "now" so the prorated goal denominator is locked to the same
  // moment as the revenue numerator — matches WeeklyLeaderboard's behavior.
  const [dataAt, setDataAt] = useState<Date | null>(null);
  useEffect(() => { if (kpi) setDataAt(new Date()); }, [kpi]);

  useEffect(() => {
    const safe = async (u: string) => { try { const r = await fetch(u); if (!r.ok) return null; return await r.json(); } catch { return null; } };
    Promise.all([
      safe('/api/fbr?view=leaderboard'),
      safe(`/api/extras?view=comebacks&range=${range}`),
      safe('/api/extras?view=booked-rate&strict=1'),
    ]).then(([fbr, cb, bk]) => {
      const shops = fbr?.shops || [];
      const fbE = shops.reduce((s: number, r: any) => s + (r.fbr?.eligibleROs || 0), 0);
      const fbB = shops.reduce((s: number, r: any) => s + (r.fbr?.forwardBookedROs || 0), 0);
      setSec({
        rebookPct: fbE > 0 ? (fbB / fbE) * 100 : 0,
        comebacks: (cb?.shops || []).reduce((s: number, r: any) => s + (r.revenueLost || 0), 0),
        conversion: bk?.chain?.bookedRatePct ?? 0,
        eligible: bk?.chain?.eligible ?? 0,
      });
    });
  }, [range]);

  if (!kpi) {
    return (
      <div className="grid gap-4 mb-8 grid-cols-1 md:grid-cols-2">
        {[1, 2].map((i) => <div key={i} className="card h-[260px] animate-pulse" />)}
      </div>
    );
  }

  // --- Derived metrics ----------------------------------------------------
  const rev = kpi.totalRevenue;
  const cars = kpi.totalCars;
  const aro = kpi.averageAro;
  const chainGp$ = kpi.byShop.reduce((s, k) => s + (k.gpDollars || 0), 0);
  const chainGpPct = rev ? chainGp$ / rev : 0;

  // Revenue-weighted chain parts/labor GP (rough, since payload exposes only %).
  const partsGpPct = rev ? kpi.byShop.reduce((s, k) => s + (k.partsGpPct || 0) * (k.revenue || 0), 0) / rev : 0;
  const laborGpPct = rev ? kpi.byShop.reduce((s, k) => s + (k.laborGpPct || 0) * (k.revenue || 0), 0) / rev : 0;

  // Revenue goal (prorated). For range='this_week' we use minute-level
  // proration per shop and sum — same math as WeeklyLeaderboard, so the
  // two views agree exactly. Per-shop summing also honors Yuma's
  // America/Phoenix timezone vs America/Denver for everyone else. For other
  // ranges (this_month / this_quarter / this_year) day-level proration is
  // sufficient — single-day misalignment is a small % of those windows.
  const goals = loadGoals();
  const win = resolveRange(range);
  let fullGoal = 0;
  let proratedGoal = 0;
  for (const s of SHOPS) {
    const g = revenueGoalForRange(goals[s.num], range);
    if (!g) continue;
    fullGoal += g;
    if (range === 'this_week' && dataAt) {
      proratedGoal += weeklyMinuteProratedGoal(s.num, g, dataAt);
    } else {
      proratedGoal += prorateRevenueGoal(g, range, win.start, win.end);
    }
  }
  const gap = proratedGoal > 0 ? Math.max(0, proratedGoal - rev) : 0;
  const pctToGoal = proratedGoal > 0 ? rev / proratedGoal : null;
  const revPctOff = pctToGoal === null ? 0 : Math.max(0, 1 - pctToGoal);
  const revSev: Sev = pctToGoal === null ? 'watch' : sevFromGap(revPctOff);

  // Car-count target (cars needed to hit goal at benchmark ARO).
  const carsTarget = proratedGoal > 0 ? Math.ceil(proratedGoal / ARO_TARGET) : 0;
  const carsGap = Math.max(0, carsTarget - cars);
  const carsPctOff = carsTarget > 0 ? carsGap / carsTarget : 0;
  const carsSev: Sev = carsTarget === 0 ? 'watch' : sevFromGap(carsPctOff);
  const carsLift = carsGap > 0 && aro > 0 ? carsGap * aro : 0;

  // ARO target severity (vs benchmark $750).
  const aroPctOff = Math.max(0, (ARO_TARGET - aro) / ARO_TARGET);
  const aroSev: Sev = sevFromGap(aroPctOff);

  // Which revenue branch is the dominant bottleneck (for emphasize ring)?
  const carsWorse = carsPctOff >= aroPctOff;

  // Qualified calls + conversion severity.
  const eligible = sec?.eligible ?? 0;
  const conv = sec ? sec.conversion / 100 : 0;
  const convPctOff = sec ? Math.max(0, (CALL_CONV_TARGET - conv) / CALL_CONV_TARGET) : 0;
  const convSev: Sev = !sec ? 'watch' : sevFromGap(convPctOff);
  const convLift = sec && convPctOff > 0 && eligible > 0 && aro > 0
    ? (CALL_CONV_TARGET - conv) * eligible * aro : 0;
  // Qualified calls: no chain target — surface as a volume signal only.
  const callsSev: Sev = 'watch';

  // GP severities.
  const gpPctOff = Math.max(0, (GP_TARGET - chainGpPct) / GP_TARGET);
  const gpSev: Sev = sevFromGap(gpPctOff);
  const gpLossDollars = Math.max(0, GP_TARGET - chainGpPct) * rev;

  const partsPctOff = Math.max(0, (PARTS_GP_TARGET - partsGpPct) / PARTS_GP_TARGET);
  const partsSev: Sev = sevFromGap(partsPctOff);
  const partsLift = Math.max(0, PARTS_GP_TARGET - partsGpPct) * rev * PARTS_REV_MIX;

  const laborPctOff = Math.max(0, (LABOR_GP_TARGET - laborGpPct) / LABOR_GP_TARGET);
  const laborSev: Sev = sevFromGap(laborPctOff);
  const laborLift = Math.max(0, LABOR_GP_TARGET - laborGpPct) * rev * LABOR_REV_MIX;

  const partsWorse = partsPctOff >= laborPctOff;

  // --- Render -------------------------------------------------------------
  return (
    <div data-fs-section className="mb-8 relative">
      <div className="mb-4">
        <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-mango-faint">Operational Diagnostics</div>
        <div className="text-[12.5px] text-mango-muted mt-0.5">What's broken → why → what fixing it is worth.</div>
      </div>

      {/* ---------- REVENUE TREE ---------- */}
      <div className="mb-7">
        <DiagnosticHeader title="Revenue diagnostic" />
        <RootNode
          icon={DollarSign}
          kicker="Root"
          title={pctToGoal === null ? 'Revenue · no goal set' : pctToGoal >= 1 ? 'Revenue at or above goal' : 'Revenue below goal'}
          value={usd(rev)}
          subtitle={pctToGoal !== null
            ? `${(pctToGoal * 100).toFixed(0)}% of ${usd(proratedGoal)} prorated goal`
            : 'no goal configured for this range'}
          statusSev={revSev}
          lossDollars={gap > 0 ? gap : undefined}
          lossLabel="Gap to goal"
          emphasize
        />
        <Trunk />
        <Fork>
          <BranchNode
            icon={Car}
            label="Car count"
            value={num(cars)}
            target={carsTarget > 0 ? `${num(carsTarget)} at ${usd(ARO_TARGET)} ARO` : undefined}
            statusSev={carsSev}
            gainDollars={carsLift > 0 ? carsLift : undefined}
            gainNote={carsGap > 0 ? `+${num(carsGap)} cars at current ARO` : undefined}
            emphasize={carsWorse && carsSev !== 'ok' && revSev !== 'ok'}
            doctrine={carsSev !== 'ok' ? (
              <>Car-count gaps are <span className="font-semibold">either inbound volume or conversion</span> — see drill-down below.</>
            ) : undefined}
          />
          <BranchNode
            icon={Receipt}
            label="ARO"
            value={usd(aro)}
            target={`${usd(ARO_TARGET)} benchmark`}
            statusSev={aroSev}
            emphasize={!carsWorse && aroSev !== 'ok' && revSev !== 'ok'}
            doctrine={aroSev !== 'ok' ? (
              <>ARO weakness = inspection depth or write-up quality. Never evaluated alone — see CR × ARO drill-down below.</>
            ) : undefined}
          />
        </Fork>

        {/* Drill-down: Car count → calls + conversion (full width) */}
        <div className="mt-6">
          <DrillHeader branch="Car count" question="Where's the leak — inbound volume or conversion?" />
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <LeafNode
              icon={Phone}
              label="Qualified calls"
              value={sec ? num(eligible) : '…'}
              statusSev={callsSev}
              target="upstream volume signal"
            />
            <LeafNode
              icon={PhoneCall}
              label="Call conversion"
              value={sec ? `${sec.conversion.toFixed(1)}%` : '…'}
              target={`${Math.round(CALL_CONV_TARGET * 100)}% top-quartile`}
              statusSev={convSev}
              gainDollars={convLift > 0 ? convLift : undefined}
              gainNote="To target"
            />
          </div>
          <p className="mt-2 text-[11.5px] text-mango-faint leading-snug">
            Low calls = upstream marketing or capacity issue (rarer). Low conversion = phone handling, speed-to-answer, or booking discipline (more common).
          </p>
        </div>

        {/* Drill-down: ARO × Close Rate (full width — the quadrant breathes here) */}
        <div className="mt-6">
          <DrillHeader branch="ARO" question="Why is ARO weak? Close Rate × ARO paired diagnosis." />
          <AroDiagnosticPanel kpi={kpi} />
        </div>
      </div>

      {/* ---------- GROSS PROFIT TREE ---------- */}
      <div className="mb-7">
        <DiagnosticHeader title="Gross profit diagnostic" sub="GP% = Parts GP and Labor GP, blended" />
        <RootNode
          icon={Percent}
          kicker="Root"
          title={chainGpPct >= GP_TARGET ? 'GP at or above target' : 'GP% below target'}
          value={pct(chainGpPct)}
          subtitle={`vs ${Math.round(GP_TARGET * 100)}% company target`}
          statusSev={gpSev}
          lossDollars={gpLossDollars > 0 ? gpLossDollars : undefined}
          lossLabel="Gap to target ="
          emphasize
        />
        <Trunk />
        <Fork>
          <BranchNode
            icon={Package}
            label="Parts GP"
            value={pct(partsGpPct)}
            target={`${Math.round(PARTS_GP_TARGET * 100)}% matrix midpoint`}
            statusSev={partsSev}
            gainDollars={partsLift > 0 ? partsLift : undefined}
            gainNote="Parts at matrix"
            emphasize={partsWorse && partsSev !== 'ok' && gpSev !== 'ok'}
            doctrine={partsSev !== 'ok' ? (
              <>
                <span className="font-semibold">Parts GP below target.</span> Most common cause is{' '}
                <span className="font-semibold">manual parts price overrides</span> instead of standard matrix pricing.
                The standard matrix should be used unless the job is a canned job.
              </>
            ) : (
              <>Parts pricing is at or above the matrix midpoint. Maintain matrix discipline; flag canned-job exceptions.</>
            )}
          />
          <BranchNode
            icon={Wrench}
            label="Labor GP"
            value={pct(laborGpPct)}
            target={`${Math.round(LABOR_GP_TARGET * 100)}% target`}
            statusSev={laborSev}
            gainDollars={laborLift > 0 ? laborLift : undefined}
            gainNote="Labor to target"
            emphasize={!partsWorse && laborSev !== 'ok' && gpSev !== 'ok'}
            doctrine={laborSev !== 'ok' ? (
              <>
                <span className="font-semibold">Labor GP below target — operational review needed.</span> Possible drivers:
                rate realization, excessive discounting, warranty/comeback labor, productivity, or clocking leakage.
                Detailed attribution requires deeper data than this view exposes.
              </>
            ) : (
              <>Labor margin healthy. Keep an eye on warranty &amp; discount drift.</>
            )}
          />
        </Fork>
      </div>

      {/* ---------- OPERATIONAL SIGNALS (supporting metrics) ---------- */}
      <div>
        <DiagnosticHeader title="Operational signals" sub="Supporting metrics outside the diagnostic tree" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <LeafNode
            icon={RotateCcw}
            label="Comebacks $ lost"
            value={sec ? usd(Math.round(sec.comebacks)) : '…'}
            statusSev={sec && sec.comebacks > 0 ? 'watch' : 'ok'}
            target="margin shield"
            gainDollars={sec && sec.comebacks > 0 ? sec.comebacks : undefined}
            gainNote="Eliminating protects"
          />
          <LeafNode
            icon={CalendarCheck}
            label="Re-book %"
            value={sec ? `${sec.rebookPct.toFixed(1)}%` : '…'}
            statusSev="watch"
            target="future pipeline · 4–6 months out"
          />
        </div>
        <p className="mt-3 text-[11px] text-mango-faint leading-relaxed">
          Re-book % builds workload that arrives months later — it doesn't fix today's revenue.
          Comebacks erode labor margin and CSI rather than current-week volume.
        </p>
      </div>
    </div>
  );
}
