// Pure functions that compute every metric the dashboard shows.
// Input: RepairOrder[] from Tekmetric. Output: numbers/series the UI renders.
// Money values from Tekmetric are integer cents -- we convert ONCE at the boundary.

import type { RepairOrder } from './tekmetric';
import { c2d } from './tekmetric';
import { SHOPS, SHOP_BY_TEKMETRIC_ID, Shop } from './shops';
import { addDays, differenceInCalendarDays, isWeekend, startOfDay } from 'date-fns';
import { CHAIN_TZ } from './dates';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

// --- Core scalars ---

export interface ShopKpi {
  shopId: number;
  shopNum: string;
  shopName: string;
  revenue: number;        // ex-tax, dollars
  cars: number;
  aro: number;            // dollars
  closeRate: number;      // 0..1
  gpDollars: number;
  gpPct: number;          // 0..1
  partsGpPct: number;
  laborGpPct: number;
  discounts: number;
  // Average Work Recommended per RO — sum of every job's subtotal (authorized
  // OR declined) divided by RO count. Real number, not derived from ARO / CR.
  awro: number;           // dollars
  presentedDollars: number; // dollars — sum of all job subtotals (for chain rollup)
  // Approved Sales — sum of AUTHORIZED job subtotals only. Matches the
  // "Approved Sales" line in the corporate weekly review spreadsheet.
  approvedDollars: number;
}

export interface ChainKpi {
  totalRevenue: number;
  totalCars: number;
  averageAro: number;
  closeRate: number;
  byShop: ShopKpi[];
}

/**
 * "Cars" = unique vehicleIds with at least one POSTED RO in window (Mango definition).
 * "Revenue" = ex-tax total = laborSales + partsSales + subletSales + feeTotal - discountTotal
 *   (Tekmetric's totalSales INCLUDES tax. We strip it for parity with the live dashboard's "ex-tax".)
 * "ARO" = revenue / cars
 * "Close Rate" = approved jobs / presented jobs across all ROs (proxy: authorized=true / total)
 * "GP$" = revenue - total parts cost (sum of part.cost across all RO parts)
 */
export function chainKpi(orders: RepairOrder[]): ChainKpi {
  // Per-shop rows use the PRIMARY tekmetricId only — secondary instances (e.g. Yuma-B
  // shopId 18346) are folded into chain totals but never shown as a separate row.
  const byShopGroups = new Map<string, RepairOrder[]>();
  // Non-fleet secondaries (true overflow bays): count toward both revenue and cars.
  let secondaryOnly: RepairOrder[] = [];
  // Fleet-only secondaries (e.g. Yuma-B / USPS contract): revenue only — cars, GP,
  // ARO, and close rate are deliberately excluded to keep retail metrics clean.
  let fleetOnlySecondary: RepairOrder[] = [];
  for (const o of orders) {
    const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
    if (!meta) continue;
    if (meta.tekmetricIdSecondary === o.shopId) {
      if (meta.tekmetricIdSecondaryFleetOnly) {
        fleetOnlySecondary.push(o);
      } else {
        secondaryOnly.push(o);
      }
      continue;
    }
    const arr = byShopGroups.get(meta.num) ?? [];
    arr.push(o);
    byShopGroups.set(meta.num, arr);
  }
  const byShop: ShopKpi[] = [];
  for (const [num, list] of byShopGroups) {
    const meta = SHOPS.find(s => s.num === num);
    if (!meta) continue;
    byShop.push(shopKpi(meta, list));
  }
  // Pad missing shops with zero rows so consumers (Shop Performance table,
  // Employee leaderboards, concept2 grids, etc.) ALWAYS see all 8 shops.
  // Without this, early Monday morning the table would only show shops that
  // had already closed a ticket today, dropping the others off the page —
  // and a manager comparing performance can't see the absent shops at all.
  for (const meta of SHOPS) {
    if (!byShopGroups.has(meta.num)) {
      byShop.push(shopKpi(meta, []));
    }
  }
  // Chain totals: per-shop primary rows + secondary ROs.
  // Non-fleet secondaries contribute to both revenue and cars.
  const secondaryRevenueDollars = secondaryOnly
    .filter(isCountedRO)
    .reduce((s, o) => s + c2d(o.laborSales + o.partsSales + o.subletSales + o.feeTotal - o.discountTotal), 0);
  const secondaryCars = secondaryOnly.filter(isCountedRO).length;
  // Fleet-only secondaries (Yuma-B): revenue must reconcile to Tekmetric's Net
  // Sales but their cars/GP/ARO must NOT pollute retail metrics. Only check
  // posting status here — customer-ID exclusions were for Yuma-primary legacy
  // accounts and don't apply to the Yuma-B shop profile.
  const fleetSecondaryRevenue = fleetOnlySecondary
    .filter(o => COUNTED_STATUSES.has(o.repairOrderStatus?.code))
    .reduce((s, o) => s + c2d(o.laborSales + o.partsSales + o.subletSales + o.feeTotal - o.discountTotal), 0);
  // USPS add-back for any legacy orders still on Yuma primary under the old
  // customer IDs. These were the original USPS accounts before the contract
  // moved to Yuma-B; typically zero now but kept for historical accuracy.
  const uspsRevenue = orders.reduce((s, o) =>
    (COUNTED_STATUSES.has(o.repairOrderStatus?.code) && EXCLUDED_CUSTOMER_IDS.has(o.customerId))
      ? s + c2d(o.laborSales + o.partsSales + o.subletSales + o.feeTotal - o.discountTotal)
      : s, 0);
  // Clean retail revenue drives ARO; reported total adds fleet/USPS back.
  const cleanRevenue = byShop.reduce((s, k) => s + k.revenue, 0) + secondaryRevenueDollars;
  const totalRevenue = cleanRevenue + uspsRevenue + fleetSecondaryRevenue;
  const totalCars = byShop.reduce((s, k) => s + k.cars, 0) + secondaryCars;
  // Attribute all non-retail revenue to the Yuma row's headline so the
  // per-shop table reconciles to the chain total — cars/ARO/GP% stay clean.
  const yumaAddon = uspsRevenue + fleetSecondaryRevenue;
  if (yumaAddon > 0) {
    const yuma = byShop.find(k => k.shopNum === '006');
    if (yuma) yuma.revenue += yumaAddon;
  }
  // Close rate: only count jobs on revenue-realized ROs so we match Tekmetric's denominator
  const closeNum = orders.reduce((s, o) => isCountedRO(o) ? s + o.jobs.filter(j => j.authorized).length : s, 0);
  const closeDen = orders.reduce((s, o) => isCountedRO(o) ? s + o.jobs.length : s, 0);
  // Sort byShop by canonical shop number order (matches the order in SHOPS).
  const order = new Map<string, number>(SHOPS.map((s, i) => [s.num as string, i]));
  return {
    totalRevenue,
    totalCars,
    averageAro: totalCars ? cleanRevenue / totalCars : 0, // ARO excludes USPS
    closeRate: closeDen ? closeNum / closeDen : 0,
    byShop: byShop.sort((a, b) => (order.get(a.shopNum) ?? 99) - (order.get(b.shopNum) ?? 99)),
  };
}

/**
 * Tekmetric "Net Sales" report only counts ROs in POSTED or ACCRECV status.
 * Other statuses (WORKINPROGRESS, COMPLETE, ESTIMATE, etc.) are pending work
 * that hasn't been finalized to revenue. We must filter to match.
 */
const COUNTED_STATUSES = new Set(['POSTED', 'ACCRECV']);

/**
 * Historical-cleanup exclusions. The Yuma primary shop accidentally absorbed Post Office
 * (USPS) ROs in the past; that fleet contract has since been moved to Yuma-B. To make
 * the per-shop history clean, drop those customer IDs from Yuma primary metrics.
 */
const EXCLUDED_CUSTOMER_IDS = new Set<number>([
  41675365, // "YUMA POST OFFICE"
  41674963, // "ESTIMATE POST OFFICE EMPLOYEE"
]);

export function isCountedRO(o: RepairOrder): boolean {
  if (!COUNTED_STATUSES.has(o.repairOrderStatus?.code)) return false;
  if (EXCLUDED_CUSTOMER_IDS.has(o.customerId)) return false;
  return true;
}

/**
 * Returns true for jobs that are deliberately free — the shop pays the tech
 * but never charges the customer. These must NOT count as comebacks in any
 * context (the comebacks handler, the Golden Mango ceremony, the TV view, etc.).
 *
 * Shared here so the comebacks handler and computeStandings() in goldenMango.ts
 * use identical logic. Previously `isFreeByDesign` was a private function in
 * lib/handlers/comebacks.ts and was never applied to the Friday crown ceremony,
 * causing shops with lots of complimentary inspections (e.g. Cottonwood) to
 * accumulate false comebacks and lose the Comebacks medal to shops that do
 * fewer free inspections (e.g. Yuma, which is fleet-heavy).
 */
export function isFreeByDesign(jobName: string, categoryName: string): boolean {
  const n = jobName.toLowerCase();
  const c = categoryName.toLowerCase();
  // Digital / multi-point inspection — complimentary service, not a comeback
  if (c === 'inspection' || /digital.inspect|multi.?point.inspect|vehicle.health|mpi\b|complimentary.*inspect|free.*inspect|inspect.*free|second.opinion/i.test(n)) return true;
  // Free A/C check — promotional complimentary service
  if (/free.*(a\/c|ac|air.?cond)|a\/c.*free|(free|complimentary).*(check|diagnos)/i.test(n)) return true;
  return false;
}

/**
 * Name-based USPS / post office detector. The Return-Customers, churn, and
 * avg-visits-per-year metrics excluded these IDs implicitly when they were
 * captured in EXCLUDED_CUSTOMER_IDS, but USPS holds multiple accounts across
 * shops with different customer IDs that aren't all in the hard-coded list.
 * Applied by name match so any new USPS account is filtered automatically as
 * soon as its name is resolved into the customer-name cache.
 */
export function isPostOfficeName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes('usps') || n.includes('post office') || n.includes('postal service');
}

/**
 * Per-shop labor cost rate (median tech hourly rate, pulled from Tekmetric /employees).
 * Used to compute labor cost = laborHours * rate. Keeps GP$ aligned to what Tekmetric's
 * UI shows by including tech wages. If Mango changes shop labor rates, refresh these.
 */
const LABOR_RATE_BY_SHOP: Record<string, number> = {
  '001': 59,  // Cottonwood
  '002': 54,  // The Heights
  '003': 50,  // Downtown
  '004': 52,  // Pellicano
  '005': 55,  // Las Cruces
  '006': 53,  // Yuma
  '007': 48,  // Montana
  '009': 54,  // The Valley
};

export function shopKpi(shop: Shop, orders: RepairOrder[]): ShopKpi {
  let revenueCents = 0;
  let partsCostCents = 0;
  let laborSalesCents = 0;
  let partsSalesCents = 0;
  let discountCents = 0;
  let roCount = 0; // Tekmetric "Car Count" = count of revenue-realized ROs
  let approvedJobs = 0;
  let totalJobs = 0;
  let laborHours = 0; // sum of hours on authorized jobs (drives labor cost)
  let subletSalesCents = 0; // sublet cost proxy (Tekmetric Total Cost includes sublet cost)
  let presentedDollarsCents = 0; // sum of every job's subtotal — authorized OR declined (drives AWRO)
  let approvedDollarsCents = 0;  // sum of AUTHORIZED job subtotals only (drives "Approved Sales")

  for (const o of orders) {
    if (!isCountedRO(o)) continue;
    roCount++;
    // ex-tax revenue
    revenueCents += (o.laborSales + o.partsSales + o.subletSales + o.feeTotal - o.discountTotal);
    subletSalesCents += o.subletSales;
    laborSalesCents += o.laborSales;
    partsSalesCents += o.partsSales;
    discountCents += o.discountTotal;
    for (const j of o.jobs) {
      totalJobs++;
      // AWRO counts every job presented to the customer, regardless of approval.
      presentedDollarsCents += j.subtotal || 0;
      if (j.authorized) approvedJobs++;
      // Only count parts cost and labor hours on AUTHORIZED jobs. Declined-job parts
      // never get billed to the customer and never get sold, so they don't belong in cost.
      if (!j.authorized) continue;
      approvedDollarsCents += j.subtotal || 0;
      for (const p of j.parts) partsCostCents += p.cost * p.quantity;
      laborHours += j.laborHours || 0;
    }
  }
  const revenue = c2d(revenueCents);
  const partsCost = c2d(partsCostCents);
  const laborSales = c2d(laborSalesCents);
  const partsSales = c2d(partsSalesCents);
  const cars = roCount;
  const laborRate = LABOR_RATE_BY_SHOP[shop.num] ?? 50;
  const laborCost = laborHours * laborRate;
  // Sublet cost proxy: the Tekmetric RO API exposes subletSales but no sublet
  // *cost*, while Tekmetric's Total Cost (and thus GP) includes sublet cost.
  // Sublet is typically near pass-through, so subletSales is a close proxy and
  // closes most of the prior GP% gap. (True sublet cost = follow-up option 2.)
  const subletCost = c2d(subletSalesCents);
  // GP$ = revenue − parts cost − labor cost − sublet cost (matches Tekmetric Custom Financial report)
  const gpDollars = revenue - partsCost - laborCost - subletCost;
  // Parts GP% = (partsSales - partsCost) / partsSales
  const partsGpPct = partsSales > 0 ? (partsSales - partsCost) / partsSales : 0;
  // Labor GP% = (laborSales - laborCost) / laborSales
  const laborGpPct = laborSales > 0 ? (laborSales - laborCost) / laborSales : 0;
  const presentedDollars = c2d(presentedDollarsCents);
  return {
    shopId: shop.tekmetricId,
    shopNum: shop.num,
    shopName: shop.name,
    revenue,
    cars,
    aro: cars ? revenue / cars : 0,
    closeRate: totalJobs ? approvedJobs / totalJobs : 0,
    gpDollars,
    gpPct: revenue ? gpDollars / revenue : 0,
    partsGpPct,
    laborGpPct,
    discounts: c2d(discountCents),
    awro: roCount ? presentedDollars / roCount : 0,
    presentedDollars,
    approvedDollars: c2d(approvedDollarsCents),
  };
}

// --- Daily time series for charts ---

export interface DailyPoint {
  date: string; // YYYY-MM-DD (Mountain)
  revenue: number;
  cars: number;
}

export function dailySeries(orders: RepairOrder[]): DailyPoint[] {
  const m = new Map<string, { revenue: number; vehicles: Set<number> }>();
  for (const o of orders) {
    if (!o.postedDate) continue;
    if (!isCountedRO(o)) continue;
    const day = formatInTimeZone(o.postedDate, CHAIN_TZ, 'yyyy-MM-dd');
    const v = m.get(day) ?? { revenue: 0, vehicles: new Set() };
    v.revenue += c2d(o.laborSales + o.partsSales + o.subletSales + o.feeTotal - o.discountTotal);
    v.vehicles.add(o.vehicleId);
    m.set(day, v);
  }
  return [...m.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, revenue: Math.round(v.revenue), cars: v.vehicles.size }));
}

export function dailyByShop(orders: RepairOrder[]): Record<string, DailyPoint[]> {
  // Group by shop NUMBER (not Tekmetric shopId) so a shop with a secondary
  // instance (e.g. Yuma = 7492 + 18346) combines both into one series.
  // Previously this keyed by shopId and did out[meta.num] = …, which
  // OVERWROTE the primary instance's series with the secondary's — that's
  // why Yuma was missing a chunk of its data.
  const groups = new Map<string, RepairOrder[]>();
  for (const o of orders) {
    const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
    if (!meta) continue;
    const a = groups.get(meta.num) ?? [];
    a.push(o);
    groups.set(meta.num, a);
  }
  const out: Record<string, DailyPoint[]> = {};
  for (const [num, list] of groups) {
    out[num] = dailySeries(list);
  }
  return out;
}

// --- Revenue Projection (Next 14 days) ---
// Based on observed historical day-of-week pattern + tech capacity floor.

export interface ProjectionInputs {
  orders: RepairOrder[];
  asOf: Date;
  techHoursPerDay: number;        // chain-wide
  laborRatePerHour: number;       // dollars/hr -- $89 in the live dashboard
  techCount: number;
  approvedPipelineCents: number;  // sum of authorized but un-posted job subtotals
  openROCount: number;
}

export interface ProjectionResult {
  next14Days: number;
  perDayAvg: number;
  capacityConstrained: boolean;
  dailyTechCapacity: number;
  approvedPipeline: number;
  daysOfApprovedWork: number;
  techCount: number;
  techHoursPerDay: number;
  laborRatePerHour: number;
  runRateMonthly: number;
  runRateAnnualProjected: number;
  runRateAnnualLast12MoActual: number;
  whatsDriving: string[];
}

export function revenueProjection(p: ProjectionInputs): ProjectionResult {
  // Day-of-week historical avg revenue in window
  const daily = dailySeries(p.orders);
  const byDow = new Map<number, number[]>();
  for (const d of daily) {
    const dt = new Date(d.date);
    const dow = dt.getUTCDay();
    const arr = byDow.get(dow) ?? [];
    arr.push(d.revenue);
    byDow.set(dow, arr);
  }
  const dowAvg = new Map<number, number>();
  for (const [dow, arr] of byDow) {
    dowAvg.set(dow, arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  }
  // Project next 14 days using DoW-matched averages
  let total = 0;
  for (let i = 1; i <= 14; i++) {
    const d = addDays(p.asOf, i);
    const dow = d.getUTCDay();
    total += dowAvg.get(dow) ?? 0;
  }
  const perDayAvg = total / 14;
  const dailyTechCapacity = p.techHoursPerDay * p.laborRatePerHour;
  const approvedPipeline = c2d(p.approvedPipelineCents);
  const daysOfApprovedWork = dailyTechCapacity > 0 ? approvedPipeline / dailyTechCapacity : 0;
  const capacityConstrained = daysOfApprovedWork > 5; // brief heuristic

  const overallAvg = daily.length ? daily.reduce((s, d) => s + d.revenue, 0) / daily.length : 0;
  const recentAvg = daily.slice(-7).reduce((s, d) => s + d.revenue, 0) / Math.max(daily.slice(-7).length, 1);
  const aboveAvgPct = overallAvg > 0 ? (recentAvg - overallAvg) / overallAvg : 0;

  const whatsDriving: string[] = [];
  if (aboveAvgPct > 0.05) whatsDriving.push(`Daily revenue is ${Math.round(aboveAvgPct * 100)}% above your historical average`);
  else if (aboveAvgPct < -0.05) whatsDriving.push(`Daily revenue is ${Math.round(-aboveAvgPct * 100)}% below your historical average`);
  if (capacityConstrained) whatsDriving.push(`Techs are at capacity — approved work is waiting, consider adding tech hours`);
  // Close rate driver
  const closeNum = p.orders.reduce((s, o) => s + o.jobs.filter(j => j.authorized).length, 0);
  const closeDen = p.orders.reduce((s, o) => s + o.jobs.length, 0);
  const closeRate = closeDen ? closeNum / closeDen : 0;
  if (closeRate < 0.75) {
    const target = 0.75;
    const additional = Math.round(closeDen * (target - closeRate));
    whatsDriving.push(`Close rate at ${Math.round(closeRate*100)}% vs ${Math.round(target*100)}% target — ${additional} more jobs would be approved at target`);
  }

  return {
    next14Days: Math.round(total),
    perDayAvg: Math.round(perDayAvg),
    capacityConstrained,
    dailyTechCapacity: Math.round(dailyTechCapacity),
    approvedPipeline: Math.round(approvedPipeline),
    daysOfApprovedWork: Math.round(daysOfApprovedWork * 10) / 10,
    techCount: p.techCount,
    techHoursPerDay: p.techHoursPerDay,
    laborRatePerHour: p.laborRatePerHour,
    runRateMonthly: Math.round(perDayAvg * 22),
    runRateAnnualProjected: Math.round(perDayAvg * 264),
    runRateAnnualLast12MoActual: 0, // requires longer history; populate from cache
    whatsDriving,
  };
}

// --- Forecast & Run Rate ---

export interface ForecastResult {
  windowRevenue: number;
  windowDayAvg: number;
  windowDays: number;
  next31DayProjection: number;
  next31ChangePct: number;
  next31WorkingDays: number;
  monthly: number;
  annual: number;
  drivers: string[];
}

export function forecast(
  orders: RepairOrder[],
  windowStart: Date,
  windowEnd: Date,
  excludeWeekends = false
): ForecastResult {
  const daily = dailySeries(orders).filter(d => {
    if (!excludeWeekends) return true;
    const dt = new Date(d.date);
    return !isWeekend(dt);
  });
  const revenue = daily.reduce((s, d) => s + d.revenue, 0);
  const days = daily.length || differenceInCalendarDays(windowEnd, windowStart) + 1;
  const dayAvg = days ? revenue / days : 0;
  // Next 31 days working-day projection
  const workingDays = Array.from({ length: 31 }, (_, i) => addDays(windowEnd, i + 1))
    .filter(d => !excludeWeekends || !isWeekend(d)).length;
  const next31 = dayAvg * workingDays;
  const change = revenue > 0 ? (next31 - revenue) / revenue : 0;
  return {
    windowRevenue: Math.round(revenue),
    windowDayAvg: Math.round(dayAvg),
    windowDays: days,
    next31DayProjection: Math.round(next31),
    next31ChangePct: Math.round(change * 1000) / 10,
    next31WorkingDays: workingDays,
    monthly: Math.round(dayAvg * 22),
    annual: Math.round(dayAvg * 264),
    drivers: [],
  };
}

// --- Revenue Opportunity ---

export interface OpportunityResult {
  closeRate: number;        // 0..1
  targetRate: number;       // 0..1
  jobsApproved: number;
  jobsPresented: number;
  jobsNotApproved: number;
  byShop: Array<{ shopNum: string; shopName: string; closeRate: number; approved: number; presented: number }>;
}

export function opportunity(orders: RepairOrder[], target = 0.75): OpportunityResult {
  const closeNum = orders.reduce((s, o) => s + o.jobs.filter(j => j.authorized).length, 0);
  const closeDen = orders.reduce((s, o) => s + o.jobs.length, 0);
  const closeRate = closeDen ? closeNum / closeDen : 0;
  const groups = new Map<number, { num: number; den: number }>();
  for (const o of orders) {
    const g = groups.get(o.shopId) ?? { num: 0, den: 0 };
    for (const j of o.jobs) { g.den++; if (j.authorized) g.num++; }
    groups.set(o.shopId, g);
  }
  const byShop = [...groups.entries()].map(([shopId, g]) => {
    const meta = SHOP_BY_TEKMETRIC_ID[shopId];
    return {
      shopNum: meta?.num ?? String(shopId),
      shopName: meta?.name ?? `Shop ${shopId}`,
      closeRate: g.den ? g.num / g.den : 0,
      approved: g.num,
      presented: g.den,
    };
  }).sort((a, b) => b.closeRate - a.closeRate);
  return {
    closeRate,
    targetRate: target,
    jobsApproved: closeNum,
    jobsPresented: closeDen,
    jobsNotApproved: closeDen - closeNum,
    byShop,
  };
}

// --- Tech Production ---

export interface TechRow {
  technicianId: number;
  shopNum: string;
  shopName: string;
  billedHours: number;
  jobs: number;
  efficiency: number; // billed / logged (proxy: billed / 8h/day worked)
}

/**
 * Tech production: bill hours + efficiency per technician.
 * `workingHoursInWindow` = (Mon-Fri working days in the window, excluding holidays) × 8.
 * That is the 100%-efficiency denominator. So a tech who billed 40 hrs in a full
 * Mon-Fri week = 100%, billed 20 hrs = 50%, billed 50 hrs = 125%.
 */
export function techProduction(orders: RepairOrder[], workingHoursInWindow: number): TechRow[] {
  const m = new Map<string, { tid: number; shopId: number; hrs: number; jobs: number }>();
  for (const o of orders) {
    if (!isCountedRO(o)) continue;
    for (const j of o.jobs) {
      if (!j.authorized) continue;
      const tid = j.labor?.[0]?.technicianId ?? o.technicianId;
      if (!tid) continue;
      const key = `${tid}@${o.shopId}`;
      const e = m.get(key) ?? { tid, shopId: o.shopId, hrs: 0, jobs: 0 };
      e.hrs += j.laborHours || 0;
      e.jobs += 1;
      m.set(key, e);
    }
  }
  const expected = Math.max(1, workingHoursInWindow);
  const rows: TechRow[] = [];
  for (const e of m.values()) {
    const meta = SHOP_BY_TEKMETRIC_ID[e.shopId];
    rows.push({
      technicianId: e.tid,
      shopNum: meta?.num ?? '',
      shopName: meta?.name ?? `Shop ${e.shopId}`,
      billedHours: Math.round(e.hrs * 10) / 10,
      jobs: e.jobs,
      efficiency: e.hrs / expected,
    });
  }
  return rows.sort((a, b) => b.billedHours - a.billedHours);
}
