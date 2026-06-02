// Declined Jobs — the third To Do queue.
//
// Surfaces unauthorized jobs (the customer was offered the work and didn't
// say yes) where the RO closed > 30 days ago. After a month is the right
// follow-up window: enough time has passed that the customer has had to
// drive on it; not so much that the offer is stale.
//
// Per-shop cache `declined_jobs_<num>` is populated by warmDeclinedJobsForShop
// (round-robin, one shop per cron tick). Read path merges in resolution
// state from `declined_job_resolution_<jobId>` keys.

import { NextResponse } from 'next/server';
import { readCache } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';
import { readDeclinedJobResolutions, type DeclinedJobResolution } from '@/lib/declinedJobStore';
import { tryWarmInBackground } from '@/lib/warmOnDemand';
import { warmDeclinedJobsForShop } from '@/lib/syncJobs';

export const DECLINED_JOBS_KEY = (num: string) => `declined_jobs_${num}`;

export interface DeclinedJobRow {
  jobId: number;
  roId: number;
  customerId: number;
  customerName: string;
  phone?: string;
  jobName: string;
  jobSubtotal: number;            // dollars
  declinedDate: string;           // ISO — uses the RO's postedDate (= when customer left without authorizing)
  resolution?: DeclinedJobResolution | null;
}

export interface DeclinedJobsShopCache {
  shopNum: string;
  shopName: string;
  shopId: number;                 // tekmetric shopId — used by the UI to build the RO admin URL
  computedAt: string;
  windowStart: string;
  windowEnd: string;
  jobs: Omit<DeclinedJobRow, 'resolution'>[];
}

export interface DeclinedJobsResponse {
  shops: Array<{
    shopNum: string;
    shopName: string;
    shopId?: number;
    computedAt: string | null;
    windowStart: string | null;
    windowEnd: string | null;
    jobs: DeclinedJobRow[];
    pending?: true;
  }>;
}

/**
 * Tekmetric admin URL for a single repair order. Pattern is a best-guess
 * matching the common Tekmetric admin layout; if their actual URL is
 * different, edit here in one place and every Declined Jobs link follows.
 */
export function tekmetricRoUrl(shopId: number, roId: number): string {
  return `https://shop.tekmetric.com/admin/shop/${shopId}/repair-orders/${roId}`;
}

export async function handle() {
  const out: DeclinedJobsResponse['shops'] = [];
  for (const shop of SHOPS) {
    const cached = await readCache<DeclinedJobsShopCache>(DECLINED_JOBS_KEY(shop.num));
    if (!cached) {
      // Self-heal: kick a background warm so next poll has data.
      void tryWarmInBackground('declined-jobs', shop.num,
        () => warmDeclinedJobsForShop(shop.num));
      out.push({
        shopNum: shop.num,
        shopName: shop.name,
        computedAt: null,
        windowStart: null,
        windowEnd: null,
        jobs: [],
        pending: true,
      });
      continue;
    }
    const jobIds = cached.jobs.map(j => j.jobId);
    const resolutions = await readDeclinedJobResolutions(jobIds);
    out.push({
      shopNum: shop.num,
      shopName: shop.name,
      shopId: cached.shopId,
      computedAt: cached.computedAt,
      windowStart: cached.windowStart,
      windowEnd: cached.windowEnd,
      jobs: cached.jobs.map(j => ({ ...j, resolution: resolutions.get(j.jobId) ?? null })),
    });
  }
  return NextResponse.json({ shops: out });
}
