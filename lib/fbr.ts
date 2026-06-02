// Forward-Booking Rate per dev brief sections 3 and 6.
//
// FBR = COUNT(eligible_closed_ROs WHERE follow_up_appt_exists) / COUNT(eligible_closed_ROs)
//
// Eligible: posted/closed status, customer is RETAIL (not fleet), labor_total > 0, not a comeback.
// follow_up_appt_exists: appointment for same customer_id with
//   scheduled_start > RO.postedDate AND < postedDate + 14 months
//   AND appointment.createdAt within +/-1h to +24h of RO.postedDate.

import type { RepairOrder, Appointment } from './tekmetric';
import { SHOP_BY_TEKMETRIC_ID, isRampingShop } from './shops';
import { isAfter } from 'date-fns';
// addDays + REBOOK_CALLBACK_DAYS are intentionally left removed; the FBR
// matcher no longer constrains on appointment createdDate (see
// findForwardBookedAppt below for rationale).

// Heuristic fleet classifier per brief section 6.
// Caller passes a customer record (we keep this lib pure so the caller threads it through).
export interface CustomerLite {
  id: number;
  fullName: string;
  vehicleCount?: number;
}

const FLEET_KEYWORDS = [
  'LLC', 'INC', 'CORP', 'CO.', 'COMPANY', 'LTD', 'CITY OF', 'COUNTY',
  'USPS', 'FLEET', 'CONTRACT', 'ENTERPRISE', 'U-HAUL', 'AT&T',
  'BORDER PATROL', 'BNSF', 'SPECTRUM', 'BROS',
];

export function classifyFleet(c: CustomerLite, manualOverrides: Map<number, 'RETAIL' | 'FLEET'> = new Map()): 'RETAIL' | 'FLEET' {
  const override = manualOverrides.get(c.id);
  if (override) return override;
  const upper = (c.fullName || '').toUpperCase();
  // Rule 1: keyword match
  for (const kw of FLEET_KEYWORDS) {
    if (upper.includes(kw)) return 'FLEET';
  }
  // Rule 2: vehicle count >= 4
  if ((c.vehicleCount ?? 0) >= 4) return 'FLEET';
  // Rule 3: >= 60% all-caps words (2+ words)
  const words = (c.fullName || '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const upperWords = words.filter(w => w.length >= 2 && w === w.toUpperCase() && /[A-Z]/.test(w));
    if (upperWords.length / words.length >= 0.6) return 'FLEET';
  }
  return 'RETAIL';
}

export function isComeback(ro: RepairOrder): boolean {
  // Tekmetric exposes "comeback" via labels in some accounts; absent that, no marking.
  // Conservative default: not a comeback unless labeled.
  // (The brief's fallback heuristic - linked to prior RO within 30 days - requires a
  // multi-RO lookback we'd add once we backfill customer histories.)
  return false;
}

export function isEligibleRO(
  ro: RepairOrder,
  fleetByCustomer: Map<number, 'RETAIL' | 'FLEET'>,
): boolean {
  if (!ro.postedDate) return false;
  if (!['POSTED', 'CLOSED', 'INVOICED'].includes(ro.repairOrderStatus.code)) return false;
  if (ro.laborSales <= 0) return false;
  if (isComeback(ro)) return false;
  const klass = fleetByCustomer.get(ro.customerId);
  if (klass === 'FLEET') return false;
  return true;
}

/**
 * "Re-Booked": did the customer BOOK a future appointment either at checkout
 * or within the post-checkout callback window? Match an appointment when:
 *   - `createdDate` is AFTER the RO posted (not before — pre-existing
 *     appointments don't count as "rebooks earned on this visit")
 *   - `createdDate` is WITHIN 14 DAYS of the RO posting (real callback
 *     window — customer left Tuesday, called Friday to schedule = counts;
 *     called 3 weeks later = that's a fresh schedule, not a rebook)
 *   - `startTime` is AFTER the RO closed (future visit, not historical)
 *
 * The previous ±1-day-of-RO rule was too strict — Montana and other shops
 * legitimately rebook customers via phone callback 2-7 days after checkout
 * and were getting 0%. The previous "any appointment within 14 months" rule
 * was too loose: historical weeks accumulated months of future appts (→ ~28%)
 * while the current week saw none (~10%), producing incomparable numbers.
 *
 * The 14-day callback cap preserves comparability: every RO sees at most a
 * 14-day window for "earning" a rebook, regardless of when the week is
 * viewed. Past weeks see their full 14-day window. The current week sees a
 * partial window (0-7 days elapsed for each RO depending on day-of-week) —
 * which is the same asymmetry that always exists between past and current
 * weeks, much smaller than the months-of-accumulation problem the prior
 * loose rule had.
 */
// Previously: const REBOOK_CALLBACK_DAYS = 14;
// Removed when the rule was loosened to "any future appointment counts."

/**
 * Return the matched forward-booked appointment for this RO (or null). If
 * multiple appointments qualify, the SOONEST start time wins — that's the
 * one the customer will actually show up for and the most representative of
 * "when did they rebook for".
 *
 * RULE: any appointment whose `startTime` is AFTER the RO's `postedDate`
 * counts. We do NOT constrain on `createdDate` — managers told us
 * appointments booked at checkout commonly have `createdDate` slightly
 * BEFORE the RO is posted (RO finalization is the last step), and those
 * legitimate rebooks were being silently dropped. So as long as the
 * customer has a future visit on the books, this RO is credited as
 * forward-booked, regardless of WHEN the appointment was created.
 *
 * Side-effect of loosening this: a customer's pre-existing annual-
 * maintenance appointment will credit every RO they have until that
 * appointment's startTime. We accept this — it's better to over-credit
 * than to silently zero-out shops that are actively rebooking.
 *
 * The previous rule (createdDate AFTER postedDate, within 14d) is kept
 * in git history; the constant `REBOOK_CALLBACK_DAYS` is no longer used
 * here but retained in case we want to add a soft-cap on appointment
 * horizon later.
 */
export function findForwardBookedAppt(ro: RepairOrder, apptsByCustomer: Map<number, Appointment[]>): Appointment | null {
  const posted = new Date(ro.postedDate!);
  const list = apptsByCustomer.get(ro.customerId) || [];
  let best: Appointment | null = null;
  let bestStart = Infinity;
  for (const a of list) {
    if (!a.startTime) continue;
    const start = new Date(a.startTime);
    if (isAfter(start, posted)) {
      const t = start.getTime();
      if (t < bestStart) { best = a; bestStart = t; }
    }
  }
  return best;
}

/** Back-compat wrapper for callers that only need the boolean. */
export function hasForwardBookedAppt(ro: RepairOrder, apptsByCustomer: Map<number, Appointment[]>): boolean {
  return findForwardBookedAppt(ro, apptsByCustomer) !== null;
}

export interface ShopFbr {
  shopNum: string;
  shopName: string;
  eligibleROs: number;
  forwardBookedROs: number;
  fbrPct: number; // 0..1
  // Mean months from RO close to the booked appointment's scheduled start,
  // across all forward-booked ROs this window. Null when no rebooks.
  avgMonthsToRebook: number | null;
  ramping: boolean;
}

const MS_PER_MONTH = 30.4375 * 24 * 60 * 60 * 1000;

export function shopFbr(
  ros: RepairOrder[],
  fleetByCustomer: Map<number, 'RETAIL' | 'FLEET'>,
  apptsByCustomer: Map<number, Appointment[]>,
  asOf: Date = new Date(),
): ShopFbr | null {
  const first = ros[0];
  if (!first) return null;
  const meta = SHOP_BY_TEKMETRIC_ID[first.shopId];
  if (!meta) return null;
  const eligible = ros.filter(r => isEligibleRO(r, fleetByCustomer));
  // Collect the matched appointment per booked RO so we can both count it
  // and measure how far in the future it was scheduled.
  const matched: Array<{ ro: RepairOrder; appt: Appointment }> = [];
  for (const ro of eligible) {
    const a = findForwardBookedAppt(ro, apptsByCustomer);
    if (a) matched.push({ ro, appt: a });
  }
  let avgMonthsToRebook: number | null = null;
  if (matched.length > 0) {
    let sum = 0;
    for (const { ro, appt } of matched) {
      const posted = new Date(ro.postedDate!).getTime();
      const start = new Date(appt.startTime).getTime();
      sum += Math.max(0, (start - posted) / MS_PER_MONTH);
    }
    avgMonthsToRebook = sum / matched.length;
  }
  return {
    shopNum: meta.num,
    shopName: meta.name,
    eligibleROs: eligible.length,
    forwardBookedROs: matched.length,
    fbrPct: eligible.length ? matched.length / eligible.length : 0,
    avgMonthsToRebook,
    ramping: isRampingShop(meta, asOf),
  };
}

/** Kept-appointment rate per brief section 3.2. */
export interface ShopKar {
  shopNum: string;
  shopName: string;
  expectedAppts: number;
  keptAppts: number;
  karPct: number;
}

export function shopKar(
  appts: Appointment[],
  ros: RepairOrder[],
  asOf: Date = new Date(),
): ShopKar | null {
  const first = appts[0] ?? ros[0];
  if (!first) return null;
  const meta = SHOP_BY_TEKMETRIC_ID[first.shopId];
  if (!meta) return null;
  // expected: forward-booked appts whose scheduled_start <= today
  const expected = appts.filter(a => new Date(a.startTime) <= asOf);
  // kept: any RO within +/- 7 days of the appt's startTime
  const roByCust = new Map<number, RepairOrder[]>();
  for (const r of ros) {
    if (!r.customerId) continue;
    const arr = roByCust.get(r.customerId) ?? [];
    arr.push(r);
    roByCust.set(r.customerId, arr);
  }
  let kept = 0;
  for (const a of expected) {
    if (!a.customerId) continue;
    const cands = roByCust.get(a.customerId) || [];
    const ss = new Date(a.startTime);
    const matched = cands.some(r => {
      if (!r.postedDate) return false;
      const diff = Math.abs(new Date(r.postedDate).getTime() - ss.getTime());
      return diff <= 7 * 86_400_000;
    });
    if (matched) kept++;
  }
  return {
    shopNum: meta.num,
    shopName: meta.name,
    expectedAppts: expected.length,
    keptAppts: kept,
    karPct: expected.length ? kept / expected.length : 0,
  };
}
