// Public diagnostic for the To Do queues. Returns per-shop cache state:
// when was the missed-callbacks / missed-rebooks / declined-jobs cache
// last written, and how many rows does each contain. Lets us tell quickly
// whether a "Nothing to call back" empty state on the dashboard reflects
// reality or a broken cron.
//
// No PII / row content — just counts + timestamps. Safe to leave public.

import { NextResponse } from 'next/server';
import { readCache, cacheUpdatedAt } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';
import { MISSED_CALLBACKS_KEY, type MissedCallbacksShopCache } from '@/lib/handlers/missedCallbacks';
import { MISSED_REBOOKS_KEY } from '@/lib/handlers/missedRebooks';
import { DECLINED_JOBS_KEY } from '@/lib/handlers/declinedJobs';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Cron heartbeats — show whether the sync chain has been running at all.
  // hb_tekmetric / hb_whatconverts are written every cron tick by the warm
  // jobs, so a recent timestamp confirms the cron is firing.
  const [hbTek, hbWc, fbrIdx, mcIdx, djIdx] = await Promise.all([
    cacheUpdatedAt('hb_tekmetric'),
    cacheUpdatedAt('hb_whatconverts'),
    cacheUpdatedAt('fbr_warm_idx'),
    cacheUpdatedAt('missed_callbacks_warm_idx'),
    cacheUpdatedAt('declined_jobs_warm_idx'),
  ]);

  const rows = await Promise.all(SHOPS.map(async (shop) => {
    const [cb, rb, dj, cbUpdated, rbUpdated, djUpdated] = await Promise.all([
      readCache<MissedCallbacksShopCache>(MISSED_CALLBACKS_KEY(shop.num)),
      readCache<{ customers?: unknown[] }>(MISSED_REBOOKS_KEY(shop.num)),
      readCache<{ jobs?: unknown[] }>(DECLINED_JOBS_KEY(shop.num)),
      cacheUpdatedAt(MISSED_CALLBACKS_KEY(shop.num)),
      cacheUpdatedAt(MISSED_REBOOKS_KEY(shop.num)),
      cacheUpdatedAt(DECLINED_JOBS_KEY(shop.num)),
    ]);
    return {
      shopNum: shop.num,
      shopName: shop.name,
      callbacks: {
        cached: !!cb,
        rows: cb?.calls?.length ?? 0,
        salvageable: cb?.calls?.filter(c => (c?.probability ?? 0) >= 0.3).length ?? 0,
        computedAt: cb?.computedAt ?? null,
        updatedAt: cbUpdated ? new Date(cbUpdated).toISOString() : null,
      },
      rebooks: {
        cached: !!rb,
        rows: rb?.customers?.length ?? 0,
        updatedAt: rbUpdated ? new Date(rbUpdated).toISOString() : null,
      },
      declinedJobs: {
        cached: !!dj,
        rows: dj?.jobs?.length ?? 0,
        updatedAt: djUpdated ? new Date(djUpdated).toISOString() : null,
      },
    };
  }));
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    shops: rows,
  });
}
