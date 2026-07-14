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

export interface DriftLogEntry {
  id: string;             // `${roId}_${weekStart}` — stable per RO per week
  roId: number;
  roNumber: number;
  shopNum: string;
  shopName: string;
  shopTekmetricId: number;
  weekStart: string;      // Monday of the week this edit was detected in
  detectedAt: string;     // ISO — when first logged
  revenueBefore: number;  // dollars
  revenueAfter: number;   // dollars
  delta: number;          // dollars (0 when no snapshot baseline)
  statusBefore: string;
  statusAfter: string;
  updatedAt?: string;     // Tekmetric updatedDate (non-snapshot path)
  snapshotBased: boolean;
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

/**
 * Merge new diffs from a DriftReport into the log without overwriting
 * existing reviewed entries. Returns the count of newly added entries.
 */
export async function seedDriftFromReport(
  weekStart: string,
  report: DriftReport,
  snapshotBased: boolean,
): Promise<number> {
  if (!report.diffs?.length) return 0;

  const existing = await getDriftLog();
  const idSet = new Set(existing.map(e => e.id));
  const now = new Date().toISOString();
  let added = 0;

  for (const diff of report.diffs) {
    const id = `${diff.roId}_${weekStart}`;
    if (idSet.has(id)) continue;
    const shop = SHOP_BY_NUM[diff.shopNum as ShopNum];
    if (!shop) continue;

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
      status: 'pending',
      notes: '',
    });
    idSet.add(id);
    added++;
  }

  if (added > 0) await saveDriftLog(existing);
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
