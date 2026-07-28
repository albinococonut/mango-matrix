// GET /api/partner/declined-jobs
//
// Third-party read endpoint: returns all open declined jobs grouped by
// customer visit (RO), enriched with any call outcomes the partner has
// previously written back.
//
// Auth: Bearer token matching PARTNER_API_SECRET env var.
//
// Query params:
//   shop  — shopNum filter, e.g. ?shop=005  (omit for all shops)
//
// Response shape:
//   { generatedAt, shops: [{ shopNum, shopName, computedAt, ros: [ RoRecord ] }] }
//
// RoRecord:
//   { roId, customerId, customerName, phone, vehicle, declinedDate,
//     jobs: [{ jobId, jobName, jobSubtotal }], totalDeclinedValue,
//     callOutcomes: [{ calledAt, calledBy, note, recordingUrl, loggedAt }] }

import { NextRequest, NextResponse } from 'next/server';
import { readCache } from '@/lib/cache';
import { DECLINED_JOBS_KEY, type DeclinedJobsShopCache, type DeclinedJobRow } from '@/lib/handlers/declinedJobs';
import { readDeclinedJobResolutions } from '@/lib/declinedJobStore';
import { readCallOutcomes } from '@/lib/partnerCallStore';
import { SHOPS } from '@/lib/shops';

function isAuthed(req: NextRequest): boolean {
  const secret = process.env.PARTNER_API_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const shopFilter = new URL(req.url).searchParams.get('shop') ?? null;

  const result = [];

  for (const shop of SHOPS) {
    if (shopFilter && shop.num !== shopFilter) continue;

    const cached = await readCache<DeclinedJobsShopCache>(DECLINED_JOBS_KEY(shop.num));
    if (!cached) {
      result.push({ shopNum: shop.num, shopName: shop.name, computedAt: null, ros: [] });
      continue;
    }

    // Merge resolution state so the partner can see whether any job has
    // already been marked won internally.
    const jobIds = cached.jobs.map(j => j.jobId);
    const resolutions = await readDeclinedJobResolutions(jobIds);
    const jobs: DeclinedJobRow[] = cached.jobs.map(j => ({
      ...j,
      resolution: resolutions.get(j.jobId) ?? null,
    }));

    // Group by roId — one RO = one customer visit = one call to make.
    const roMap = new Map<number, {
      roId: number;
      customerId: number;
      customerName: string;
      phone?: string;
      vehicle?: string;
      declinedDate: string;
      jobs: { jobId: number; jobName: string; jobSubtotal: number }[];
      totalDeclinedValue: number;
      alreadyWon: boolean;
    }>();

    for (const j of jobs) {
      if (!roMap.has(j.roId)) {
        roMap.set(j.roId, {
          roId: j.roId,
          customerId: j.customerId,
          customerName: j.customerName,
          phone: j.phone,
          vehicle: j.vehicle,
          declinedDate: j.declinedDate,
          jobs: [],
          totalDeclinedValue: 0,
          alreadyWon: false,
        });
      }
      const ro = roMap.get(j.roId)!;
      ro.jobs.push({ jobId: j.jobId, jobName: j.jobName, jobSubtotal: j.jobSubtotal });
      ro.totalDeclinedValue = Math.round((ro.totalDeclinedValue + j.jobSubtotal) * 100) / 100;
      if (j.resolution?.status === 'won') ro.alreadyWon = true;
    }

    // Fetch call outcomes for all ROs in this shop in parallel.
    const roIds = Array.from(roMap.keys());
    const outcomesArr = await Promise.all(roIds.map(id => readCallOutcomes(id)));
    const outcomesMap = new Map(roIds.map((id, i) => [id, outcomesArr[i]]));

    const ros = Array.from(roMap.values()).map(ro => ({
      roId: ro.roId,
      customerId: ro.customerId,
      customerName: ro.customerName,
      phone: ro.phone ?? null,
      vehicle: ro.vehicle ?? null,
      declinedDate: ro.declinedDate,
      jobs: ro.jobs,
      totalDeclinedValue: ro.totalDeclinedValue,
      alreadyWon: ro.alreadyWon,
      callOutcomes: outcomesMap.get(ro.roId) ?? [],
    }));

    result.push({
      shopNum: shop.num,
      shopName: shop.name,
      computedAt: cached.computedAt,
      ros,
    });
  }

  return NextResponse.json({ generatedAt: new Date().toISOString(), shops: result });
}
