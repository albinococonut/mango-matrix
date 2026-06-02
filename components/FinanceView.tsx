'use client';

// Finance View — corporate weekly operational review system.
//
// Built around the MightyMangos baseline finance spreadsheet workflow:
//   1. Top summary  : LW + MTD vs goal, GP%, Parts GP%, A/R total + >30 (live)
//   2. Shop-by-shop : MAIN section — per-shop card with Revenue performance
//                     (LW + MTD), monthly pace bullet, Gross Profit panel
//                     (Total GP% primary, Parts/Labor secondary), Ops row
//                     (Approved Sales · ARO · Car Count · Rev/Bay/Week · Rev/Bay/Year),
//                     and live A/R strip + overdue customer expander
//   3. Diagnostic   : compact callouts (revenue + GP) — secondary
//   4. AR section   : the existing <AccountsReceivable/> component (shared)
//   5. Waterfall    : bottom, mostly QuickBooks-pending placeholders
//   6. Expense Class: bottom, mostly QuickBooks-pending placeholders
//
// Design language: neutral white cards, thin borders. Color is reserved for
// severity (pills, variance numbers, monthly pace bar). Hierarchy comes from
// size + spacing + typography, not chroma.
//
// Static weekly snapshot — locked to last_week + this_month. A/R is the only
// live section per spec.

import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, AlertTriangle, Calendar, Landmark, Package, Wrench,
  DollarSign, Percent, ChevronDown, ChevronUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usd, usdK, num, pct } from '@/lib/format';
import type { ChainKpi, ShopKpi } from '@/lib/metrics';
import { resolveRange } from '@/lib/dates';
import { loadGoals, revenueGoalForRange, prorateRevenueGoal } from '@/lib/goals';
import { SHOPS, ShopNum } from '@/lib/shops';
import AccountsReceivable from '@/components/AccountsReceivable';

// --- Benchmarks ------------------------------------------------------------

const GP_TARGET = 0.58;
const PARTS_GP_TARGET = 0.55;
const LABOR_GP_TARGET = 0.65;
const ARO_TARGET = 750;
const CR_TARGET = 0.40;
const CALL_CONV_TARGET = 0.60;
const WEEKS_PER_YEAR = 52;

// --- Severity --------------------------------------------------------------

type Sev = 'ok' | 'watch' | 'problem' | 'critical';
const SEV: Record<Sev, { accent: string; pillBg: string; pillFg: string; label: string; text: string }> = {
  ok:       { accent: '#10B981', pillBg: '#10B981', pillFg: '#FFFFFF', label: 'Healthy',  text: 'text-mango-green' },
  watch:    { accent: '#F5A623', pillBg: '#F5A623', pillFg: '#1F2937', label: 'Watch',    text: 'text-mango-amber' },
  problem:  { accent: '#E0731C', pillBg: '#E0731C', pillFg: '#FFFFFF', label: 'Problem',  text: 'text-mango-red' },
  critical: { accent: '#DC2626', pillBg: '#DC2626', pillFg: '#FFFFFF', label: 'Critical', text: 'text-mango-red' },
};
function paceSev(pctOfTarget: number | null): Sev {
  if (pctOfTarget === null) return 'watch';
  if (pctOfTarget >= 1.00) return 'ok';
  if (pctOfTarget >= 0.95) return 'watch';
  if (pctOfTarget >= 0.80) return 'problem';
  return 'critical';
}
function gpSev(gp: number, target: number): Sev {
  const gap = (target - gp) / target;
  if (gap <= 0) return 'ok';
  if (gap < 0.04) return 'watch';
  if (gap < 0.10) return 'problem';
  return 'critical';
}
function arSev(over30: number): Sev {
  if (over30 < 1000) return 'ok';
  if (over30 < 10000) return 'watch';
  if (over30 < 25000) return 'problem';
  return 'critical';
}

// --- AR data shape (from /api/exec-metrics?view=ar&mode=total) ------------

interface ARCustomer {
  customerId: number;
  customerName: string;
  shopNum: string;
  shopName: string;
  roNumber: number;
  invoiceDate: string;
  daysOverdue: number;
  balance: number;
  totalOwedByCustomer: number;
}
interface ARSummary {
  total: number;
  count: number;
  byShop: { shopNum: string; shopName: string; amount: number; count: number }[];
}
interface ARPayload { summary: ARSummary; customers: ARCustomer[] }

// --- Per-shop AR state (loading / no-data / loaded) ------------------------

type ShopARState =
  | { kind: 'loading' }
  | { kind: 'no-data' }
  | { kind: 'loaded'; total: number; over30: number; customers: ARCustomer[] };

// --- Atoms (neutral by default — color used only where it matters) --------

function Pill({ sev, label }: { sev: Sev; label?: string }) {
  const s = SEV[sev];
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ color: s.pillFg, background: s.pillBg }}>{label ?? s.label}</span>
  );
}

function SectionHeader({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <div className="mb-5">
      {kicker && <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-mango-muted mb-1">{kicker}</div>}
      <h2 className="text-[20px] sm:text-[22px] font-semibold tracking-tight text-mango-ink">{title}</h2>
      {sub && <p className="text-[12.5px] text-mango-muted mt-1 leading-snug">{sub}</p>}
    </div>
  );
}

// --- Top summary tile (neutral white card; severity only on pill + variance)

interface SummaryTile {
  label: string; value: string; target?: string;
  variance?: string; varianceTone?: 'good' | 'bad' | 'neutral';
  sev: Sev; icon: any; liveBadge?: boolean;
}

function TopSummary({ tiles }: { tiles: SummaryTile[] }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.label}
          className="rounded-3xl bg-white border border-mango-line/60 p-4 transition hover:shadow-sm">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="text-[10.5px] uppercase tracking-wide font-semibold text-mango-muted flex items-center gap-1.5 min-w-0">
              <t.icon className="w-[12px] h-[12px] flex-shrink-0 text-mango-faint" />
              <span className="truncate">{t.label}</span>
            </span>
            {t.liveBadge ? (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-mango-bg text-mango-muted whitespace-nowrap flex-shrink-0">Live</span>
            ) : (
              <span className="flex-shrink-0"><Pill sev={t.sev} /></span>
            )}
          </div>
          <div className="mt-2.5 font-semibold tracking-[-0.02em] leading-tight text-mango-ink tnum text-[clamp(1.4rem,2.2vw,2rem)] break-words">
            {t.value}
          </div>
          {t.target && <div className="mt-2 text-[12px] text-mango-muted leading-snug">{t.target}</div>}
          {t.variance && (
            <div className={`mt-0.5 text-[12.5px] font-semibold leading-snug ${
              t.varianceTone === 'good' ? 'text-mango-green' :
              t.varianceTone === 'bad' ? 'text-mango-red' : 'text-mango-ink'}`}>{t.variance}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Per-shop row ----------------------------------------------------------

interface ShopRow {
  shopNum: string; shopName: string; bays: number;
  // Last week
  lwActual: number; lwTarget: number; lwVar: number; lwPct: number | null; lwSev: Sev;
  // MTD (working-day prorated target)
  mtdActual: number; mtdTarget: number; mtdFullMonth: number;
  mtdVar: number; mtdPct: number | null; mtdSev: Sev;
  mtdFullPct: number; mtdExpectedPct: number;
  // Margin — Total GP% primary; Parts/Labor secondary
  gpPct: number; gpSev_: Sev;
  partsGpPct: number; laborGpPct: number;
  // GP dollar goals (Revenue Goal × 58%)
  lwGpActual: number; lwGpGoal: number;
  mtdGpActual: number; mtdGpGoal: number;
  // Full-month GP $ runway — the right-edge anchor on both per-shop bars.
  fullMonthGpGoal: number;
  // Operations
  approvedSales: number; aro: number; carCount: number;
  revPerBayPerWeek: number; revPerBayPerYear: number;
  // AR (live)
  ar: ShopARState;
}

// --- Shop card -------------------------------------------------------------

function ShopCard({ row, mtdRangeLabel }: { row: ShopRow; mtdRangeLabel: string }) {
  const [open, setOpen] = useState(false);
  const hasOverdue = row.ar.kind === 'loaded' && row.ar.customers.length > 0;

  return (
    <div className="rounded-3xl bg-white border border-mango-line/60 overflow-hidden transition hover:shadow-sm">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div className="min-w-0">
            <div className="text-[18px] sm:text-[20px] font-semibold text-mango-ink tracking-tight">{row.shopName}</div>
            <div className="text-[11px] text-mango-muted">Shop {row.shopNum} · {row.bays} bays</div>
          </div>
          <div className="flex items-center gap-2">
            <Pill sev={row.lwSev} label={`LW ${row.lwPct !== null ? `${(row.lwPct * 100).toFixed(0)}%` : '—'}`} />
            <Pill sev={row.mtdSev} label={`MTD ${row.mtdPct !== null ? `${(row.mtdPct * 100).toFixed(0)}%` : '—'}`} />
          </div>
        </div>

        {/* REVENUE — two stacked blocks (LW + MTD) */}
        <SubSectionLabel>Revenue</SubSectionLabel>
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 mb-3">
          <RevenueBlock title="Last Week" actual={row.lwActual} target={row.lwTarget} variance={row.lwVar} pct={row.lwPct} />
          <RevenueBlock title={`Month-to-Date · ${mtdRangeLabel}`} actual={row.mtdActual} target={row.mtdTarget} variance={row.mtdVar} pct={row.mtdPct} extra={`vs ${usdK(row.mtdFullMonth)} full-month goal`} />
        </div>
        <MonthlyPaceBar
          actualPct={row.mtdFullPct} expectedPct={row.mtdExpectedPct}
          actualLabel={usdK(row.mtdActual)} expectedLabel={usdK(row.mtdTarget)} fullLabel={usdK(row.mtdFullMonth)}
        />

        {/* GROSS PROFIT — Total primary, GP $ bullet bars (same as chain panel), Parts/Labor secondary */}
        <SubSectionLabel className="mt-6">Gross Profit</SubSectionLabel>
        <div className="rounded-2xl border border-mango-line/60 p-4">
          {/* Total GP% — headline */}
          <div className="flex items-end gap-3 flex-wrap mb-4">
            <div>
              <div className="text-[10.5px] uppercase tracking-wide text-mango-muted font-semibold">Total GP %</div>
              <div className="mt-1 font-semibold tnum text-mango-ink tracking-[-0.02em] leading-none text-[clamp(1.4rem,2.2vw,1.9rem)]">{pct(row.gpPct)}</div>
            </div>
            <Pill sev={row.gpSev_} />
            <span className="text-[11px] text-mango-muted">target {Math.round(GP_TARGET * 100)}%</span>
          </div>

          {/* GP $ bullet bars — same component as chain-level chart.
              Last Week: tight scale (target × 1.1), only TARGET marker.
              Month-to-Date: full-month scale, TARGET + FULL MO markers. */}
          <div className="space-y-3">
            <BigGpBar
              label="Last Week GP $"
              actual={row.lwGpActual}
              target={row.lwGpGoal}
              compact
            />
            <BigGpBar
              label="Month-to-Date GP $"
              actual={row.mtdGpActual}
              target={row.mtdGpGoal}
              fullMonthGoal={row.fullMonthGpGoal}
              compact
            />
          </div>

          {/* Secondary: Parts + Labor chips */}
          <div className="mt-4 pt-3 border-t border-mango-line/40 flex items-center gap-4 flex-wrap text-[12px] text-mango-muted">
            <span>Parts GP <span className="font-semibold text-mango-ink tnum">{pct(row.partsGpPct)}</span><span className="text-[10.5px] text-mango-faint"> / {Math.round(PARTS_GP_TARGET * 100)}%</span></span>
            <span className="text-mango-line">·</span>
            <span>Labor GP <span className="font-semibold text-mango-ink tnum">{pct(row.laborGpPct)}</span><span className="text-[10.5px] text-mango-faint"> / {Math.round(LABOR_GP_TARGET * 100)}%</span></span>
          </div>
        </div>

        {/* OPERATIONS — neutral metrics, no color */}
        <SubSectionLabel className="mt-5">Operations · last week</SubSectionLabel>
        <div className="rounded-2xl border border-mango-line/60 p-3">
          <div className="grid gap-x-4 gap-y-3 grid-cols-2 sm:grid-cols-4">
            <NeutralMetric label="Approved Sales" value={usdK(row.approvedSales)} />
            <NeutralMetric label="ARO" value={usd(row.aro)} />
            <NeutralMetric label="Car Count" value={num(row.carCount)} />
            <NeutralMetric label="Rev / Bay / Wk" value={usdK(row.revPerBayPerWeek)} />
          </div>
          <div className="mt-2.5 pt-2.5 border-t border-mango-line/40 text-[12px] text-mango-muted">
            Annualized productivity · <span className="font-semibold text-mango-ink tnum">{usdK(row.revPerBayPerYear)}</span> revenue / bay / year
            <span className="text-mango-faint"> (last week × 52)</span>
          </div>
        </div>

        {/* AR — live (only severity-tinted thing in card body when there's an issue) */}
        <SubSectionLabel className="mt-5">A/R · live</SubSectionLabel>
        <ARStrip ar={row.ar} hasOverdue={hasOverdue} open={open} setOpen={setOpen} />
      </div>
    </div>
  );
}

function SubSectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[10.5px] uppercase tracking-[0.1em] font-semibold text-mango-muted mb-2 ${className ?? ''}`}>{children}</div>
  );
}

function RevenueBlock({
  title, actual, target, variance, pct: pctVal, extra,
}: { title: string; actual: number; target: number; variance: number; pct: number | null; extra?: string }) {
  return (
    <div className="rounded-2xl border border-mango-line/60 px-3 py-3 bg-white">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10.5px] uppercase tracking-wide text-mango-muted font-semibold">{title}</span>
        <span className="text-[11px] font-bold tnum text-mango-ink">{pctVal !== null ? `${(pctVal * 100).toFixed(0)}%` : '—'} of goal</span>
      </div>
      <div className="font-semibold tnum text-mango-ink text-[clamp(1.1rem,1.6vw,1.45rem)] leading-tight">{usd(actual)}</div>
      <div className="text-[11.5px] text-mango-muted mt-0.5">Target {usdK(target)}</div>
      <div className={`text-[12px] font-semibold mt-0.5 ${variance >= 0 ? 'text-mango-green' : 'text-mango-red'}`}>
        {variance >= 0 ? `↑ +${usdK(variance)}` : `↓ ${usdK(variance)}`}
      </div>
      {extra && <div className="text-[11px] text-mango-faint mt-0.5">{extra}</div>}
    </div>
  );
}

function NeutralMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-mango-muted font-semibold leading-none mb-1">{label}</div>
      <div className="font-semibold tnum text-mango-ink text-[14px]">{value}</div>
    </div>
  );
}

function MonthlyPaceBar({
  actualPct, expectedPct, actualLabel, expectedLabel, fullLabel,
}: { actualPct: number; expectedPct: number; actualLabel: string; expectedLabel: string; fullLabel: string }) {
  const cap = 1.10;
  const actualW = Math.min(actualPct, cap) / cap * 100;
  const expectedX = Math.min(expectedPct, cap) / cap * 100;
  const onPace = actualPct >= expectedPct * 0.95;
  const fillColor = actualPct >= 1
    ? 'linear-gradient(90deg,#10B98155,#10B98199)'
    : onPace
    ? 'linear-gradient(90deg,#F5A62355,#F5A62399)'
    : 'linear-gradient(90deg,#E0731C66,#DC262699)';
  return (
    <div>
      <div className="flex items-center justify-between text-[10.5px] uppercase tracking-wide font-semibold text-mango-muted mb-1.5">
        <span>Monthly pace</span>
        <span className={onPace ? 'text-mango-green' : 'text-mango-red'}>
          {onPace ? 'on pace' : 'behind pace'} · {(actualPct * 100).toFixed(0)}% of full goal
        </span>
      </div>
      <div className="relative h-5 rounded-md bg-mango-bg/70 overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-md transition-all" style={{ width: `${actualW}%`, background: fillColor }} />
        <div className="absolute top-0 bottom-0 w-px bg-mango-ink/80" style={{ left: `${100 / cap}%` }} />
        <div className="absolute top-0 bottom-0 w-[2px] bg-mango-amber" style={{ left: `${expectedX}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10.5px] mt-1.5 text-mango-muted">
        <span>Actual <span className="font-semibold text-mango-ink">{actualLabel}</span></span>
        <span>Projected MTD <span className="font-semibold text-mango-ink">{expectedLabel}</span></span>
        <span>Full month <span className="font-semibold text-mango-ink">{fullLabel}</span></span>
      </div>
    </div>
  );
}

function ARStrip({
  ar, hasOverdue, open, setOpen,
}: { ar: ShopARState; hasOverdue: boolean; open: boolean; setOpen: (v: boolean) => void }) {
  if (ar.kind === 'loading') {
    return (
      <div className="rounded-2xl border border-mango-line/60 px-3 py-3 text-[12px] text-mango-muted bg-white">
        Loading A/R…
      </div>
    );
  }
  if (ar.kind === 'no-data') {
    return (
      <div className="rounded-2xl border border-mango-line/60 px-3 py-3 text-[12px] text-mango-muted bg-white flex items-center gap-2">
        <Landmark className="w-[12px] h-[12px] text-mango-faint" />
        <span>No outstanding A/R found.</span>
      </div>
    );
  }
  const sev = arSev(ar.over30);
  const showColor = sev === 'problem' || sev === 'critical';
  return (
    <div className="rounded-2xl border border-mango-line/60 bg-white">
      <div className="px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap text-[12.5px]">
          <span className="text-mango-ink"><span className="font-semibold tnum">{usd(ar.total)}</span> <span className="text-mango-muted">total</span></span>
          <span className="text-mango-line">·</span>
          <span className={showColor ? 'text-mango-red' : 'text-mango-ink'}>
            <span className="font-semibold tnum">{usd(ar.over30)}</span> <span className="text-mango-muted">&gt; 30d</span>
          </span>
          {ar.customers.length > 0 && (
            <>
              <span className="text-mango-line">·</span>
              <span className="text-mango-muted">{ar.customers.length} overdue {ar.customers.length === 1 ? 'invoice' : 'invoices'}</span>
            </>
          )}
        </div>
        {hasOverdue && (
          <button onClick={() => setOpen(!open)}
            className="text-[11.5px] text-mango-ink hover:text-mango-orange font-medium flex items-center gap-1">
            {open ? <>Hide <ChevronUp className="w-3 h-3" /></> : <>Show overdue <ChevronDown className="w-3 h-3" /></>}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && hasOverdue && ar.kind === 'loaded' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="border-t border-mango-line/50">
              <table className="w-full text-[12.5px]">
                <thead className="bg-mango-bg/40 text-[10.5px] uppercase tracking-wide text-mango-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Customer</th>
                    <th className="text-right px-2 py-2 font-semibold">Balance</th>
                    <th className="text-right px-2 py-2 font-semibold">Days</th>
                    <th className="text-right px-3 py-2 font-semibold">RO #</th>
                  </tr>
                </thead>
                <tbody>
                  {ar.customers.slice(0, 12).map((c, i) => (
                    <tr key={`${c.roNumber}-${i}`} className="border-t border-mango-line/40">
                      <td className="px-3 py-1.5 text-mango-ink truncate max-w-[220px]">{c.customerName}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-mango-ink">{usd(c.balance)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${
                        c.daysOverdue >= 90 ? 'text-mango-red' :
                        c.daysOverdue >= 60 ? 'text-mango-amber' : 'text-mango-ink'
                      }`}>{c.daysOverdue}d</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-mango-muted">#{c.roNumber}</td>
                    </tr>
                  ))}
                  {ar.customers.length > 12 && (
                    <tr className="border-t border-mango-line/40 bg-mango-bg/40">
                      <td colSpan={4} className="px-3 py-1.5 text-center text-[11px] text-mango-muted">
                        + {ar.customers.length - 12} more · see full A/R section below
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- GP $ goal panel (Company-Level highlight) ----------------------------

function GpGoalPanel({
  lwActual, lwTarget,
  mtdActual, mtdTarget, mtdFullMonthGoal,
  mtdRange,
}: {
  lwActual: number; lwTarget: number;
  mtdActual: number; mtdTarget: number; mtdFullMonthGoal: number;
  mtdRange: string;
}) {
  return (
    <div className="rounded-3xl bg-white border border-mango-line/60 p-5 sm:p-6">
      <div className="mb-4">
        <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-mango-orange mb-1">Gross Profit · the bottom line</div>
        <h3 className="text-[18px] font-semibold text-mango-ink">GP $ vs Target</h3>
        <p className="text-[12px] text-mango-muted mt-0.5 max-w-2xl">
          GP $ goal = revenue goal × {Math.round(GP_TARGET * 100)}%. MTD target prorated by working days through end of last week.
        </p>
      </div>
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <BigGpBar
          label="Last Week GP $"
          actual={lwActual}
          target={lwTarget}
        />
        <BigGpBar
          label="Month-to-Date GP $"
          windowLabel={mtdRange}
          actual={mtdActual}
          target={mtdTarget}
          fullMonthGoal={mtdFullMonthGoal}
        />
      </div>
    </div>
  );
}

function BigGpBar({
  label, windowLabel, actual, target, fullMonthGoal, compact,
}: {
  label: string; windowLabel?: string;
  actual: number; target: number;
  // `fullMonthGoal` is OPTIONAL. When provided (the MTD case), the bar scales
  // to the full-month GP $ runway and shows a FULL MO marker at the right
  // edge. When omitted (the Last Week case), the bar scales tightly to the
  // period target (×1.1) and shows only the TARGET marker — visually distinct
  // from the MTD bar so leadership knows they're different windows.
  fullMonthGoal?: number;
  // `compact` is used inside per-shop cards — same visual language, smaller scale.
  compact?: boolean;
}) {
  const pctVal = target > 0 ? actual / target : null;
  const variance = actual - target;
  const sev: Sev =
    pctVal === null ? 'watch' :
    pctVal >= 1.00 ? 'ok' :
    pctVal >= 0.95 ? 'watch' :
    pctVal >= 0.80 ? 'problem' : 'critical';
  const hasFullMonth = !!fullMonthGoal && fullMonthGoal > target;
  // MTD: scale to full-month goal so FULL MO sits at the right edge.
  // Last Week: scale to target × 1.1 so the target marker sits near the
  // right (~91%) and the bar reads as a self-contained weekly snapshot.
  const denom = hasFullMonth ? fullMonthGoal! : target * 1.1;
  const fillW = denom > 0 ? Math.min((actual / denom) * 100, 100) : 0;
  const targetMarkerPct = denom > 0 ? (target / denom) * 100 : 100;

  // Gradient fill — matches the monthly pace bar below for consistency.
  const fillGradient =
    sev === 'ok'      ? 'linear-gradient(90deg,#10B98155,#10B98199)' :
    sev === 'watch'   ? 'linear-gradient(90deg,#F5A62355,#F5A62399)' :
    sev === 'problem' ? 'linear-gradient(90deg,#E0731C66,#DC262699)' :
                        'linear-gradient(90deg,#E0731C66,#DC262699)';
  const numColor =
    sev === 'ok'      ? '#10B981' :
    sev === 'watch'   ? '#F5A623' :
                        '#DC2626';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
        <div className="text-[11px] uppercase tracking-wide text-mango-muted font-semibold">{label}</div>
        {windowLabel && <div className="text-[10.5px] text-mango-faint">{windowLabel}</div>}
      </div>

      <div className={`flex items-baseline gap-3 flex-wrap ${compact ? 'mb-2' : 'mb-3'}`}>
        <span className={`font-semibold tnum text-mango-ink tracking-[-0.02em] leading-none ${
          compact ? 'text-[clamp(1.1rem,1.6vw,1.4rem)]' : 'text-[clamp(1.8rem,2.8vw,2.4rem)]'
        }`}>{usd(actual)}</span>
        <span className={`${compact ? 'text-[11.5px]' : 'text-[12.5px]'} text-mango-muted`}>/ {usd(target)} target</span>
        {pctVal !== null && (
          <span className={`${compact ? 'text-[11.5px]' : 'text-[12.5px]'} font-bold tnum`} style={{ color: numColor }}>
            {(pctVal * 100).toFixed(0)}%
          </span>
        )}
      </div>

      <div className={`relative rounded-md bg-mango-bg/70 overflow-hidden ${compact ? 'h-6' : 'h-8'}`}>
        <div className="absolute inset-y-0 left-0 rounded-md transition-all" style={{ width: `${fillW}%`, background: fillGradient }} />
        {/* TARGET marker (period-specific) */}
        <div className="absolute top-0 bottom-0 w-px bg-mango-ink/75" style={{ left: `${targetMarkerPct}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 text-[8.5px] font-bold uppercase tracking-wider text-mango-ink whitespace-nowrap px-1 rounded"
          style={{
            left: `${targetMarkerPct}%`,
            transform: `translate(${targetMarkerPct > 80 ? '-100%' : '4px'}, -50%)`,
            background: 'rgba(255,255,255,0.85)',
          }}>TARGET</div>
        {/* FULL MO marker — right edge, only on MTD bars (when fullMonthGoal provided) */}
        {hasFullMonth && (
          <>
            <div className="absolute top-0 bottom-0 w-[2px] bg-mango-ink/40" style={{ right: 0 }} />
            <div className="absolute top-1/2 -translate-y-1/2 text-[8.5px] font-bold uppercase tracking-wider text-mango-faint whitespace-nowrap px-1 rounded"
              style={{ right: '4px', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.85)' }}>FULL MO</div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between text-[11.5px] mt-2 flex-wrap gap-2">
        <span className={`font-semibold ${variance >= 0 ? 'text-mango-green' : 'text-mango-red'}`}>
          {variance >= 0 ? `↑ +${usdK(variance)} over target` : `↓ ${usdK(variance)} under target`}
        </span>
        {hasFullMonth && fullMonthGoal && (
          <span className="text-mango-faint">Full-month GP goal: <span className="font-semibold text-mango-muted">{usdK(fullMonthGoal)}</span></span>
        )}
      </div>
    </div>
  );
}

// --- Diagnostic callouts (compact, secondary) ------------------------------

function CompactDiagnostic({ title, lines }: { title: string; lines: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; text: React.ReactNode }[] }) {
  return (
    <div className="rounded-3xl bg-white border border-mango-line/60 p-5">
      <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-mango-muted mb-2">{title}</div>
      <ul className="space-y-2">
        {lines.map((l, i) => {
          const c = l.tone === 'good' ? '#10B981' : l.tone === 'warn' ? '#F5A623' : l.tone === 'bad' ? '#DC2626' : '#9AA1AC';
          return (
            <li key={i} className="flex items-start gap-2 text-[12.5px] text-mango-ink/85 leading-snug">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c }} />
              <div><span className="font-semibold text-mango-ink">{l.label}</span> — {l.text}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Helpers ---------------------------------------------------------------

function snapshotWindowLabel(): string {
  const w = resolveRange('last_week');
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' });
  return `${fmt(w.startISO)} – ${fmt(w.endISO)}`;
}

// --- Main component --------------------------------------------------------

export default function FinanceView() {
  const [lwKpi, setLwKpi] = useState<ChainKpi | null>(null);
  const [mtdKpi, setMtdKpi] = useState<ChainKpi | null>(null);
  const [ar, setAr] = useState<ARPayload | null>(null);
  const [arError, setArError] = useState<string | null>(null);
  const [calls, setCalls] = useState<{ shops: { shopNum: string; eligible: number; bookedRatePct: number }[]; chain: { bookedRatePct: number; eligible: number } } | null>(null);

  // MTD window: month-start → end-of-last-week, NOT month-start → today.
  // Finance View is frozen at last-week-close; "this_month" would silently
  // include days after last week ends, inflating both actual and target pace.
  const lwWin = resolveRange('last_week');
  const lwEndDate = useMemo(() => new Date(lwWin.endISO), [lwWin.endISO]);
  const mtdStartStr = useMemo(() => {
    const d = new Date(Date.UTC(lwEndDate.getUTCFullYear(), lwEndDate.getUTCMonth(), 1));
    return d.toISOString().slice(0, 10);
  }, [lwEndDate]);
  const mtdEndStr = useMemo(() => lwWin.endISO.slice(0, 10), [lwWin.endISO]);

  useEffect(() => {
    fetch('/api/metrics?range=last_week').then(r => r.json()).then(d => setLwKpi(d?.kpi ?? null)).catch(() => {});
    // Custom MTD range — frozen at end of last week. Working-day proration
    // below uses lwEndDate as "now" so the target denominator matches.
    fetch(`/api/metrics?range=custom&start=${mtdStartStr}&end=${mtdEndStr}`)
      .then(r => r.json()).then(d => setMtdKpi(d?.kpi ?? null)).catch(() => {});
    // A/R — live; uses the correct exec-metrics endpoint (same as <AccountsReceivable/>)
    fetch('/api/exec-metrics?view=ar&mode=total')
      .then(r => r.json())
      .then(d => {
        if (d?.summary) setAr(d);
        else setArError(d?.error || 'A/R endpoint returned no summary');
      })
      .catch((e) => setArError(e?.message || 'A/R fetch failed'));
    fetch('/api/extras?view=booked-rate&strict=1').then(r => r.json()).then(setCalls).catch(() => {});
  }, []);

  const goals = useMemo(() => loadGoals(), []);

  // Per-shop AR state — explicit loading / no-data / loaded so we never
  // silently show 0 when data hasn't arrived or shopNum mapping fails.
  const arByShop = useMemo<Record<string, ShopARState>>(() => {
    const out: Record<string, ShopARState> = {};
    for (const s of SHOPS) out[s.num] = { kind: 'loading' };
    if (ar !== null) {
      // Default every shop to "no-data" once response arrives; populate the
      // shops that have entries.
      for (const s of SHOPS) out[s.num] = { kind: 'no-data' };
      for (const sum of (ar.summary?.byShop ?? [])) {
        if (out[sum.shopNum]) {
          out[sum.shopNum] = { kind: 'loaded', total: sum.amount, over30: 0, customers: [] };
        }
      }
      for (const c of (ar.customers ?? [])) {
        const state = out[c.shopNum];
        if (state?.kind === 'loaded' && c.daysOverdue >= 30) {
          state.over30 += c.balance;
          state.customers.push(c);
        }
      }
      for (const k of Object.keys(out)) {
        const s = out[k];
        if (s.kind === 'loaded') s.customers.sort((a, b) => b.balance - a.balance);
      }
    }
    return out;
  }, [ar]);

  const shopRows = useMemo<ShopRow[]>(() => {
    if (!lwKpi || !mtdKpi) return [];
    const lwBy: Record<string, ShopKpi> = {};
    const mtdBy: Record<string, ShopKpi> = {};
    for (const s of lwKpi.byShop) lwBy[s.shopNum] = s;
    for (const s of mtdKpi.byShop) mtdBy[s.shopNum] = s;

    return SHOPS.map((shop): ShopRow => {
      const lw = lwBy[shop.num];
      const mtd = mtdBy[shop.num];
      const fullWeekGoal = revenueGoalForRange(goals[shop.num as ShopNum], 'last_week') || 0;
      const lwTarget = fullWeekGoal ? prorateRevenueGoal(fullWeekGoal, 'last_week', lwWin.start, lwWin.end) : 0;
      const fullMonthGoal = revenueGoalForRange(goals[shop.num as ShopNum], 'this_month') || 0;
      // Prorate the monthly goal through end-of-last-week (not today). Passing
      // lwEndDate as `now` makes the proration count working days only up to
      // last week's close, matching the frozen MTD revenue window.
      const mtdTarget = fullMonthGoal ? prorateRevenueGoal(fullMonthGoal, 'this_month', lwEndDate, lwEndDate, lwEndDate) : 0;
      const lwActual = lw?.revenue ?? 0;
      const mtdActual = mtd?.revenue ?? 0;
      const lwPct = lwTarget > 0 ? lwActual / lwTarget : null;
      const mtdPct = mtdTarget > 0 ? mtdActual / mtdTarget : null;
      const mtdFullPct = fullMonthGoal > 0 ? mtdActual / fullMonthGoal : 0;
      const mtdExpectedPct = fullMonthGoal > 0 ? mtdTarget / fullMonthGoal : 0;

      // GP $ goals from revenue goal × 58%
      const lwGpGoal = lwTarget * GP_TARGET;
      const mtdGpGoal = mtdTarget * GP_TARGET;
      const fullMonthGpGoal = fullMonthGoal * GP_TARGET;
      const lwGpActual = lw?.gpDollars ?? 0;
      const mtdGpActual = mtd?.gpDollars ?? 0;

      const gpPctVal = lw?.gpPct ?? 0;
      const revPerBay = lwActual / Math.max(shop.bays, 1);

      return {
        shopNum: shop.num, shopName: shop.name, bays: shop.bays,
        lwActual, lwTarget, lwVar: lwActual - lwTarget, lwPct, lwSev: paceSev(lwPct),
        mtdActual, mtdTarget, mtdFullMonth: fullMonthGoal,
        mtdVar: mtdActual - mtdTarget, mtdPct, mtdSev: paceSev(mtdPct),
        mtdFullPct, mtdExpectedPct,
        gpPct: gpPctVal, gpSev_: gpSev(gpPctVal, GP_TARGET),
        partsGpPct: lw?.partsGpPct ?? 0, laborGpPct: lw?.laborGpPct ?? 0,
        lwGpActual, lwGpGoal,
        mtdGpActual, mtdGpGoal,
        fullMonthGpGoal,
        approvedSales: lw?.approvedDollars ?? 0,
        aro: lw?.aro ?? 0, carCount: lw?.cars ?? 0,
        revPerBayPerWeek: revPerBay,
        revPerBayPerYear: revPerBay * WEEKS_PER_YEAR,
        ar: arByShop[shop.num] ?? { kind: 'loading' },
      };
    });
  }, [lwKpi, mtdKpi, arByShop, goals]);

  // Chain-level summary — MTD proration also pinned to end-of-last-week
  const summary = useMemo(() => {
    if (!lwKpi || !mtdKpi) return null;
    let lwGoal = 0, mtdGoalFull = 0;
    for (const s of SHOPS) {
      const w = revenueGoalForRange(goals[s.num], 'last_week') || 0;
      if (w) lwGoal += prorateRevenueGoal(w, 'last_week', lwWin.start, lwWin.end);
      const m = revenueGoalForRange(goals[s.num], 'this_month') || 0;
      if (m) mtdGoalFull += m;
    }
    const mtdGoal = mtdGoalFull ? prorateRevenueGoal(mtdGoalFull, 'this_month', lwEndDate, lwEndDate, lwEndDate) : 0;
    const lwRev = lwKpi.totalRevenue;
    const mtdRev = mtdKpi.totalRevenue;
    const totalGpD = lwKpi.byShop.reduce((s, k) => s + (k.gpDollars || 0), 0);
    const totalGpP = lwRev ? totalGpD / lwRev : 0;
    const partsGpP = lwRev ? lwKpi.byShop.reduce((s, k) => s + (k.partsGpPct || 0) * (k.revenue || 0), 0) / lwRev : 0;
    const mtdGpDollars = mtdKpi.byShop.reduce((s, k) => s + (k.gpDollars || 0), 0);
    // GP $ targets = revenue goal × 58% at each window
    const lwGpGoal = lwGoal * GP_TARGET;
    const mtdGpGoal = mtdGoal * GP_TARGET;
    const mtdFullMonthGpGoal = mtdGoalFull * GP_TARGET;
    const arTotal = ar?.summary?.total ?? 0;
    const arOver30 = ar?.customers?.filter(c => c.daysOverdue >= 30).reduce((s, c) => s + c.balance, 0) ?? 0;
    return {
      lwRev, lwGoal, lwVar: lwRev - lwGoal,
      mtdRev, mtdGoal, mtdVar: mtdRev - mtdGoal,
      totalGpD, totalGpP, partsGpP,
      mtdGpDollars,
      lwGpGoal, mtdGpGoal, mtdFullMonthGpGoal,
      arTotal, arOver30,
    };
  }, [lwKpi, mtdKpi, ar, goals]);

  const snapLabel = useMemo(snapshotWindowLabel, []);
  // Plain-language MTD window for the tile sub-label.
  const mtdRangeLabel = useMemo(() => {
    const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' });
    return `${fmt(mtdStartStr)} – ${fmt(mtdEndStr)}`;
  }, [mtdStartStr, mtdEndStr]);

  // Diagnostic data
  const diagnostic = useMemo(() => {
    if (!lwKpi || !summary) return null;
    const lwRev = summary.lwRev;
    const partsGpPct = summary.partsGpP;
    const laborGpPct = lwRev ? lwKpi.byShop.reduce((s, k) => s + (k.laborGpPct || 0) * (k.revenue || 0), 0) / lwRev : 0;
    const cr = lwKpi.closeRate;
    const aro = lwKpi.averageAro;
    const chainConv = calls?.chain?.bookedRatePct ?? null;
    return { partsGpPct, laborGpPct, cr, aro, chainConv };
  }, [lwKpi, summary, calls]);

  if (!lwKpi || !mtdKpi || !summary) {
    return (
      <div className="max-w-[1400px] mx-auto">
        <div className="h-16 w-64 rounded-lg bg-white/60 animate-pulse mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          {[1,2,3,4,5,6].map((i) => <div key={i} className="h-32 rounded-3xl bg-white/60 animate-pulse" />)}
        </div>
        <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
          {[1,2,3,4].map((i) => <div key={i} className="h-96 rounded-3xl bg-white/60 animate-pulse" />)}
        </div>
      </div>
    );
  }

  const tiles: SummaryTile[] = [
    {
      label: 'Last Week Revenue', icon: DollarSign,
      sev: paceSev(summary.lwGoal > 0 ? summary.lwRev / summary.lwGoal : null),
      value: usd(summary.lwRev),
      target: `${((summary.lwRev / Math.max(summary.lwGoal, 1)) * 100).toFixed(0)}% of ${usdK(summary.lwGoal)}`,
      variance: summary.lwVar >= 0 ? `↑ +${usdK(summary.lwVar)}` : `↓ ${usdK(summary.lwVar)}`,
      varianceTone: summary.lwVar >= 0 ? 'good' : 'bad',
    },
    {
      label: 'MTD Revenue', icon: TrendingUp,
      sev: paceSev(summary.mtdGoal > 0 ? summary.mtdRev / summary.mtdGoal : null),
      value: usd(summary.mtdRev),
      target: `${((summary.mtdRev / Math.max(summary.mtdGoal, 1)) * 100).toFixed(0)}% of MTD goal · ${mtdRangeLabel}`,
      variance: summary.mtdVar >= 0 ? `↑ +${usdK(summary.mtdVar)}` : `↓ ${usdK(summary.mtdVar)}`,
      varianceTone: summary.mtdVar >= 0 ? 'good' : 'bad',
    },
    {
      label: 'Total GP %', icon: Percent, sev: gpSev(summary.totalGpP, GP_TARGET),
      value: pct(summary.totalGpP),
      target: `${Math.round(GP_TARGET * 100)}% target`,
    },
    {
      label: 'Parts GP %', icon: Package, sev: gpSev(summary.partsGpP, PARTS_GP_TARGET),
      value: pct(summary.partsGpP),
      target: `${Math.round(PARTS_GP_TARGET * 100)}% matrix midpoint`,
    },
    {
      label: 'Total A/R', icon: Landmark, sev: 'watch', liveBadge: true,
      value: usdK(summary.arTotal),
      target: 'all outstanding',
    },
    {
      label: 'Past Due > 30 Days', icon: AlertTriangle, sev: arSev(summary.arOver30), liveBadge: true,
      value: usdK(summary.arOver30),
      target: 'collections priority',
    },
  ];

  return (
    <div className="max-w-[1400px] mx-auto">
      <div>

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-mango-orange mb-2">Finance View · Weekly</div>
              <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight text-mango-ink leading-tight">Corporate Finance Review</h1>
              <p className="text-[13px] text-mango-muted mt-2 max-w-2xl leading-relaxed">
                Last-week and MTD per-shop review for the corporate Monday meeting. Snapshot freezes after Sunday reconcile.
                A/R remains live throughout the week.
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-mango-line/60 px-4 py-3 text-right">
              <div className="text-[10.5px] uppercase tracking-wide text-mango-muted font-semibold flex items-center gap-1.5 justify-end">
                <Calendar className="w-[12px] h-[12px]" /> Snapshot
              </div>
              <div className="mt-1 text-[14px] font-semibold text-mango-ink tnum">{snapLabel}</div>
              <div className="text-[10.5px] text-mango-faint mt-0.5">Frozen weekly · A/R live</div>
            </div>
          </div>
        </header>

        {/* A/R fetch diagnostic — only shown if the AR endpoint failed */}
        {arError && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-mango-ink/85">
            <span className="font-semibold">A/R diagnostic:</span> {arError}. Per-shop A/R will show "No data" until this resolves.
          </div>
        )}

        {/* SECTION 1: Top summary */}
        <section id="vitals" className="scroll-mt-6 mb-8">
          <SectionHeader kicker="01 · Vitals" title="Company-Level Performance" />
          <TopSummary tiles={tiles} />
        </section>

        {/* SECTION 1b: GP $ vs Target (chain) — featured callout under vitals */}
        <section id="gp-goal" className="scroll-mt-6 mb-10">
          <GpGoalPanel
            lwActual={summary.totalGpD}
            lwTarget={summary.lwGpGoal}
            mtdActual={summary.mtdGpDollars}
            mtdTarget={summary.mtdGpGoal}
            mtdFullMonthGoal={summary.mtdFullMonthGpGoal}
            mtdRange={mtdRangeLabel}
          />
        </section>

        {/* SECTION 2: Shop-by-shop — MAIN section */}
        <section id="shops" className="scroll-mt-6 mb-10">
          <SectionHeader kicker="02 · Per-Shop Review" title="Shop-by-Shop Weekly Performance"
            sub="Last week · MTD · GP $ goal progress · operations · live A/R for every shop." />
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            {shopRows.map((r) => <ShopCard key={r.shopNum} row={r} mtdRangeLabel={mtdRangeLabel} />)}
          </div>
        </section>

        {/* SECTION 3: Compact diagnostic callouts */}
        {diagnostic && (
          <section id="diagnostic" className="scroll-mt-6 mb-10">
            <SectionHeader kicker="03 · Diagnostic Callouts" title="If something missed, here's the likely cause"
              sub="Compact summaries — full diagnostic trees live on the operational dashboard." />
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
              <CompactDiagnostic title="Revenue gap" lines={(() => {
                const lines: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; text: React.ReactNode }[] = [];
                if (summary.lwVar >= 0) {
                  lines.push({ label: 'Last week revenue', tone: 'good', text: <>at/above target ({usdK(summary.lwVar)} over).</> });
                } else {
                  const carCount = lwKpi.totalCars;
                  const aroBenchmarkGap = Math.max(0, ARO_TARGET - diagnostic.aro);
                  const carsNeeded = summary.lwGoal > 0 ? Math.ceil(summary.lwGoal / ARO_TARGET) : 0;
                  const carsGap = Math.max(0, carsNeeded - carCount);
                  const carsWorse = carsGap / Math.max(carsNeeded, 1) > aroBenchmarkGap / ARO_TARGET;
                  if (carsWorse) {
                    lines.push({ label: 'Primary: car count', tone: 'bad', text:
                      <>Short by {num(carsGap)} cars at benchmark ARO. {diagnostic.chainConv !== null && diagnostic.chainConv < CALL_CONV_TARGET * 100 ? <>Call conversion at <strong>{diagnostic.chainConv.toFixed(1)}%</strong> vs {Math.round(CALL_CONV_TARGET * 100)}% target — phone handling / booking discipline.</> : <>Investigate inbound call volume and conversion.</>}</>
                    });
                  } else {
                    lines.push({ label: 'Primary: ARO', tone: 'bad', text:
                      <>ARO {usd(diagnostic.aro)} vs {usd(ARO_TARGET)} benchmark. CR {pct(diagnostic.cr)} — {diagnostic.cr >= CR_TARGET ? 'high CR + low ARO = Easy Yes (advisors not writing enough on the ticket).' : 'low CR + low ARO = Weak Inspections (inspection depth and estimate construction).'}</>
                    });
                  }
                }
                return lines;
              })()} />

              <CompactDiagnostic title="Gross profit gap" lines={(() => {
                const lines: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; text: React.ReactNode }[] = [];
                if (summary.totalGpP >= GP_TARGET) {
                  lines.push({ label: 'GP %', tone: 'good', text: <>{pct(summary.totalGpP)} at/above {Math.round(GP_TARGET * 100)}% target.</> });
                } else {
                  const partsGap = Math.max(0, PARTS_GP_TARGET - diagnostic.partsGpPct);
                  const laborGap = Math.max(0, LABOR_GP_TARGET - diagnostic.laborGpPct);
                  if (partsGap >= laborGap) {
                    lines.push({ label: 'Primary: Parts GP', tone: 'bad', text:
                      <>{pct(diagnostic.partsGpPct)} vs {Math.round(PARTS_GP_TARGET * 100)}% matrix midpoint. Most common cause: <strong>manual parts price overrides</strong> instead of the standard matrix. Canned jobs may be legitimate exceptions.</>
                    });
                  } else {
                    lines.push({ label: 'Primary: Labor GP', tone: 'bad', text:
                      <>{pct(diagnostic.laborGpPct)} vs {Math.round(LABOR_GP_TARGET * 100)}% target — operational review. Likely drivers: rate realization, discounting, warranty/comeback labor, productivity.</>
                    });
                  }
                }
                return lines;
              })()} />
            </div>
          </section>
        )}

        {/* SECTION 4: Full A/R section — shared component */}
        <section id="ar" className="scroll-mt-6 mb-10">
          <SectionHeader kicker="04 · A/R · live" title="Accounts Receivable" sub="Shared with the operational dashboard — single source of truth." />
          <AccountsReceivable />
        </section>

        {/* SECTION 5: Financial Waterfall — bottom, mostly placeholder */}
        <section id="waterfall" className="scroll-mt-6 mb-10">
          <SectionHeader kicker="05 · Profit flow" title="Financial Waterfall"
            sub="Revenue and cost layers from Tekmetric. P&L lines from QuickBooks integration pending." />
          <div className="rounded-3xl border border-mango-line/60 bg-white p-5">
            <WaterfallRows rev={summary.lwRev} parts={summary.lwRev * (1 - summary.partsGpP) * 0.45} labor={summary.lwRev * (1 - (diagnostic?.laborGpPct ?? LABOR_GP_TARGET)) * 0.45} />
          </div>
        </section>

        {/* SECTION 6: Expense Classification — bottom, mostly placeholder */}
        <section id="expenses" className="scroll-mt-6 mb-10">
          <SectionHeader kicker="06 · Cost structure" title="Expense Classification"
            sub="Fixed structural costs, controllable operations, one-time distortions — QuickBooks integration pending for most lines." />
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
            <ExpenseColumn title="Fixed / Structural" />
            <ExpenseColumn title="Controllable Operations" />
            <ExpenseColumn title="One-Time Distortions" />
          </div>
        </section>

        <footer className="text-center text-[11px] text-mango-faint py-6 leading-relaxed">
          Finance View · Snapshot: {snapLabel} · A/R live<br/>
          Working-day-prorated MTD targets · GP $ goals computed at {Math.round(GP_TARGET * 100)}% of revenue goal.
        </footer>
      </div>
    </div>
  );
}

function WaterfallRows({ rev, parts, labor }: { rev: number; parts: number; labor: number }) {
  const max = rev;
  const row = (label: string, amount: number | null, color: string, pending?: boolean) => {
    const w = amount !== null ? Math.max(2, (Math.abs(amount) / max) * 100) : 0;
    return (
      <div className="grid grid-cols-[140px_1fr_110px] items-center gap-3 py-1.5" key={label}>
        <div className="text-[12px] text-mango-ink truncate">{label}</div>
        <div className="relative h-7 rounded-md bg-mango-bg/60 overflow-hidden">
          {amount !== null && !pending ? (
            <div className="h-full rounded-md" style={{ width: `${w}%`, background: color, opacity: 0.65 }} />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-[10.5px] uppercase tracking-wide font-semibold text-mango-muted">QuickBooks pending</div>
          )}
        </div>
        <div className="text-right tnum text-[13px] text-mango-ink/85">
          {amount !== null && !pending ? (label === 'Revenue' ? usd(amount) : `-${usd(Math.abs(amount))}`) : '—'}
        </div>
      </div>
    );
  };
  return (
    <div className="space-y-1.5">
      {row('Revenue', rev, '#10B981')}
      {row('Parts cost', Math.round(parts), '#7C8B98')}
      {row('Labor cost', Math.round(labor), '#7C8B98')}
      {row('Payroll', null, '#7C8B98', true)}
      {row('Marketing', null, '#7C8B98', true)}
      {row('License Fees', null, '#7C8B98', true)}
      {row('Occupancy', null, '#7C8B98', true)}
      {row('Net Profit', null, '#1F2937', true)}
    </div>
  );
}

function ExpenseColumn({ title }: { title: string }) {
  return (
    <div className="rounded-3xl border border-mango-line/60 bg-white p-5">
      <div className="text-[10.5px] uppercase tracking-[0.1em] font-semibold text-mango-muted mb-3">{title}</div>
      <div className="text-[11.5px] text-mango-muted text-center py-6">QuickBooks integration pending</div>
    </div>
  );
}
