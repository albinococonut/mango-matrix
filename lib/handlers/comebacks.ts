// Comebacks tracker. A "comeback" = a tech being paid for work but the customer
// isn't being charged (warranty / re-do). Heuristic: an authorized job with
// laborHours > 0 but a tiny or zero customer-facing total. We surface counts,
// dollar exposure, AND estimated REVENUE LOST per shop. Revenue lost is the
// billable revenue Mango would have earned per hour of tech time, derived from
// each shop's own labor+parts mix (laborSales+partsSales / total labor hours).

import { NextRequest, NextResponse } from 'next/server';
import { rosForChain } from '@/lib/dataAccess';
import { isCountedRO, isFreeByDesign } from '@/lib/metrics';
import { SHOPS, SHOP_BY_TEKMETRIC_ID } from '@/lib/shops';
import { resolveRange, customRange, RangeKey } from '@/lib/dates';
import { c2d } from '@/lib/tekmetric';

const COMEBACK_MIN_HOURS = 1.3;  // must be STRICTLY MORE than 1.3 h
const COMEBACK_MAX_CHARGE = 0;   // must be $0 — no partial charges

// isFreeByDesign is now shared from lib/metrics.ts so the comebacks handler
// and the Golden Mango ceremony (lib/goldenMango.ts computeStandings) use
// identical logic. "Re-Inspect / REINS" is intentionally NOT free-by-design —
// it IS a comeback (customer returning because a repair wasn't done right).

const LABOR_RATE_BY_SHOP: Record<string, number> = {
  '001': 59, '002': 54, '003': 50, '004': 52, '005': 55, '006': 53, '007': 48, '009': 54,
};

// Per-ticket detail returned alongside the shop aggregate.
export interface ComebackTicket {
  roId: number;
  shopId: number; // Tekmetric numeric shop ID (for URL construction)
  roNumber: number;
  postedDate: string;
  jobName: string;
  hours: number;
  estLaborCost: number;
  revenueLost: number;
  reason: 'reinspect' | 'heuristic';
}

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
      revenuePerHour: number;
      ros: number;
      tickets: ComebackTicket[];
    };
    const byShop: Record<string, Row> = {};
    const shopBillable: Record<string, { laborSales: number; partsSales: number; laborHours: number }> = {};
    for (const s of SHOPS) {
      byShop[s.num] = { shopNum: s.num, shopName: s.name, comebackJobs: 0, comebackHours: 0, estLaborCost: 0, revenueLost: 0, revenuePerHour: 0, ros: 0, tickets: [] };
      shopBillable[s.num] = { laborSales: 0, partsSales: 0, laborHours: 0 };
    }
    // Collect raw comeback tickets — ONE entry per RO (not per job).
    // An RO can have multiple comeback jobs; we roll them up into a single
    // row so the same RO number doesn't appear multiple times in the list.
    const rawTickets: { key: string; ticket: Omit<ComebackTicket, 'revenueLost'> }[] = [];
    // roTicketMap deduplicates by roId so we can accumulate per-RO totals.
    const roTicketMap = new Map<number, { key: string; ticket: Omit<ComebackTicket, 'revenueLost'>; jobNames: string[] }>();
    const seenROs = new Set<number>();
    for (const o of ros) {
      if (!isCountedRO(o)) continue;
      const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
      if (!meta) continue;
      const key = meta.num;
      shopBillable[key].laborSales += c2d(o.laborSales);
      shopBillable[key].partsSales += c2d(o.partsSales);
      for (const j of o.jobs) {
        const hours = j.laborHours || 0;
        if (j.authorized) shopBillable[key].laborHours += hours;
        const isReinspect = /re-?inspect|reins/i.test(j.jobCategoryName || '');
        const customerCharge = c2d(j.subtotal || 0);
        const heuristicHit =
          j.authorized && hours > COMEBACK_MIN_HOURS && customerCharge <= COMEBACK_MAX_CHARGE;
        if (!isReinspect && !heuristicHit) continue;
        // Skip jobs that are free by design (digital inspections, free A/C checks, etc.)
        // These are intentional — the shop pays the tech but never bills the customer.
        if (isFreeByDesign(j.name || '', j.jobCategoryName || '')) continue;
        byShop[key].comebackJobs++;
        byShop[key].comebackHours += hours;
        const estCost = hours * (LABOR_RATE_BY_SHOP[key] ?? 50);
        byShop[key].estLaborCost += estCost;
        if (!seenROs.has(o.id)) { byShop[key].ros++; seenROs.add(o.id); }
        // Roll up into one ticket per RO — accumulate hours and job names
        const jobName = j.name || (isReinspect ? 'Re-Inspect' : 'Comeback');
        if (roTicketMap.has(o.id)) {
          const existing = roTicketMap.get(o.id)!;
          existing.ticket.hours += hours;
          existing.ticket.estLaborCost += estCost;
          if (!existing.jobNames.includes(jobName)) existing.jobNames.push(jobName);
          existing.ticket.jobName = existing.jobNames.join(', ');
          // Upgrade reason to reinspect if any job is reinspect
          if (isReinspect) existing.ticket.reason = 'reinspect';
        } else {
          roTicketMap.set(o.id, {
            key,
            ticket: {
              roId: o.id,
              shopId: o.shopId,
              roNumber: o.repairOrderNumber,
              postedDate: o.postedDate || '',
              jobName,
              hours,
              estLaborCost: estCost,
              reason: isReinspect ? 'reinspect' : 'heuristic',
            },
            jobNames: [jobName],
          });
        }
      }
    }
    // Flatten deduplicated map to ordered array
    for (const { key, ticket } of roTicketMap.values()) {
      rawTickets.push({ key, ticket });
    }
    // Second pass: assign revenueLost to each ticket now that per-shop
    // revenue/hour is known, then attach tickets to shop rows.
    for (const s of SHOPS) {
      const sb = shopBillable[s.num];
      const revPerHour = sb.laborHours > 0 ? (sb.laborSales + sb.partsSales) / sb.laborHours : 0;
      byShop[s.num].revenuePerHour = revPerHour;
      byShop[s.num].revenueLost = byShop[s.num].comebackHours * revPerHour;
    }
    for (const { key, ticket } of rawTickets) {
      const revPerHour = byShop[key].revenuePerHour;
      byShop[key].tickets.push({ ...ticket, revenueLost: ticket.hours * revPerHour });
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
