// Comebacks tracker. A "comeback" = a tech being paid for work but the customer
// isn't being charged (warranty / re-do). Heuristic: an authorized job with
// laborHours > 0 but a tiny or zero customer-facing total. We surface counts,
// dollar exposure, AND estimated REVENUE LOST per shop. Revenue lost is the
// billable revenue Mango would have earned per hour of tech time, derived from
// each shop's own labor+parts mix (laborSales+partsSales / total labor hours).

import { NextRequest, NextResponse } from 'next/server';
import { rosForChain } from '@/lib/dataAccess';
import { isCountedRO } from '@/lib/metrics';
import { SHOPS, SHOP_BY_TEKMETRIC_ID } from '@/lib/shops';
import { resolveRange, customRange, RangeKey } from '@/lib/dates';
import { c2d } from '@/lib/tekmetric';

const COMEBACK_MIN_HOURS = 0.25;
const COMEBACK_MAX_CHARGE = 20.00;

const LABOR_RATE_BY_SHOP: Record<string, number> = {
  '001': 59, '002': 54, '003': 50, '004': 52, '005': 55, '006': 53, '007': 48, '009': 54,
};

export async function handle(req: NextRequest) {
  const range = (req.nextUrl.searchParams.get('range') as RangeKey) || 'last_week';
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');
  const w = range === 'custom' && start && end ? customRange(start, end) : resolveRange(range);
  try {
    const ros = await rosForChain({ startISO: w.startISO, endISO: w.endISO });
    type Row = {
      shopNum: string; shopName: string;
      comebackJobs: number; comebackHours: number;
      estLaborCost: number; revenueLost: number;
      revenuePerHour: number; // for display in tooltip
      ros: number;
    };
    const byShop: Record<string, Row> = {};
    // Per-shop labor + parts $ totals and total labor hours, used to derive
    // the "revenue per tech hour" multiplier. We sum over authorized jobs on
    // revenue-realized ROs so the ratio reflects actual billable mix.
    const shopBillable: Record<string, { laborSales: number; partsSales: number; laborHours: number }> = {};
    for (const s of SHOPS) {
      byShop[s.num] = { shopNum: s.num, shopName: s.name, comebackJobs: 0, comebackHours: 0, estLaborCost: 0, revenueLost: 0, revenuePerHour: 0, ros: 0 };
      shopBillable[s.num] = { laborSales: 0, partsSales: 0, laborHours: 0 };
    }
    const seenROs = new Set<number>();
    for (const o of ros) {
      if (!isCountedRO(o)) continue;
      const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
      if (!meta) continue;
      const key = meta.num;
      // Tally billable totals for the per-shop revenue/hour multiplier.
      shopBillable[key].laborSales += c2d(o.laborSales);
      shopBillable[key].partsSales += c2d(o.partsSales);
      for (const j of o.jobs) {
        if (!j.authorized) continue;
        const hours = j.laborHours || 0;
        shopBillable[key].laborHours += hours;
        if (hours < COMEBACK_MIN_HOURS) continue;
        const customerCharge = c2d(j.subtotal || 0);
        if (customerCharge > COMEBACK_MAX_CHARGE) continue;
        // Comeback signature: tech earned hours but customer paid ≤ $20.
        byShop[key].comebackJobs++;
        byShop[key].comebackHours += hours;
        byShop[key].estLaborCost += hours * (LABOR_RATE_BY_SHOP[key] ?? 50);
        if (!seenROs.has(o.id)) { byShop[key].ros++; seenROs.add(o.id); }
      }
    }
    // Compute revenue lost = comebackHours × (laborSales + partsSales) / totalLaborHours per shop.
    for (const s of SHOPS) {
      const sb = shopBillable[s.num];
      const revPerHour = sb.laborHours > 0 ? (sb.laborSales + sb.partsSales) / sb.laborHours : 0;
      byShop[s.num].revenuePerHour = revPerHour;
      byShop[s.num].revenueLost = byShop[s.num].comebackHours * revPerHour;
    }
    return NextResponse.json({
      window: { startISO: w.startISO, endISO: w.endISO, label: w.label },
      shops: SHOPS.map(s => byShop[s.num]),
    });
  } catch (e: any) {
    console.error('[comebacks] failed:', e);
    return NextResponse.json({ error: e?.message || 'comebacks failed' }, { status: 500 });
  }
}
