// Return Customers + Churn leaderboard. For each shop the cron computes the
// following from a single 18-month posted-RO history (unique customers only —
// not repair orders):
//
//   - Rolling 7-day return % = customers seen in the trailing 7 days who had
//     ≥1 prior posted RO at the same shop in the preceding ~6 months.
//   - Week-to-date return % = same question, current window = Monday 00:00 MT
//     through now.
//   - 12-month return %  = unique returning customers served in the last 12
//     months ÷ total unique customers served in the last 12 months. A
//     "returning" customer is one with ≥2 posted ROs in that 12-month window.
//   - Avg visits per year (returning customers) = mean visit count among
//     customers with ≥2 visits in the last 12 months.
//   - Churn %  = customers who were active in months 12–18 ago (the
//     "previously active" set) who have NOT come back in the last 12 months,
//     divided by the previously-active count. Unique customers, not ROs.
//
// All windows are anchored in America/Denver (Mountain) wall-clock.
//
// Hot path is cache-only: never triggers a live fetch. The warm job in
// syncJobs.ts populates one shop per cron tick (round-robin) so a fresh full
// chain refresh completes in ~2 hours. Until a shop's key is populated the
// row is marked `pending` and the UI shows a warming state — never a false 0.

import { NextResponse } from 'next/server';
import { readCache } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';

export const RC_SHOP_KEY = (num: string) => `return_customers_shop_${num}`;

export interface ReturnCustomersShop {
  shopNum: string;
  shopName: string;
  // Rolling 7 days (trailing window ending now)
  returns7d: number;
  total7d: number;
  return7dPct: number;       // 0..1
  // Week to date (Monday 00:00 MT → now)
  returnsWtd: number;
  totalWtd: number;
  returnWtdPct: number;      // 0..1
  // Last 12 months — unique returning ÷ total unique customers
  returns12mo: number;
  total12mo: number;
  return12moPct: number;     // 0..1
  // Avg visit count among returning customers in the last 12 months
  avgVisitsPerYearReturning: number;
  // Churn: customers active in [18mo, 12mo] who didn't come back in [12mo, now]
  previouslyActive: number;
  churned: number;
  churnPct: number;          // 0..1
  computedAt: string;
}

export interface ChainSummary {
  return12moPct: number;
  total12mo: number;
  returns12mo: number;
  avgVisitsPerYearReturning: number;
  churnPct: number;
  previouslyActive: number;
  churned: number;
  shopsReady: number;
  shopsTotal: number;
}

function buildChainSummary(rows: ReturnCustomersShop[]): ChainSummary {
  let sumReturns = 0, sumTotal = 0;
  let sumVisits = 0;          // = sum(avgVisits × returns12mo) across shops
  let sumPrevActive = 0, sumChurned = 0;
  for (const r of rows) {
    sumReturns += r.returns12mo;
    sumTotal += r.total12mo;
    sumVisits += r.avgVisitsPerYearReturning * r.returns12mo;
    sumPrevActive += r.previouslyActive;
    sumChurned += r.churned;
  }
  return {
    return12moPct: sumTotal ? sumReturns / sumTotal : 0,
    total12mo: sumTotal,
    returns12mo: sumReturns,
    avgVisitsPerYearReturning: sumReturns ? sumVisits / sumReturns : 0,
    churnPct: sumPrevActive ? sumChurned / sumPrevActive : 0,
    previouslyActive: sumPrevActive,
    churned: sumChurned,
    shopsReady: rows.length,
    shopsTotal: SHOPS.length,
  };
}

export async function handle() {
  const ready: ReturnCustomersShop[] = [];
  const rows: Array<ReturnCustomersShop | { shopNum: string; shopName: string; pending: true }> = [];
  for (const s of SHOPS) {
    const v = await readCache<ReturnCustomersShop>(RC_SHOP_KEY(s.num));
    if (v) { rows.push(v); ready.push(v); }
    else rows.push({ shopNum: s.num, shopName: s.name, pending: true });
  }
  return NextResponse.json({ shops: rows, chain: buildChainSummary(ready) });
}
