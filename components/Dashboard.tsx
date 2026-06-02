'use client';

// Dashboard — shared content component for the executive Diagnostic page
// AND the Employee View page. Layout/sidebar are provided by the parent
// shell (ExecShell or EmployeeShell), so this component only renders sections.
//
//   category='diagnostic' → render exec-only sections + Golden/Trophies/Operations
//   category='employee'    → render Golden/Trophies/Operations only (no Header,
//                            no range selector, no GoogleRatings for non-execs)
//
// Security note: even if a power user edits the JS, the executive-only API
// routes also verify role from the signed cookie and return 403, so no exec
// data leaks regardless of which UI sections render.

import { useEffect, useState } from 'react';
import GoldenMangoHero from '@/components/GoldenMangoHero';
import Header from '@/components/Header';
import KpiCards from '@/components/KpiCards';
import RevenueProjectionCard from '@/components/RevenueProjectionCard';
import RevenueOpportunityCard from '@/components/RevenueOpportunityCard';
import PeriodComparison from '@/components/PeriodComparison';
import ShopComparison from '@/components/ShopComparison';
import TrophyTally from '@/components/TrophyTally';
import TrophyTallyYTD from '@/components/TrophyTallyYTD';
import HighestLeverageByShop from '@/components/HighestLeverageByShop';
import WeeklyLeaderboard from '@/components/WeeklyLeaderboard';
import ShopPerformanceTable from '@/components/ShopPerformanceTable';
import TechProduction from '@/components/TechProduction';
import FBRLeaderboard from '@/components/FBRLeaderboard';
import ShopPerformanceHeatmap from '@/components/ShopPerformanceHeatmap';
import AccountsReceivable from '@/components/AccountsReceivable';
import AppointmentBookedRate from '@/components/AppointmentBookedRate';
import TodoRecoveries from '@/components/TodoRecoveries';
import GoogleRatings from '@/components/GoogleRatings';
import Comebacks from '@/components/Comebacks';
import ReturnCustomersLeaderboard from '@/components/ReturnCustomersLeaderboard';
import type { RangeKey } from '@/lib/dates';
import type { ShopNum } from '@/lib/shops';
import type { ChainKpi } from '@/lib/metrics';
import type { Role } from '@/lib/auth';

interface MetricsResp {
  kpi: ChainKpi;
  daily: Array<{ date: string; revenue: number; cars: number }>;
  dailyByShop: Record<string, Array<{ date: string; revenue: number; cars: number }>>;
}

type Category = 'diagnostic' | 'employee';

export default function Dashboard({
  role, category,
}: { role: Role; category: Category }) {
  const isExec = role === 'executive';
  const showExecSections = isExec && category === 'diagnostic';
  const [range, setRange] = useState<RangeKey>('this_week');
  const [shop, setShop] = useState<ShopNum | 'all'>('all');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [metrics, setMetrics] = useState<MetricsResp | null>(null);
  const [spcMetrics, setSpcMetrics] = useState<MetricsResp | null>(null);
  const [opportunity, setOpportunity] = useState<any | null>(null);
  // Real data-refresh times per source (from sync-job heartbeats), shown in
  // Mountain Time so every viewer sees the same value.
  const [dataStatus, setDataStatus] = useState<{ tekmetric: number | null; whatconverts: number | null; revenueSettledThrough?: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => fetch('/api/extras?view=data-status').then(r => r.json()).then(d => { if (alive) setDataStatus(d); }).catch(() => {});
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const fmtMT = (ms: number | null) =>
    ms ? new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }) + ' MT' : null;

  useEffect(() => {
    if (range === 'custom' && (!customStart || !customEnd)) return;
    const params: Record<string, string> = { range };
    if (shop !== 'all') params.shop = shop;
    if (range === 'custom') { params.start = customStart; params.end = customEnd; }
    const q = new URLSearchParams(params);
    // /api/metrics is callable by both roles (employee leaderboards need ARO + shop names).
    setMetrics(null);
    fetch(`/api/metrics?${q}`).then((r) => r.json()).then(setMetrics);
    // opportunity is executive-only behind /api/exec-metrics?view=opportunity.
    // Skip for non-exec or when we're not rendering exec sections to avoid
    // 403 noise and speed up the page.
    if (isExec && showExecSections) {
      setOpportunity(null);
      fetch(`/api/exec-metrics?view=opportunity&${q}`).then((r) => r.json()).then(setOpportunity);
    }
  }, [range, shop, customStart, customEnd, isExec, showExecSections]);

  // Shop Performance Comparison is always This Week, independent of the filter.
  useEffect(() => {
    fetch('/api/metrics?range=this_month').then((r) => r.json()).then(setSpcMetrics).catch(() => {});
  }, []);

  return (
    <>
      {showExecSections && (
        <>
          <Header
            range={range} setRange={setRange}
            shop={shop} setShop={setShop}
            customStart={customStart} setCustomStart={setCustomStart}
            customEnd={customEnd} setCustomEnd={setCustomEnd}
          />

          <section id="projection" className="scroll-mt-6">
            <RevenueProjectionCard range={range} customStart={customStart} customEnd={customEnd} />
          </section>

          <section id="overview" className="scroll-mt-6">
            <KpiCards kpi={metrics?.kpi || null} range={range} />
          </section>

          <section id="opportunity" className="scroll-mt-6 mb-8">
            <RevenueOpportunityCard data={opportunity} kpi={metrics?.kpi ?? null} range={range} />
          </section>

          <section id="comparison" className="scroll-mt-6">
            <ShopComparison />
          </section>

          <section id="performance" className="scroll-mt-6">
            <ShopPerformanceHeatmap />
          </section>

          <section id="trends" className="scroll-mt-6">
            <PeriodComparison />
          </section>

          <section id="receivables" className="scroll-mt-6">
            <AccountsReceivable />
          </section>

          <section id="return-customers" className="scroll-mt-6">
            <ReturnCustomersLeaderboard />
          </section>

          {/* Past Trophies Earned this Quarter — moved here from Employee
              view at user request so the YTD trophy ledger sits at the END
              of the diagnostic. Live week's medals still live on the
              Employee view under "Pending / Awarded Trophies · This Week";
              this widget tracks the cumulative quarterly leaderboard. */}
          <section id="trophies-ytd" className="scroll-mt-6">
            <TrophyTallyYTD />
          </section>
        </>
      )}

      {/* Golden Mango · Trophy Standings · Operations belong to Employee View
          only. They were previously rendered on both Diagnostic and Employee
          for execs — that duplication is removed. Executives can still see
          these sections by navigating to the Employee View category. */}
      {category === 'employee' && (
        <>
          <section id="golden" className="scroll-mt-6">
            <GoldenMangoHero />
          </section>

          <section id="trophies" className="scroll-mt-6">
            <TrophyTally />
            {/* TrophyTallyYTD relocated to end of Diagnostic — see comment
                above its current render site. */}
            <HighestLeverageByShop />
            <WeeklyLeaderboard />
          </section>

          <section id="operations" className="scroll-mt-6">
            <TechProduction />
            <Comebacks />
            <FBRLeaderboard />
            {isExec && <GoogleRatings />}
            <AppointmentBookedRate />
            <TodoRecoveries />
            <ShopPerformanceTable kpi={spcMetrics?.kpi || null} range={'this_month'} customStart={customStart} customEnd={customEnd} isExec={isExec} />
          </section>
        </>
      )}

      <footer className="text-center text-xs text-mango-faint py-8">
        The Mango Matrix
        {dataStatus && (
          <>
            {' · '}Tekmetric {fmtMT(dataStatus.tekmetric) ?? 'syncing…'}
            {' · '}WhatConverts {fmtMT(dataStatus.whatconverts) ?? 'syncing…'}
            {dataStatus.revenueSettledThrough && <>{' · '}Revenue settled through {dataStatus.revenueSettledThrough}</>}
          </>
        )}
        <div className="mt-1 text-[11px] text-mango-faint/80">
          * USPS / Post-Office fleet revenue is included in revenue totals, but excluded from all other metrics (car count, GP, ARO, close rate, leaderboards).
        </div>
      </footer>
    </>
  );
}
