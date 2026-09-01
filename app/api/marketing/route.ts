// Marketing dashboard API.
// Spend data is returned immediately (hardcoded from QuickBooks P&Ls).
// New-customer counts are expensive to compute (full Tekmetric RO history per shop)
// and are only returned from Redis cache — the cron job populates them separately
// via ?job=warm-marketing-new-customers.
// Add ?warm=1 with the CRON_SECRET bearer token to trigger a fresh computation here.

import { NextRequest, NextResponse } from 'next/server';
import { readCache } from '@/lib/cache';
import { computeAndCacheNewCustomers, MARKETING_NC_CACHE_KEY, ShopMonthNewCustomers } from '@/lib/marketingNewCustomers';
import { readAttributionCache } from '@/lib/marketingAttribution';
import { readRepairPalCache } from '@/lib/repairPalData';
import { readUpswellCache } from '@/lib/upswellData';
import { readReferralCostsCache } from '@/lib/referralCostsData';
import {
  MONTHLY_SPEND,
  POSTCARD_CAMPAIGNS,
  allMonthlyMonths,
} from '@/lib/marketingSpend';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function constEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(req: NextRequest) {
  const wantWarm = req.nextUrl.searchParams.get('warm') === '1';

  if (wantWarm) {
    const expected = process.env.CRON_SECRET ?? process.env.CRON_SECRET_ADMIN;
    const token    = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!expected || !constEq(token, expected)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const rows = await computeAndCacheNewCustomers();
    return NextResponse.json({ warmed: true, rows: rows.length });
  }

  // Always return spend immediately — never block on Tekmetric
  const [cached, attrCached, repairPalCached, upswellCached, referralCostsCached] = await Promise.all([
    readCache<ShopMonthNewCustomers[]>(MARKETING_NC_CACHE_KEY),
    readAttributionCache(),
    readRepairPalCache(),
    readUpswellCache(),
    readReferralCostsCache(),
  ]);

  return NextResponse.json({
    spend:             MONTHLY_SPEND,
    postcardCampaigns: POSTCARD_CAMPAIGNS,
    months:            allMonthlyMonths(),
    newCustomers:      cached ?? [],
    newCustomersReady: (cached?.length ?? 0) > 0,
    attribution:       attrCached ?? null,
    repairPal:         repairPalCached ?? null,
    upswell:           upswellCached ?? null,
    referralCosts:     referralCostsCached ?? null,
    computedAt:        new Date().toISOString(),
  });
}
