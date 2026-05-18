'use client';

// Client-side dashboard shell. Receives the verified user role from the server
// page and conditionally renders executive-only sections. Employee role only
// sees Trophy Tally and below; executive role sees everything.
//
// Security note: even if a power user edits the JS to render the executive
// sections, the underlying executive-only API routes also check role from the
// signed cookie and return 403 — so no exec data leaks.

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import KpiCards from '@/components/KpiCards';
import RevenueProjectionCard from '@/components/RevenueProjectionCard';
import ForecastCard from '@/components/ForecastCard';
import RevenueOpportunityCard from '@/components/RevenueOpportunityCard';
import PeriodComparison from '@/components/PeriodComparison';
import ShopComparison from '@/components/ShopComparison';
import TrophyTally from '@/components/TrophyTally';
import TrophyTallyYTD from '@/components/TrophyTallyYTD';
import WeeklyLeaderboard from '@/components/WeeklyLeaderboard';
import ShopPerformanceTable from '@/components/ShopPerformanceTable';
import TechProduction from '@/components/TechProduction';
import FBRLeaderboard from '@/components/FBRLeaderboard';
import ShopPerformanceHeatmap from '@/components/ShopPerformanceHeatmap';
import AppointmentBookedRate from '@/components/AppointmentBookedRate';
import GoogleRatings from '@/components/GoogleRatings';
import Comebacks from '@/components/Comebacks';
import type { RangeKey } from '@/lib/dates';
import type { ShopNum } from '@/lib/shops';
import type { ChainKpi } from '@/lib/metrics';
import type { Role } from '@/lib/auth';

interface MetricsResp {
  kpi: ChainKpi;
  daily: Array<{ date: string; revenue: number; cars: number }>;
  dailyByShop: Record<string, Array<{ date: string; revenue: number; cars: number }>>;
}
interface ForecastResp {
  forecast: any; projection: any;
  openROCount: number; techCount: number; techHoursPerDay: number;
}

export default function Dashboard({ role }: { role: Role }) {
  const isExec = role === 'executive';
  const [range, setRange] = useState<RangeKey>('this_month');
  const [shop, setShop] = useState<ShopNum | 'all'>('all');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [metrics, setMetrics] = useState<MetricsResp | null>(null);
  const [forecast, setForecast] = useState<ForecastResp | null>(null);
  const [opportunity, setOpportunity] = useState<any | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string>('');
  useEffect(() => { setRefreshedAt(new Date().toLocaleTimeString()); }, [metrics]);

  useEffect(() => {
    if (range === 'custom' && (!customStart || !customEnd)) return;
    const params: Record<string, string> = { range };
    if (shop !== 'all') params.shop = shop;
    if (range === 'custom') { params.start = customStart; params.end = customEnd; }
    const q = new URLSearchParams(params);
    // /api/metrics is callable by both roles (employee leaderboards need ARO + shop names).
    setMetrics(null);
    fetch(`/api/metrics?${q}`).then((r) => r.json()).then(setMetrics);
    // forecast + opportunity are executive-only and consolidated behind
    // /api/exec-metrics?view=. Skip the fetches for employees both to avoid
    // 403 noise and to make their dashboard load faster.
    if (isExec) {
      setForecast(null); setOpportunity(null);
      fetch(`/api/exec-metrics?view=forecast&${q}`).then((r) => r.json()).then(setForecast);
      fetch(`/api/exec-metrics?view=opportunity&${q}`).then((r) => r.json()).then(setOpportunity);
    }
  }, [range, shop, customStart, customEnd, isExec]);

  async function logout() {
    // Server clears the cookie; redirect to /login.
    await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logout: true }) });
    window.location.href = '/login';
  }

  return (
    <main className="min-h-screen bg-mango-bg px-4 lg:px-8 py-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-2">
        <div className="text-xs text-mango-muted">
          Signed in as <b>{role === 'executive' ? 'Executive' : 'Employee'}</b>
          <button onClick={logout} className="ml-3 text-mango-orange hover:underline">Sign out</button>
        </div>
      </div>

      {/* Brand header: title centered, logo on the right. Visible to both roles. */}
      <div className="grid grid-cols-3 items-center mb-6">
        <div />
        <h1 className="text-3xl font-bold tracking-tight text-center">Mango Matrix</h1>
        <div className="flex justify-end">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Mango Automotive" className="h-16 w-auto" />
        </div>
      </div>

      {/* ------- EXECUTIVE-ONLY SECTIONS (KPIs, charts, heatmap) ------- */}
      {isExec && (
        <>
          <Header
            range={range} setRange={setRange}
            shop={shop} setShop={setShop}
            customStart={customStart} setCustomStart={setCustomStart}
            customEnd={customEnd} setCustomEnd={setCustomEnd}
          />

          <KpiCards kpi={metrics?.kpi || null} />

          {forecast && (
            <RevenueProjectionCard
              {...forecast.projection}
              openROCount={forecast.openROCount}
              techCount={forecast.techCount}
              techHoursPerDay={forecast.techHoursPerDay}
            />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {forecast && <ForecastCard forecast={forecast.forecast} />}
            <RevenueOpportunityCard data={opportunity} />
          </div>

          <PeriodComparison />

          <ShopComparison />
          <ShopPerformanceHeatmap />
        </>
      )}

      {/* ------- VISIBLE TO BOTH ROLES (Trophy Tally and below) ------- */}
      <TrophyTally />
      <TrophyTallyYTD />
      <ShopPerformanceTable kpi={metrics?.kpi || null} range={range} customStart={customStart} customEnd={customEnd} />
      <WeeklyLeaderboard />

      <TechProduction />

      <FBRLeaderboard />
      <Comebacks />
      <GoogleRatings />
      <AppointmentBookedRate />

      <footer className="text-center text-xs text-mango-muted py-6">
        Mango Matrix · Data via Tekmetric + WhatConverts
        {refreshedAt && <> · Refreshed at {refreshedAt}</>}
      </footer>
    </main>
  );
}
