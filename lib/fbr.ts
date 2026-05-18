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
import { addMonths, addHours, isAfter, isBefore } from 'date-fns';

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
 * "Re-Book at Checkout": does this customer have ANY future appointment on the calendar
 * (between RO posted date and 14 months out)? Per the new definition: an RO closing
 * today is "rebooked" if the customer has a future appointment scheduled for any time
 * after the RO closed. No tight ±24h-of-checkout window — we only check existence of
 * a future appointment.
 */
export function hasForwardBookedAppt(ro: RepairOrder, apptsByCustomer: Map<number, Appointment[]>): boolean {
  const posted = new Date(ro.postedDate!);
  const list = apptsByCustomer.get(ro.customerId) || [];
  for (const a of list) {
    const ss = new Date(a.startTime);
    if (isAfter(ss, posted) && isBefore(ss, addMonths(posted, 14))) return true;
  }
  return false;
}

export interface ShopFbr {
  shopNum: string;
  shopName: string;
  eligibleROs: number;
  forwardBookedROs: number;
  fbrPct: number; // 0..1
  ramping: boolean;
}

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
  const booked = eligible.filter(r => hasForwardBookedAppt(r, apptsByCustomer));
  return {
    shopNum: meta.num,
    shopName: meta.name,
    eligibleROs: eligible.length,
    forwardBookedROs: booked.length,
    fbrPct: eligible.length ? booked.length / eligible.length : 0,
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
