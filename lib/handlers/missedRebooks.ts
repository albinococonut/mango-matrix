// Missed Rebooks endpoint.
//
// Mirror of the Missed Callbacks handler but for the FBR (re-book) side:
// the customers who came in this rolling 7-day window but did NOT book a
// future appointment (no callback within 14 days either). Surfaces a
// callable list per shop so a manager can work down the queue.
//
// Cache-only read. Per-shop cache `missed_rebooks_<num>` is populated by
// warmFbrForShop (same rolling-7d window the FBR leaderboard uses; no extra
// API surface, no extra Tekmetric fetch — we already have the eligible-RO
// set in memory at that point).

import { NextResponse } from 'next/server';
import { readCache } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';
import { readRebookResolutions, type RebookResolution } from '@/lib/rebookStore';
import { tryWarmInBackground } from '@/lib/warmOnDemand';
import { warmFbrForShop } from '@/lib/syncJobs';

export const MISSED_REBOOKS_KEY = (num: string) => `missed_rebooks_${num}`;

export interface MissedRebookRow {
  roId: number;
  customerId: number;
  customerName: string;
  phone?: string;
  vehicle?: string;
  postedDate: string;             // ISO of the most recent eligible RO for this customer
  resolution?: RebookResolution | null;
}

export interface MissedRebooksShopCache {
  shopNum: string;
  shopName: string;
  computedAt: string;
  windowStart: string;
  windowEnd: string;
  customers: MissedRebookRow[];
}

export interface MissedRebooksResponse {
  shops: Array<{
    shopNum: string;
    shopName: string;
    computedAt: string | null;
    windowStart: string | null;
    windowEnd: string | null;
    customers: MissedRebookRow[];
    pending?: true;
  }>;
}

export async function handle() {
  const shops: MissedRebooksResponse['shops'] = [];
  for (const shop of SHOPS) {
    const cached = await readCache<MissedRebooksShopCache>(MISSED_REBOOKS_KEY(shop.num));
    if (!cached) {
      // Self-heal: kick a background warm so the dashboard's next poll
      // gets data. Missed-rebooks data lives inside the FBR warm pass.
      void tryWarmInBackground('missed-rebooks', shop.num,
        () => warmFbrForShop(shop.num));
      shops.push({
        shopNum: shop.num,
        shopName: shop.name,
        computedAt: null,
        windowStart: null,
        windowEnd: null,
        customers: [],
        pending: true,
      });
      continue;
    }
    // Merge per-RO resolution state so the UI can hide rows the manager
    // already worked + show "won" / "not salvageable" stamps.
    const roIds = (cached.customers || []).map(c => c.roId);
    const resolutions = await readRebookResolutions(roIds);
    const customersWithRes = (cached.customers || []).map(c => ({
      ...c,
      resolution: resolutions.get(c.roId) ?? null,
    }));
    shops.push({
      shopNum: shop.num,
      shopName: shop.name,
      computedAt: cached.computedAt,
      windowStart: cached.windowStart,
      windowEnd: cached.windowEnd,
      customers: customersWithRes,
    });
  }
  return NextResponse.json({ shops });
}
