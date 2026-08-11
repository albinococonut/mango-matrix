// Persistent drift review log — accumulates all post-close ticket edits ever
// detected across ALL weeks into a single durable Redis key. Each entry tracks
// review state (pending / approved / rejected) and manager notes.
//
// The log only GROWS — new items get appended when drift is detected for any
// week. Reviewing an item updates its status/notes in-place. Nothing is ever
// deleted automatically.

import { readCache, writeCache } from './cache';
import { SHOP_BY_NUM } from './shops';
import type { ShopNum } from './shops';
import type { DriftReport } from './weeklySnapshot';

export interface LineBreakdown {
  labor: number;
  parts: number;
  sublet: number;
  fee: number;
  discount: number;
}

export interface DriftLogEntry {
  id: string;             // `${roId}_${weekStart}` — stable per RO per week
  roId: number;
  roNumber: number;
  shopNum: string;
  shopName: string;
  shopTekmetricId: number;
  weekStart: string;      // Monday of the week this edit was detected in
  detectedAt: string;     // ISO — when our system first caught the change
  revenueBefore: number;  // dollars (0 when no snapshot baseline)
  revenueAfter: number;   // dollars
  delta: number;          // dollars (0 when no snapshot baseline)
  statusBefore: string;
  statusAfter: string;
  updatedAt?: string;     // Tekmetric updatedDate (non-snapshot path only)
  snapshotBased: boolean;
  // Line-item breakdown — only present for snapshot-based entries
  breakdownBefore?: LineBreakdown; // dollars at Friday close
  breakdownAfter?: LineBreakdown;  // dollars at detection time
  // Review
  status: 'pending' | 'approved' | 'rejected';
  notes: string;
  reviewedAt?: string;    // ISO — when status was last changed
  reviewedBy?: string;    // email of the person who last changed the status
}

const LOG_KEY = 'drift_review_log_v1';

const BILLING_STATUSES = new Set(['POSTED', 'ACCRECV']);

export async function getDriftLog(): Promise<DriftLogEntry[]> {
  const all = (await readCache<DriftLogEntry[]>(LOG_KEY)) ?? [];
  // Exclude POSTED↔ACCRECV status-only entries written before the detector
  // was fixed — billing workflow transitions, not actual post-close edits.
  return all.filter(e => !(
    e.snapshotBased &&
    e.delta === 0 &&
    BILLING_STATUSES.has(e.statusBefore) &&
    BILLING_STATUSES.has(e.statusAfter) &&
    e.statusBefore !== e.statusAfter
  ));
}

async function saveDriftLog(entries: DriftLogEntry[]): Promise<void> {
  await writeCache(LOG_KEY, entries);
}

// Remove pending (un-reviewed) entries for the given week starts so they can
// be re-seeded fresh. Reviewed (approved/rejected) entries are preserved.
export async function clearPendingEntriesForWeeks(weekStarts: string[]): Promise<void> {
  const entries = await getDriftLog();
  const weekSet = new Set(weekStarts);
  const kept = entries.filter(e => !(weekSet.has(e.weekStart) && e.status === 'pending'));
  await saveDriftLog(kept);
}

/**
 * Merge new diffs from a DriftReport into the log without overwriting
 * existing reviewed entries. Returns the count of newly added entries.
 *
 * If snapshotBased=true and an entry already exists as snapshotBased=false
 * (seeded earlier by the updatedDate fallback), upgrade it in place so the
 * before/after delta becomes visible. Review status and notes are preserved.
 */
export async function seedDriftFromReport(
  weekStart: string,
  report: DriftReport,
  snapshotBased: boolean,
): Promise<number> {
  if (!report.diffs?.length) return 0;

  const existing = await getDriftLog();
  const idMap = new Map(existing.map((e, i) => [e.id, i]));
  const now = new Date().toISOString();
  let added = 0;
  let upgraded = 0;

  for (const diff of report.diffs) {
    const id = `${diff.roId}_${weekStart}`;
    const shop = SHOP_BY_NUM[diff.shopNum as ShopNum];
    if (!shop) continue;

    const existingIdx = idMap.get(id);
    if (existingIdx !== undefined) {
      // Upgrade a non-snapshot entry when real snapshot data arrives
      if (snapshotBased && !existing[existingIdx].snapshotBased) {
        existing[existingIdx] = {
          ...existing[existingIdx],
          revenueBefore: diff.revenueBefore,
          revenueAfter: diff.revenueAfter,
          delta: diff.delta,
          statusBefore: diff.statusBefore,
          statusAfter: diff.statusAfter,
          snapshotBased: true,
          breakdownBefore: diff.breakdownBefore,
          breakdownAfter: diff.breakdownAfter,
        };
        upgraded++;
      }
      continue;
    }

    existing.push({
      id,
      roId: diff.roId,
      roNumber: diff.roNumber,
      shopNum: diff.shopNum,
      shopName: diff.shopName,
      shopTekmetricId: shop.tekmetricId,
      weekStart,
      detectedAt: now,
      revenueBefore: diff.revenueBefore,
      revenueAfter: diff.revenueAfter,
      delta: diff.delta,
      statusBefore: diff.statusBefore,
      statusAfter: diff.statusAfter,
      updatedAt: diff.updatedAt,
      snapshotBased,
      breakdownBefore: diff.breakdownBefore,
      breakdownAfter: diff.breakdownAfter,
      status: 'pending',
      notes: '',
    });
    idMap.set(id, existing.length - 1);
    added++;
  }

  if (added > 0 || upgraded > 0) await saveDriftLog(existing);
  return added;
}

/**
 * Update the review status and/or notes for a single log entry.
 * Returns the updated entry, or null if the id was not found.
 */
export async function updateDriftEntry(
  id: string,
  update: { status?: DriftLogEntry['status']; notes?: string; reviewedBy?: string },
): Promise<DriftLogEntry | null> {
  const entries = await getDriftLog();
  const idx = entries.findIndex(e => e.id === id);
  if (idx < 0) return null;

  const entry = { ...entries[idx] };
  if (update.status !== undefined) {
    entry.status = update.status;
    entry.reviewedAt = new Date().toISOString();
    if (update.reviewedBy !== undefined) entry.reviewedBy = update.reviewedBy;
  }
  if (update.notes !== undefined) {
    entry.notes = update.notes;
  }
  entries[idx] = entry;
  await saveDriftLog(entries);
  return entry;
}
