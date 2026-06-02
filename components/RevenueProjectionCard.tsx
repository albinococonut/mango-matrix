'use client';

// Revenue Projection — operational command center.
//
// Collapsed-by-default shop cards (~160px tall) with one-at-a-time accordion
// expansion. Tabbed expanded panel: Overview / Levers / Accuracy / Model.
// Status pill driven by GP$-to-goal tier. Forecast range visualized; abstract
// "confidence 70/100" pulled out of the headline. Drivers shown as natural
// language; statistical notation kept inside Model tab only.
//
// Presentation layer only. Same /api/exec-metrics?view=projection payload —
// no new API surface, no new model logic.

import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp,
  Target, Gauge, AlertTriangle, Sparkles, Zap, Activity, Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usd, usdK } from '@/lib/format';
import type { RangeKey } from '@/lib/dates';

type PeriodKey = 'this_week' | 'next_week' | 'this_month' | 'next_month' | 'this_quarter' | 'custom';

// Map the page-level header range to the projection handler's PeriodKey.
// Returns null for ranges the projection engine doesn't support.
function rangeToProjectionPeriod(range: RangeKey): PeriodKey | null {
  switch (range) {
    case 'this_week':    return 'this_week';
    case 'this_month':   return 'this_month';
    case 'this_quarter': return 'this_quarter';
    case 'custom':       return 'custom';
    default:             return null; // last_*, last_X_days, this_year
  }
}

// "Past" = the selected window ends before today. Past ranges suppress the
// forecast and show a passive Past Revenue Actuals card with an alert.
function isPastRange(range: RangeKey, customEnd?: string): boolean {
  if (range === 'last_week' || range === 'last_month' || range === 'last_quarter' || range === 'last_year') return true;
  if (range === 'last_30_days' || range === 'last_60_days' || range === 'last_90_days' || range === 'last_365_days') return true;
  if (range === 'custom' && customEnd) {
    const end = new Date(customEnd);
    if (!isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      return end.getTime() < Date.now();
    }
  }
  return false;
}
type Tab = 'portfolio' | 'districts' | 'shops';

interface Driver { metric: string; r: number; strength: string; direction: string; note: string }
interface Lever { lever: string; detail: string; dollarImpact: number; ease: 'easy' | 'moderate' | 'hard'; easeWhy: string }
interface Contribution { label: string; amount: number }
interface ShopProj {
  shopNum: string; shopName: string; district: string;
  projectedRevenue: number; expected: number; bestCase: number; worstCase: number;
  projectedCars: number; projectedGpDollars: number; projectedAro: number; projectedGpPct: number;
  goalRevenue: number | null; pctToGoal: number | null; onTrack: boolean | null;
  baselineForPeriod: number; pacingVsNormalPct: number;
  confidence: number; confidenceLabel: string; confidenceReasons: string[];
  drivers: Driver[]; driftNote: string | null; levers: Lever[];
  headline: string; changeSinceYesterday: number | null; weeksOfHistory: number;
  contributions?: Contribution[];
  contributionsV2?: Contribution[];
  pointV2?: number; confidenceV2?: number;
  isRamping?: boolean; rampWarning?: string; rampWarningV2?: string;
  modelVersion?: string;
  apptsFreshness?: 'fresh' | 'stale' | 'missing';
}
interface Roll {
  label: string; expected: number; bestCase: number; worstCase: number;
  projectedCars: number; projectedGpDollars: number; projectedAro: number;
  goalRevenue: number | null; pctToGoal: number | null; onTrack: boolean | null;
  confidence: number; confidenceLabel: string; shopNums: string[];
  topDrivers: { metric: string; shops: number }[];
  ahead: { shopNum: string; shopName: string; pct: number }[];
  behind: { shopNum: string; shopName: string; pct: number }[];
  changeSinceYesterday: number | null;
}
interface Backtest { weeksTested: number; mape: number; withinPctText: string; recentTrend: string | null }
interface Payload {
  period: { label: string; workingDaysTotal: number; workingDaysElapsed: number; isFuture: boolean; actualRevenue?: number };
  portfolio: Roll; districts: Roll[]; shops: ShopProj[];
  backtests: Record<string, Backtest>;
  portfolioAccuracy: { mape: number; text: string };
  // ISO timestamp written by the handler (lib/handlers/projection.ts) for
  // refresh-availability detection vs the Tekmetric heartbeat.
  generatedAt?: string;
}

// --- GP$-to-goal tier (drives the card chrome) ----------------------------
const GP_TARGET_PCT = 0.58;
type GpTier = 'supergreen' | 'green' | 'yellow' | 'orange' | 'red' | 'none';
function gpTier(pct: number | null): GpTier {
  if (pct == null) return 'none';
  if (pct >= 1.00) return 'supergreen';
  if (pct >= 0.95) return 'green';
  if (pct >= 0.85) return 'yellow';
  if (pct >= 0.75) return 'orange';
  return 'red';
}
function shopTier(s: ShopProj): { tier: GpTier; pct: number | null } {
  const denom = (s.goalRevenue ?? 0) * GP_TARGET_PCT;
  const pct = denom > 0 ? s.projectedGpDollars / denom : null;
  return { tier: gpTier(pct), pct };
}
function rollTier(r: Roll): { tier: GpTier; pct: number | null } {
  // Roll has projectedGpDollars but goal is total revenue.
  const denom = (r.goalRevenue ?? 0) * GP_TARGET_PCT;
  const pct = denom > 0 ? r.projectedGpDollars / denom : null;
  return { tier: gpTier(pct), pct };
}

const TIER_RING: Record<GpTier, string> = {
  supergreen: 'border-emerald-300',
  green:      'border-green-200',
  yellow:     'border-yellow-200',
  orange:     'border-orange-200',
  red:        'border-red-200',
  none:       'border-mango-line',
};
const TIER_TINT: Record<GpTier, string> = {
  supergreen: 'bg-emerald-50/60',
  green:      'bg-green-50/35',
  yellow:     'bg-yellow-50/45',
  orange:     'bg-orange-50/45',
  red:        'bg-red-50/45',
  none:       'bg-white',
};
const TIER_PILL: Record<GpTier, string> = {
  supergreen: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  green:      'bg-green-50 text-green-800 border-green-200',
  yellow:     'bg-yellow-50 text-yellow-800 border-yellow-200',
  orange:     'bg-orange-50 text-orange-800 border-orange-200',
  red:        'bg-red-50 text-red-800 border-red-200',
  none:       'bg-mango-bg text-mango-muted border-mango-line',
};
const TIER_LABEL: Record<GpTier, string> = {
  supergreen: 'On Track',
  green:      'Close',
  yellow:     'Watch',
  orange:     'Risk',
  red:        'Critical',
  none:       'No Goal',
};
const TIER_GLOW: Record<GpTier, string> = {
  supergreen: 'hover:shadow-[0_8px_24px_-6px_rgba(16,185,129,0.18)]',
  green:      'hover:shadow-[0_8px_24px_-6px_rgba(34,197,94,0.16)]',
  yellow:     'hover:shadow-[0_8px_24px_-6px_rgba(245,158,11,0.18)]',
  orange:     'hover:shadow-[0_8px_24px_-6px_rgba(249,115,22,0.20)]',
  red:        'hover:shadow-[0_8px_24px_-6px_rgba(239,68,68,0.22)]',
  none:       'hover:shadow-[0_8px_24px_-6px_rgba(0,0,0,0.06)]',
};

// --- Small visual atoms ---------------------------------------------------
function TrendArrow({ d, size = 12 }: { d: number | null | undefined; size?: number }) {
  if (d == null || Math.abs(d) < 100) {
    return <Minus className="inline" style={{ width: size, height: size }} />;
  }
  return d > 0
    ? <TrendingUp className="inline text-mango-green" style={{ width: size, height: size }} />
    : <TrendingDown className="inline text-mango-red" style={{ width: size, height: size }} />;
}

function ForecastRangeBar({ worst, expected, best }: { worst: number; expected: number; best: number }) {
  const span = Math.max(1, best - worst);
  const pos = Math.max(2, Math.min(98, ((expected - worst) / span) * 100));
  return (
    <div className="w-full">
      <div className="relative h-2 rounded-full bg-mango-bg overflow-visible">
        <div className="absolute inset-y-0 left-[8%] right-[8%] rounded-full"
          style={{ background: 'linear-gradient(90deg, rgba(245,166,35,0.20), rgba(245,166,35,0.70), rgba(245,166,35,0.20))' }} />
        <div className="absolute -top-1 h-4 w-4 rounded-full bg-mango-orange border-2 border-white shadow-sm"
          style={{ left: `calc(${pos}% - 8px)` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-mango-muted">
        <span>{usdK(worst)}</span>
        <span className="font-semibold text-mango-ink">{usdK(expected)}</span>
        <span>{usdK(best)}</span>
      </div>
    </div>
  );
}

function SignalChips({ s }: { s: ShopProj }) {
  const chips: { label: string; tone: 'positive' | 'negative' | 'neutral'; icon?: 'spark' | 'zap' | 'warn' }[] = [];
  if (s.pacingVsNormalPct != null) {
    const v = s.pacingVsNormalPct;
    const sign = v >= 0 ? '+' : '';
    chips.push({ label: `${sign}${v.toFixed(0)}% vs norm`, tone: v >= 0 ? 'positive' : 'negative' });
  }
  const contribs = s.contributionsV2 ?? s.contributions ?? [];
  for (const c of contribs) {
    if (/posted so far|intercept/i.test(c.label)) continue;
    if (Math.abs(c.amount) < 100) continue;
    const tone = c.amount >= 0 ? 'positive' : 'negative';
    const short = c.label
      .replace(/\(×[\d.]+.*?\)/g, '')
      .replace(/\(capped, .*?\)/g, '')
      .replace(/Booked appts remaining \(\d+ × \$\d+\)/, 'Booked appts')
      .trim();
    chips.push({ label: short, tone, icon: 'spark' });
    if (chips.length >= 5) break;
  }
  if (s.isRamping) chips.push({ label: 'Ramping shop', tone: 'neutral', icon: 'warn' });
  if (s.apptsFreshness === 'missing') chips.push({ label: 'Appts warming', tone: 'neutral', icon: 'warn' });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium border ${
          c.tone === 'positive' ? 'bg-green-50 text-green-700 border-green-200' :
          c.tone === 'negative' ? 'bg-red-50 text-red-700 border-red-200' :
          'bg-mango-bg text-mango-muted border-mango-line'
        }`}>
          {c.icon === 'spark' && <Sparkles className="w-2.5 h-2.5" />}
          {c.icon === 'warn' && <AlertTriangle className="w-2.5 h-2.5" />}
          {c.label}
        </span>
      ))}
    </div>
  );
}

function LeverRow({ lever, max }: { lever: Lever; max: number }) {
  const fillPct = max > 0 ? (lever.dollarImpact / max) * 100 : 0;
  const easeClass =
    lever.ease === 'easy'     ? 'bg-green-100 text-green-700 border-green-200'
    : lever.ease === 'moderate' ? 'bg-amber-100 text-amber-700 border-amber-200'
    :                             'bg-red-100 text-red-700 border-red-200';
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-28 shrink-0 text-[12.5px] font-medium text-mango-ink truncate" title={lever.lever}>
        {lever.lever}
      </div>
      <div className="flex-1 h-2 rounded-full bg-mango-bg overflow-hidden">
        <div className="h-full rounded-full bg-mango-orange transition-all" style={{ width: `${Math.min(100, fillPct)}%` }} />
      </div>
      <div className="w-16 shrink-0 text-right text-[12.5px] tabular-nums font-semibold text-mango-ink">
        {usdK(lever.dollarImpact)}
      </div>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${easeClass}`}>
        {lever.ease}
      </span>
    </div>
  );
}

// --- Collapsed shop card --------------------------------------------------
function ShopCardCollapsed({
  s, expanded, onToggle,
}: { s: ShopProj; expanded: boolean; onToggle: () => void }) {
  const { tier, pct } = shopTier(s);
  const goalGap = s.goalRevenue ? s.expected - s.goalRevenue : null;
  const bestLever = (s.levers || []).slice().sort((a, b) => b.dollarImpact - a.dollarImpact)[0];

  return (
    <motion.button
      type="button"
      onClick={onToggle}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.14 }}
      className={`w-full text-left rounded-3xl border ${TIER_RING[tier]} ${TIER_TINT[tier]} ${TIER_GLOW[tier]} px-5 py-4 transition-all`}
      aria-expanded={expanded}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold text-mango-ink text-[15px] truncate">{s.shopName}</span>
            <span className="text-[10.5px] text-mango-muted shrink-0">{s.district}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TIER_PILL[tier]}`}>
              {TIER_LABEL[tier]}
            </span>
            {pct != null && (
              <span className="text-[11px] tabular-nums text-mango-muted">
                {Math.round(pct * 100)}% of goal
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-mango-muted/70">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Big number */}
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-3xl font-bold tracking-tight text-mango-ink tabular-nums leading-none">
            {usd(s.expected)}
          </div>
          {goalGap != null && (
            <div className={`mt-1 text-[12px] font-semibold tabular-nums ${
              goalGap >= 0 ? 'text-mango-green' : 'text-mango-red'
            }`}>
              {goalGap >= 0 ? '+' : '−'}{usdK(Math.abs(goalGap))} vs goal
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] text-mango-muted">vs yesterday</div>
          <div className="text-[12px] font-semibold flex items-center justify-end gap-1">
            <TrendArrow d={s.changeSinceYesterday} />
            <span className={`tabular-nums ${
              (s.changeSinceYesterday ?? 0) > 0 ? 'text-mango-green'
              : (s.changeSinceYesterday ?? 0) < 0 ? 'text-mango-red' : 'text-mango-muted'
            }`}>
              {s.changeSinceYesterday != null && Math.abs(s.changeSinceYesterday) >= 100
                ? `${s.changeSinceYesterday >= 0 ? '+' : '−'}${usdK(Math.abs(s.changeSinceYesterday))}`
                : 'flat'}
            </span>
          </div>
        </div>
      </div>

      {/* Secondary row */}
      <div className="mt-3 flex items-center justify-between gap-2 text-[12px] border-t border-mango-line/60 pt-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Zap className="w-3.5 h-3.5 text-mango-orange shrink-0" />
          <span className="text-mango-muted">Best lever:</span>
          <span className="font-medium text-mango-ink truncate" title={bestLever?.lever}>
            {bestLever ? bestLever.lever : '—'}
          </span>
          {bestLever && (
            <span className="text-[11px] tabular-nums text-mango-muted shrink-0">
              {usdK(bestLever.dollarImpact)}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

// --- Expanded panel -------------------------------------------------------
type DetailTab = 'overview' | 'levers' | 'accuracy' | 'model';
function ShopExpandedPanel({ s, bt }: { s: ShopProj; bt?: Backtest }) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const sortedLevers = useMemo(() => (s.levers || []).slice().sort((a, b) => b.dollarImpact - a.dollarImpact), [s.levers]);
  const maxImpact = useMemo(() => Math.max(1, ...sortedLevers.map((l) => l.dollarImpact)), [sortedLevers]);
  const contribs = s.contributionsV2 ?? s.contributions ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="mt-2 rounded-3xl border border-mango-line bg-white p-5 shadow-sm">
        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 -mt-1 -mx-1 border-b border-mango-line/60">
          {([
            ['overview', 'Overview', null],
            ['levers', 'Levers', sortedLevers.length],
            ['accuracy', 'Accuracy', null],
            ['model', 'Model', null],
          ] as [DetailTab, string, number | null][]).map(([k, label, badge]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-[12px] font-semibold transition border-b-2 ${
                tab === k ? 'border-mango-orange text-mango-orange'
                          : 'border-transparent text-mango-muted hover:text-mango-ink'
              }`}
            >
              {label}{badge != null && badge > 0 && <span className="ml-1 text-mango-muted/70">{badge}</span>}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wide font-semibold text-mango-muted">
                  Forecast range
                </div>
                <div className="text-[11px] text-mango-muted">
                  Confidence: <span className="font-semibold text-mango-ink">{Math.round((s.confidenceV2 ?? s.confidence / 100) * 100)}%</span>
                </div>
              </div>
              <ForecastRangeBar worst={s.worstCase} expected={s.expected} best={s.bestCase} />
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wide font-semibold text-mango-muted mb-2">
                Signals
              </div>
              <SignalChips s={s} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <Stat label="Projected cars" value={String(s.projectedCars)} />
              <Stat label="Projected ARO" value={usdK(s.projectedAro)} />
              <Stat label="Projected GP $" value={usdK(s.projectedGpDollars)} />
              <Stat label="GP %" value={`${s.projectedGpPct.toFixed(0)}%`} />
            </div>

            {(s.rampWarning || s.rampWarningV2) && (
              <div className="rounded-lg bg-mango-amber/10 border border-mango-amber/30 px-3 py-2 text-[11.5px] text-mango-amber flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{s.rampWarning ?? s.rampWarningV2}</span>
              </div>
            )}
          </div>
        )}

        {tab === 'levers' && (
          <div className="space-y-0.5">
            {sortedLevers.length ? (
              sortedLevers.map((l, i) => <LeverRow key={i} lever={l} max={maxImpact} />)
            ) : (
              <div className="text-[12px] text-mango-muted py-2">No actionable levers identified for this shop.</div>
            )}
            {sortedLevers.length > 0 && (
              <div className="mt-2 pt-2 border-t border-mango-line/60 text-[10.5px] text-mango-muted">
                Sorted by revenue upside. Easy levers are green, moderate amber, hard red.
              </div>
            )}
          </div>
        )}

        {tab === 'accuracy' && (
          <div className="space-y-3 text-[12.5px]">
            {bt ? (
              <>
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-mango-info" />
                  <span className="font-semibold">{bt.withinPctText}</span>
                  <span className="text-mango-muted">· {bt.weeksTested} weeks tested</span>
                </div>
                {bt.recentTrend && (
                  <div className="text-mango-muted leading-relaxed">{bt.recentTrend}</div>
                )}
              </>
            ) : (
              <div className="text-mango-muted">Backtest data not available for this shop.</div>
            )}
          </div>
        )}

        {tab === 'model' && (
          <div className="space-y-4 text-[12px]">
            <div>
              <div className="text-[11px] uppercase tracking-wide font-semibold text-mango-muted mb-2">
                Why this number — contributions
                <span className="ml-2 text-mango-muted/70 font-mono">{s.modelVersion ?? 'v1'}</span>
              </div>
              {contribs.length ? (
                <ul className="space-y-1">
                  {contribs.map((c, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-0.5">
                      <span className="text-mango-ink/80">{c.label}</span>
                      <span className={`tabular-nums font-semibold shrink-0 ${
                        c.amount >= 0 ? 'text-mango-ink' : 'text-mango-red'
                      }`}>
                        {c.amount >= 0 ? '+' : '−'}{usdK(Math.abs(c.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-mango-muted">No v2 contribution breakdown in this payload.</div>
              )}
            </div>
            {s.drivers && s.drivers.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide font-semibold text-mango-muted mb-2">
                  Top predictors at this shop
                </div>
                <ul className="space-y-1.5">
                  {s.drivers.slice(0, 3).map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-mango-ink/80">
                      <Gauge className="w-3.5 h-3.5 text-mango-info mt-0.5 shrink-0" />
                      <span className="leading-snug">{d.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-mango-bg px-3 py-2">
      <div className="text-[15px] font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[10.5px] text-mango-muted mt-0.5">{label}</div>
    </div>
  );
}

// --- Shop grid (holds expansion state) ------------------------------------
function ShopGrid({ shops, backtests }: { shops: ShopProj[]; backtests: Record<string, Backtest> }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  // Sort shops by tier severity (Critical → On Track), then by gap-to-goal.
  const tierOrder: Record<GpTier, number> = { red: 0, orange: 1, yellow: 2, green: 3, supergreen: 4, none: 5 };
  const sorted = useMemo(() => shops.slice().sort((a, b) => {
    const ta = shopTier(a).tier, tb = shopTier(b).tier;
    if (tierOrder[ta] !== tierOrder[tb]) return tierOrder[ta] - tierOrder[tb];
    return (a.shopName).localeCompare(b.shopName);
  }), [shops]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {sorted.map((s) => (
        <div key={s.shopNum} className="space-y-0">
          <ShopCardCollapsed
            s={s}
            expanded={expanded === s.shopNum}
            onToggle={() => setExpanded(expanded === s.shopNum ? null : s.shopNum)}
          />
          <AnimatePresence initial={false}>
            {expanded === s.shopNum && <ShopExpandedPanel s={s} bt={backtests[s.shopNum]} />}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

// --- Compressed roll-up card (Portfolio / Districts) ----------------------
function RollSummary({ r, periodLabel }: { r: Roll; periodLabel: string }) {
  const { tier, pct } = rollTier(r);
  const goalGap = r.goalRevenue ? r.expected - r.goalRevenue : null;
  return (
    <div className={`rounded-3xl border ${TIER_RING[tier]} ${TIER_TINT[tier]} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-bold text-mango-ink leading-tight">
            {r.label}
          </div>
          <div className="mt-0.5 text-[10.5px] uppercase tracking-wide font-semibold text-mango-muted">
            Projected · {periodLabel}
          </div>
          <div className="mt-1 text-4xl font-bold tracking-tight tabular-nums text-mango-ink">
            {usd(r.expected)}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TIER_PILL[tier]}`}>
              {TIER_LABEL[tier]}
            </span>
            {pct != null && (
              <span className="text-[11px] tabular-nums text-mango-muted">
                {Math.round(pct * 100)}% of goal
              </span>
            )}
            {goalGap != null && (
              <span className={`text-[11px] font-semibold tabular-nums ${goalGap >= 0 ? 'text-mango-green' : 'text-mango-red'}`}>
                {goalGap >= 0 ? '+' : '−'}{usdK(Math.abs(goalGap))} vs goal
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] text-mango-muted">vs yesterday</div>
          <div className="text-[12px] font-semibold flex items-center justify-end gap-1">
            <TrendArrow d={r.changeSinceYesterday} />
            <span className={`tabular-nums ${
              (r.changeSinceYesterday ?? 0) > 0 ? 'text-mango-green'
              : (r.changeSinceYesterday ?? 0) < 0 ? 'text-mango-red' : 'text-mango-muted'
            }`}>
              {r.changeSinceYesterday != null && Math.abs(r.changeSinceYesterday) >= 100
                ? `${r.changeSinceYesterday >= 0 ? '+' : '−'}${usdK(Math.abs(r.changeSinceYesterday))}`
                : 'flat'}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <ForecastRangeBar worst={r.worstCase} expected={r.expected} best={r.bestCase} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Cars" value={String(r.projectedCars)} />
        <Stat label="ARO" value={usdK(r.projectedAro)} />
        <Stat label="GP $" value={usdK(r.projectedGpDollars)} />
      </div>

      {(r.ahead?.length || r.behind?.length) ? (
        <div className="mt-4 pt-3 border-t border-mango-line/60 space-y-1.5 text-[12px]">
          {r.behind?.length > 0 && (
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-mango-red shrink-0 mt-0.5" />
              <div>
                <span className="text-mango-red font-medium">Under goal:</span>{' '}
                <span className="text-mango-ink/80">
                  {r.behind.map((a) => `${a.shopName} (${a.pct.toFixed(0)}%)`).join(' · ')}
                </span>
              </div>
            </div>
          )}
          {r.ahead?.length > 0 && (
            <div className="flex items-start gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-mango-green shrink-0 mt-0.5" />
              <div>
                <span className="text-mango-green font-medium">At/over goal:</span>{' '}
                <span className="text-mango-ink/80">
                  {r.ahead.map((a) => `${a.shopName} (${a.pct.toFixed(0)}%)`).join(' · ')}
                </span>
              </div>
            </div>
          )}
          {r.topDrivers?.length > 0 && (
            <div className="flex items-start gap-1.5">
              <Activity className="w-3.5 h-3.5 text-mango-info shrink-0 mt-0.5" />
              <div className="text-mango-ink/80">
                <span className="text-mango-muted">Top drivers:</span>{' '}
                {r.topDrivers.slice(0, 3).map((d) => d.metric).join(' · ')}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// --- Main component -------------------------------------------------------
export default function RevenueProjectionCard({
  range, customStart, customEnd,
}: { range: RangeKey; customStart?: string; customEnd?: string }) {
  const [tab, setTab] = useState<Tab>('portfolio');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  // Tekmetric data-status heartbeat — used to decide whether a refresh is
  // actually available. Updated once per minute from /api/extras?view=data-status.
  const [tekHeartbeatMs, setTekHeartbeatMs] = useState<number | null>(null);

  const projPeriod = rangeToProjectionPeriod(range);
  const past = isPastRange(range, customEnd);
  // Projection is meaningful only for current-period or future-end ranges
  // that the engine supports.
  const isProjectionMode = !past && projPeriod !== null;
  // Custom + projection: need both dates filled before we can fetch.
  const customMissingDates = projPeriod === 'custom' && (!customStart || !customEnd);

  // Shared fetch helper. `bust=true` forces a fresh compute (used by the
  // refresh button); otherwise we hit the SWR cache like normal.
  const loadProjection = (bust = false) => {
    if (!isProjectionMode) { setLoading(false); setData(null); return; }
    if (customMissingDates) { setLoading(false); return; }
    setLoading(true); setErr(false);
    const q = new URLSearchParams({ view: 'projection', period: projPeriod! });
    if (projPeriod === 'custom') { q.set('start', customStart!); q.set('end', customEnd!); }
    if (bust) q.set('bust', '1');
    fetch(`/api/exec-metrics?${q}`)
      .then((r) => r.json())
      .then((d) => { if (d?.shops) setData(d); else setErr(true); })
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProjection(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, customStart, customEnd, isProjectionMode, projPeriod, customMissingDates]);

  // Poll the Tekmetric heartbeat once a minute so we can show a "Refresh"
  // button only when cron has actually written newer data.
  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetch('/api/extras?view=data-status')
        .then((r) => r.json())
        .then((d) => { if (alive) setTekHeartbeatMs(d?.tekmetric ?? null); })
        .catch(() => {});
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const generatedAtMs = data?.generatedAt ? new Date(data.generatedAt).getTime() : null;
  const refreshAvailable =
    !loading && generatedAtMs !== null && tekHeartbeatMs !== null && tekHeartbeatMs > generatedAtMs;
  const generatedAtLabel = generatedAtMs
    ? new Date(generatedAtMs).toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }) + ' MT'
    : null;

  // --- PAST / UNSUPPORTED MODE: passive informational card ----------------
  if (!isProjectionMode) {
    const title = past ? 'Past Revenue Actuals' : 'Revenue Projection — unavailable for this range';
    const alertMsg = past
      ? '* To enable revenue projection, choose a current or future time period.'
      : '* Revenue projection is available for This Week, This Month, This Quarter, or custom ranges ending today or later.';
    return (
      <div data-fs-section className="card mb-6 relative">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-mango-ink/85 flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 text-amber-700 shrink-0" />
          <div>
            <div className="font-semibold text-mango-ink">{alertMsg}</div>
            <div className="mt-1 text-[12px] text-mango-ink/70">Use the time-frame dropdown at the top of the page to switch periods.</div>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-mango-muted">
          Past actuals are visible in Operational Diagnostics and Revenue Opportunity below.
        </p>
      </div>
    );
  }

  // --- CUSTOM RANGE WAITING FOR DATES -------------------------------------
  if (customMissingDates) {
    return (
      <div data-fs-section className="card mb-6 relative">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Revenue Projection</h2>
        </div>
        <div className="rounded-xl border border-mango-line bg-mango-bg/40 px-4 py-3 text-[13px] text-mango-ink/80">
          Select start &amp; end dates in the page time-frame controls to run a custom projection.
        </div>
      </div>
    );
  }

  // --- NORMAL PROJECTION MODE ---------------------------------------------
  return (
    <div data-fs-section className="card mb-6 relative">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Revenue Projection</h2>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Last-computed timestamp + refresh button. Button only enables
              when the Tekmetric data-status heartbeat is newer than the
              projection's generatedAt — i.e., fresh source data exists. */}
          {generatedAtLabel && (
            <span className="text-[11px] text-mango-faint tnum">as of {generatedAtLabel}</span>
          )}
          <button
            onClick={() => loadProjection(true)}
            disabled={!refreshAvailable || loading}
            title={refreshAvailable
              ? 'New Tekmetric data is available — click to recompute the projection.'
              : 'Up to date — no newer source data has arrived since this projection was computed.'}
            className={`text-[11.5px] font-medium rounded-full px-3 py-1.5 inline-flex items-center gap-1.5 transition ${
              refreshAvailable && !loading
                ? 'bg-mango-info/10 text-mango-info hover:bg-mango-info/20 cursor-pointer'
                : 'bg-mango-bg text-mango-faint cursor-not-allowed'
            }`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'animate-spin' : ''}>
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            {refreshAvailable ? 'Refresh now' : 'Up to date'}
          </button>
        </div>
      </div>

      {/* View tabs */}
      <div className="mt-3 flex flex-wrap gap-1.5 border-b border-mango-line pb-2">
        {([['portfolio', 'Portfolio'], ['districts', 'Districts'], ['shops', 'Shop-by-Shop']] as [Tab, string][]).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
              tab === k ? 'bg-mango-ink text-white' : 'text-mango-ink hover:bg-mango-bg'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Current period facts: revenue booked so far + how much of the
          working period has elapsed (the projection's pacing denominator) +
          this period's goal (holiday-adjusted: a 4-day week shows 4/5 the
          5-day goal, so a holiday isn't counted as a shortfall). */}
      {!loading && !err && data && !data.period.isFuture && (
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
          {typeof data.period.actualRevenue === 'number' && (
            <span className="text-mango-muted">Current Revenue:{' '}
              <span className="font-bold text-mango-ink tnum">{usd(data.period.actualRevenue)}</span>
            </span>
          )}
          <span className="text-mango-muted">Period Elapsed:{' '}
            <span className="font-bold text-mango-ink tnum">
              {data.period.workingDaysElapsed.toFixed(1)} days / {data.period.workingDaysTotal} day {data.period.label.toLowerCase().includes('week') ? 'week' : 'period'}
            </span>
          </span>
          {data.portfolio.goalRevenue != null && (
            <span className="text-mango-muted">
              {data.period.label.includes('→') ? 'Period' : `${data.period.label}'s`} Goal:{' '}
              <span className="font-bold text-mango-ink tnum">{usd(data.portfolio.goalRevenue)}</span>
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[160px] animate-pulse rounded-3xl bg-mango-bg" />
          ))}
        </div>
      )}
      {err && !loading && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-mango-ink/80">
          Projection is still warming up (it builds 20 weeks of per-shop history on first load). Refresh in a moment.
        </div>
      )}

      {!loading && !err && data && (
        <div className="mt-4">
          {tab === 'portfolio' && (
            <div className="space-y-3">
              <RollSummary r={data.portfolio} periodLabel={data.period.label} />
            </div>
          )}
          {tab === 'districts' && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {data.districts.map((d) => <RollSummary key={d.label} r={d} periodLabel={data.period.label} />)}
            </div>
          )}
          {tab === 'shops' && (
            <ShopGrid shops={data.shops} backtests={data.backtests} />
          )}
        </div>
      )}
    </div>
  );
}
