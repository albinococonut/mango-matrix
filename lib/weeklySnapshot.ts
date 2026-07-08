// Friday close snapshot + post-close drift detection.
//
// At Friday 7 PM MT, we take a snapshot of last week's RO revenue totals.
// A daily noon check then re-fetches those same ROs and flags any that changed
// (retroactive edits, status flips, or new ROs posted after close). The result
// surfaces on the Weekly Review page so any post-close ticket change is visible
// the next business day.

import { rosForChain } from './dataAccess';
import { customRange } from './dates';
import { readCache, writeCache } from './cache';
import { SHOP_BY_TEKMETRIC_ID } from './shops';
import { c2d } from './tekmetric';

const SNAPSHOT_KEY = (weekStart: string) => `weekly_snapshot_v2_${weekStart}`;
const DRIFT_KEY    = (weekStart: string) => `weekly_drift_v3_${weekStart}`;
const COUNTED      = new Set(['POSTED', 'ACCRECV']);
const SNAP_TTL_S   = 60 * 24 * 60 * 60;  // 60 days
const DRIFT_TTL_S  = 30 * 24 * 60 * 60;  // 30 days

// ── Types ────────────────────────────────────────────────────────────────────

export interface LineBreakdown {
  labor: number;
  parts: number;
  sublet: number;
  fee: number;
  discount: number;
}

export interface ROSnapshot {
  id: number;
  roNumber: number;
  shopId: number;
  shopNum: string;
  shopName: string;
  revenueCents: number;
  status: string;
  breakdown: LineBreakdown; // cents
}

export interface WeeklySnapshot {
  weekStart: string;
  snappedAt: string;
  chainRevenue: number;   // dollars
  ros: ROSnapshot[];
}

export interface RODiff {
  roId: number;
  roNumber: number;
  shopNum: string;
  shopName: string;
  revenueBefore: number;         // dollars (0 when unknown)
  revenueAfter: number;          // dollars
  delta: number;                 // dollars, negative = revenue removed (0 when unknown)
  statusBefore: string;
  statusAfter: string;
  updatedAt?: string;            // ISO — present when using updatedDate scan
  breakdownBefore?: LineBreakdown; // dollars — present when snapshot had breakdown
  breakdownAfter?: LineBreakdown;  // dollars — present when current RO was fetched
}

export interface DriftReport {
  weekStart: string;
  snappedAt: string;
  checkedAt: string;
  chainRevenueBefore: number;
  chainRevenueAfter: number;
  chainDelta: number;
  diffs: RODiff[];
  // true = compared against Friday-close snapshot; false = updatedDate scan
  snapshotBased: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function roRevCents(o: { laborSales: number; partsSales: number; subletSales: number; feeTotal: number; discountTotal: number }): number {
  return o.laborSales + o.partsSales + o.subletSales + o.feeTotal - o.discountTotal;
}

export function weekStartToEnd(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const e = new Date(y, m - 1, d);
  e.setDate(e.getDate() + 4); // Mon→Fri work week
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
}

// ── Take snapshot ────────────────────────────────────────────────────────────

export async function takeWeeklySnapshot(weekStart: string): Promise<WeeklySnapshot> {
  const weekEnd = weekStartToEnd(weekStart);
  const w = customRange(weekStart, weekEnd);
  const orders = await rosForChain(w);

  const ros: ROSnapshot[] = [];
  let chainCents = 0;
  for (const o of orders) {
    if (!COUNTED.has(o.repairOrderStatus?.code)) continue;
    const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
    if (!meta) continue;
    const rev = roRevCents(o);
    chainCents += rev;
    ros.push({
      id: o.id,
      roNumber: o.repairOrderNumber,
      shopId: o.shopId,
      shopNum: meta.num,
      shopName: meta.name,
      revenueCents: rev,
      status: o.repairOrderStatus.code,
      breakdown: {
        labor: o.laborSales,
        parts: o.partsSales,
        sublet: o.subletSales,
        fee: o.feeTotal,
        discount: o.discountTotal,
      },
    });
  }

  const snap: WeeklySnapshot = {
    weekStart,
    snappedAt: new Date().toISOString(),
    chainRevenue: c2d(chainCents),
    ros,
  };
  await writeCache(SNAPSHOT_KEY(weekStart), snap, { ttlSeconds: SNAP_TTL_S });
  return snap;
}

// ── Check drift ──────────────────────────────────────────────────────────────

export async function checkWeeklyDrift(weekStart: string): Promise<DriftReport | null> {
  const snap = await readCache<WeeklySnapshot>(SNAPSHOT_KEY(weekStart));
  if (!snap) return null;

  const weekEnd = weekStartToEnd(weekStart);
  const w = customRange(weekStart, weekEnd);
  const orders = await rosForChain(w);

  // Build current-state map by RO id
  const current = new Map<number, { revenueCents: number; status: string; breakdown: LineBreakdown }>();
  for (const o of orders) {
    if (!COUNTED.has(o.repairOrderStatus?.code)) continue;
    current.set(o.id, {
      revenueCents: roRevCents(o),
      status: o.repairOrderStatus.code,
      breakdown: {
        labor: o.laborSales,
        parts: o.partsSales,
        sublet: o.subletSales,
        fee: o.feeTotal,
        discount: o.discountTotal,
      },
    });
  }

  const diffs: RODiff[] = [];
  const snappedIds = new Set(snap.ros.map(r => r.id));

  // Changed or status-flipped ROs
  for (const snapped of snap.ros) {
    const curr = current.get(snapped.id);
    const bdBefore: LineBreakdown | undefined = snapped.breakdown
      ? { labor: c2d(snapped.breakdown.labor), parts: c2d(snapped.breakdown.parts), sublet: c2d(snapped.breakdown.sublet), fee: c2d(snapped.breakdown.fee), discount: c2d(snapped.breakdown.discount) }
      : undefined;

    if (!curr) {
      // RO dropped out of COUNTED statuses after close
      diffs.push({
        roId: snapped.id, roNumber: snapped.roNumber,
        shopNum: snapped.shopNum, shopName: snapped.shopName,
        revenueBefore: c2d(snapped.revenueCents), revenueAfter: 0,
        delta: -c2d(snapped.revenueCents),
        statusBefore: snapped.status, statusAfter: '(removed)',
        breakdownBefore: bdBefore,
        breakdownAfter: { labor: 0, parts: 0, sublet: 0, fee: 0, discount: 0 },
      });
      continue;
    }
    if (curr.revenueCents !== snapped.revenueCents || curr.status !== snapped.status) {
      const bdAfter: LineBreakdown = { labor: c2d(curr.breakdown.labor), parts: c2d(curr.breakdown.parts), sublet: c2d(curr.breakdown.sublet), fee: c2d(curr.breakdown.fee), discount: c2d(curr.breakdown.discount) };
      diffs.push({
        roId: snapped.id, roNumber: snapped.roNumber,
        shopNum: snapped.shopNum, shopName: snapped.shopName,
        revenueBefore: c2d(snapped.revenueCents), revenueAfter: c2d(curr.revenueCents),
        delta: c2d(curr.revenueCents - snapped.revenueCents),
        statusBefore: snapped.status, statusAfter: curr.status,
        breakdownBefore: bdBefore,
        breakdownAfter: bdAfter,
      });
    }
  }

  // New ROs posted after the snapshot (added after Friday close)
  for (const o of orders) {
    if (!COUNTED.has(o.repairOrderStatus?.code)) continue;
    if (snappedIds.has(o.id)) continue;
    const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
    if (!meta) continue;
    const rev = roRevCents(o);
    diffs.push({
      roId: o.id, roNumber: o.repairOrderNumber,
      shopNum: meta.num, shopName: meta.name,
      revenueBefore: 0, revenueAfter: c2d(rev),
      delta: c2d(rev),
      statusBefore: '(new)', statusAfter: o.repairOrderStatus.code,
      breakdownAfter: { labor: c2d(o.laborSales), parts: c2d(o.partsSales), sublet: c2d(o.subletSales), fee: c2d(o.feeTotal), discount: c2d(o.discountTotal) },
    });
  }

  const chainAfterCents = Array.from(current.values()).reduce((s, r) => s + r.revenueCents, 0);
  const report: DriftReport = {
    weekStart,
    snappedAt: snap.snappedAt,
    checkedAt: new Date().toISOString(),
    chainRevenueBefore: snap.chainRevenue,
    chainRevenueAfter: c2d(chainAfterCents),
    chainDelta: c2d(chainAfterCents) - snap.chainRevenue,
    diffs,
    snapshotBased: true,
  };

  await writeCache(DRIFT_KEY(weekStart), report, { ttlSeconds: DRIFT_TTL_S });
  return report;
}

// ── Drift scan without snapshot (uses updatedDate) ───────────────────────────
// Fallback when no Friday-close snapshot exists. Fetches all ROs for the week
// and surfaces any whose updatedDate falls after the week ended — meaning
// Tekmetric was edited after the period closed. No before/after delta because
// we never stored the original values, but RO number + current amount + edit
// timestamp is enough for managers to investigate.

export async function checkDriftByUpdatedDate(weekStart: string): Promise<DriftReport> {
  const weekEnd = weekStartToEnd(weekStart);
  const w = customRange(weekStart, weekEnd);
  const orders = await rosForChain(w);

  // Cutoff: Tuesday 07:00 UTC (≈ Monday 11 PM MST / Yuma time).
  // Using an explicit UTC timestamp prevents the server's local timezone from
  // pulling Yuma's normal Sunday-evening close activity into the diff list.
  // weekEnd is always a Sunday; ed+1 = Monday.
  // Originally set to Tuesday (ed+2) to avoid Tekmetric batch updates, but the
  // per-minute frequency filter below already handles those — lowering to Monday
  // so same-day post-close edits (Monday) are caught.
  const [ey, em, ed] = weekEnd.split('-').map(Number);
  const firstDayAfter = new Date(Date.UTC(ey, em - 1, ed + 1, 7)); // Mon 07:00 UTC

  // Count how many ROs share each updatedDate minute — Tekmetric batch-processes
  // tickets and stamps dozens of ROs within the same minute (not necessarily the
  // exact same second). Truncate to the minute so the frequency check catches
  // these batches even when individual seconds differ.
  // Any minute shared by 3+ ROs is a system batch update, not a human edit.
  const updateFreq = new Map<string, number>();
  for (const o of orders) {
    if (!COUNTED.has(o.repairOrderStatus?.code)) continue;
    const minKey = (o.updatedDate ?? '').slice(0, 16); // "2026-06-24T18:34"
    updateFreq.set(minKey, (updateFreq.get(minKey) ?? 0) + 1);
  }

  const diffs: RODiff[] = [];
  let chainCents = 0;

  for (const o of orders) {
    if (!COUNTED.has(o.repairOrderStatus?.code)) continue;
    const rev = roRevCents(o);
    chainCents += rev;

    const updatedAt = new Date(o.updatedDate);
    if (updatedAt < firstDayAfter) continue;

    // Skip batch system updates — 3+ tickets within the same minute is
    // Tekmetric's automated nightly processing, not a manual post-close edit.
    const minKey = (o.updatedDate ?? '').slice(0, 16);
    if ((updateFreq.get(minKey) ?? 0) >= 3) continue;

    const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
    if (!meta) continue;

    diffs.push({
      roId: o.id,
      roNumber: o.repairOrderNumber,
      shopNum: meta.num,
      shopName: meta.name,
      revenueBefore: 0,
      revenueAfter: c2d(rev),
      delta: 0,
      statusBefore: '',
      statusAfter: o.repairOrderStatus.code,
      updatedAt: o.updatedDate,
      breakdownAfter: { labor: c2d(o.laborSales), parts: c2d(o.partsSales), sublet: c2d(o.subletSales), fee: c2d(o.feeTotal), discount: c2d(o.discountTotal) },
    });
  }

  // Sort by most recently updated first
  diffs.sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime());

  const now = new Date().toISOString();
  const report: DriftReport = {
    weekStart,
    snappedAt: now,
    checkedAt: now,
    chainRevenueBefore: 0,
    chainRevenueAfter: c2d(chainCents),
    chainDelta: 0,
    diffs,
    snapshotBased: false,
  };

  await writeCache(DRIFT_KEY(weekStart), report, { ttlSeconds: 30 * 60 }); // 30-min cache (no snapshot baseline)
  return report;
}

// ── Read last drift result (no refetch) ──────────────────────────────────────

export async function getLatestDrift(weekStart: string): Promise<DriftReport | null> {
  return readCache<DriftReport>(DRIFT_KEY(weekStart));
}

// ── Derive this week's snapshot weekStart from a given date ──────────────────
// Mirrors the logic in Concept2Review.lastCompletedMonday().

export function currentSnapshotWeekStart(now: Date = new Date()): string {
  const dow = now.getDay();
  const hr  = now.getHours();
  const workWeekClosed = (dow === 5 && hr >= 20) || dow === 6 || dow === 0;
  // startOfWeek equivalent: go back to most recent Monday
  const thisMon = new Date(now);
  const offset = (dow + 6) % 7; // days since Monday
  thisMon.setDate(now.getDate() - offset);
  thisMon.setHours(0, 0, 0, 0);
  if (!workWeekClosed) thisMon.setDate(thisMon.getDate() - 7);
  return thisMon.toISOString().slice(0, 10);
}
