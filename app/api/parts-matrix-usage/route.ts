import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/serverAuth';
import { SHOPS, SHOP_BY_TEKMETRIC_ID } from '@/lib/shops';
import { fetchROsByCreatedDate } from '@/lib/tekmetric';
import { rosForShop } from '@/lib/dataAccess';
import { classifyPricing, matrixRetail, PricingType } from '@/lib/partsMatrix';
import { readCache, writeCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface PartLine {
  id: string;           // stable: pm_${roId}_${jobId}_${partIdx}
  // identifiers
  roId: number;
  roNumber: number;
  shopNum: string;
  shopName: string;
  roStatus: string;
  roDate: string | null;       // postedDate or createdDate
  jobId: number;
  jobName: string;
  cannedJobId: number | null;
  // part data
  partName: string;
  partNumber: string;
  brand: string;
  qty: number;
  costCents: number;
  retailCents: number;
  matrixCents: number;         // what the matrix says it should be
  varianceCents: number;       // retailCents - matrixCents (negative = underpriced)
  pricingType: PricingType;
}

export interface PartsMatrixPayload {
  lines: PartLine[];
  summary: {
    total: number;
    canned: number;
    matrix: number;
    manual: number;
    no_charge: number;
    manualRevenueLostCents: number; // sum of (matrix - retail) where retail < matrix
    manualRevenueGainedCents: number; // sum of (retail - matrix) where retail > matrix
  };
}

export async function GET(req: NextRequest) {
  const role = await getRole(req);
  if (role !== 'executive') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const shopFilter = sp.get('shop') || 'all';     // 'all' or shop num like '001'
  const start = sp.get('start') || (() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); })();
  const end = sp.get('end') || new Date().toISOString().slice(0, 10);
  const mode = sp.get('mode') || 'all';           // 'all'/'created' = by createdDate, 'posted' = by postedDate, 'open' = createdDate non-closed only

  const bust = sp.get('bust') === '1';
  const cacheKey = `parts_matrix_usage_v3_${shopFilter}_${start}_${end}_${mode}`;
  const cached = await readCache<PartsMatrixPayload>(cacheKey);
  if (cached && !bust) return NextResponse.json({ ...cached, cached: true });

  const startISO = `${start}T00:00:00Z`;
  const endISO = `${end}T23:59:59Z`;

  const shops = shopFilter === 'all'
    ? SHOPS
    : shopFilter.startsWith('district:')
    ? SHOPS.filter((s) => s.district === shopFilter.slice(9))
    : SHOPS.filter((s) => s.num === shopFilter);

  const lines: PartLine[] = [];

  const CLOSED = new Set(['POSTED', 'ACCRECV', 'INVOICED', 'CLOSED']);

  await Promise.all(shops.map(async (shop) => {
    let ros;
    try {
      if (mode === 'posted') {
        // rosForShop checks the rosForChain cache first — warmTekmetric already
        // populates this every 15 min for this_week/this_month/last_7_days,
        // so posted mode is served from Redis (fast) rather than live Tekmetric.
        ros = await rosForShop(shop.tekmetricId, { startISO, endISO });
      } else if (mode === 'open') {
        const all = await fetchROsByCreatedDate(shop.tekmetricId, startISO, endISO);
        ros = all.filter((ro: any) => {
          const s = (ro.repairOrderStatus as any)?.code ?? String(ro.repairOrderStatus ?? '');
          return !CLOSED.has(s);
        });
      } else {
        // 'all' mode: current range + 60-day open-estimate sweep.
        // ROs created before the range start but still open (estimates on the floor
        // from prior weeks) must be included — without this, "This Week" shows 0
        // parts when all active work was opened before Monday.
        // Client timeout is 90s, Vercel maxDuration is 120s — both calls run
        // concurrently per shop so the wall-clock cost is ~max(call1, call2) per shop.
        const sweepStartDate = new Date(startISO);
        sweepStartDate.setDate(sweepStartDate.getDate() - 21);
        const sweepEnd = new Date(startISO);
        sweepEnd.setSeconds(sweepEnd.getSeconds() - 1);
        const [rangeRos, sweepRos] = await Promise.all([
          fetchROsByCreatedDate(shop.tekmetricId, startISO, endISO),
          fetchROsByCreatedDate(shop.tekmetricId, sweepStartDate.toISOString(), sweepEnd.toISOString()),
        ]);
        const openFromSweep = sweepRos.filter((ro: any) => {
          const s = (ro.repairOrderStatus as any)?.code ?? String(ro.repairOrderStatus ?? '');
          return !CLOSED.has(s);
        });
        const seenIds = new Set(rangeRos.map((ro: any) => ro.id));
        ros = [...rangeRos, ...openFromSweep.filter((ro: any) => !seenIds.has(ro.id))];
      }
    } catch {
      return;
    }

    for (const ro of ros) {
      const roDate = ro.postedDate ?? ro.createdDate ?? null;
      const roStatus = (ro.repairOrderStatus as any)?.code ?? String(ro.repairOrderStatus ?? 'UNKNOWN');

      for (const job of (ro.jobs ?? [])) {
        if (!job.parts?.length) continue;

        for (let partIdx = 0; partIdx < job.parts.length; partIdx++) {
          const part = job.parts[partIdx];
          const costCents = part.cost ?? 0;
          const retailCents = part.retail ?? 0;
          const pricingType = classifyPricing(costCents, retailCents, job.cannedJobId ?? null, part.partType?.code);
          const matrixCents = matrixRetail(costCents, retailCents);
          const varianceCents = retailCents - matrixCents;

          lines.push({
            id: `pm_${ro.id}_${job.id}_${partIdx}`,
            roId: ro.id,
            roNumber: ro.repairOrderNumber,
            shopNum: shop.num,
            shopName: shop.name,
            roStatus,
            roDate,
            jobId: job.id,
            jobName: job.name,
            cannedJobId: job.cannedJobId ?? null,
            partName: part.name,
            partNumber: part.partNumber ?? '',
            brand: part.brand ?? '',
            qty: part.quantity ?? 1,
            costCents,
            retailCents,
            matrixCents,
            varianceCents,
            pricingType,
          });
        }
      }
    }
  }));

  const counts = { total: lines.length, canned: 0, matrix: 0, manual: 0, no_charge: 0 };
  let manualRevenueLostCents = 0;
  let manualRevenueGainedCents = 0;

  for (const l of lines) {
    counts[l.pricingType]++;
    if (l.pricingType === 'manual') {
      if (l.varianceCents < 0) manualRevenueLostCents += Math.abs(l.varianceCents);
      else manualRevenueGainedCents += l.varianceCents;
    }
  }

  const payload: PartsMatrixPayload = {
    lines,
    summary: { ...counts, manualRevenueLostCents, manualRevenueGainedCents },
  };

  await writeCache(cacheKey, payload, { ttlSeconds: 2 * 60 * 60 });
  return NextResponse.json(payload);
}
