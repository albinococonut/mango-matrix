// Per-RO rebook resolution state. Mirror of callbackStore.ts but keyed by
// roId since each missed-rebook row is a specific repair order. Same
// "events only — never re-derive state from sources" rule: a manager's
// "won" stamp survives cache rebuilds + new warms.

import { readCache, writeCache } from './cache';

export type RebookStatus = 'open' | 'won' | 'not_salvageable';

export interface RebookResolution {
  roId: number;
  status: RebookStatus;
  note?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  attemptCount?: number;
  lastAttemptAt?: string;
  updatedAt: string;
}

const KEY = (roId: number) => `rebook_resolution_${roId}`;

export async function readRebookResolution(roId: number): Promise<RebookResolution | null> {
  return await readCache<RebookResolution>(KEY(roId));
}

export async function readRebookResolutions(roIds: number[]): Promise<Map<number, RebookResolution>> {
  // Parallel KV reads — same shape as readDeclinedJobResolutions. Sequential
  // was fine at current volume but trips the function timeout once the queue
  // grows; cheaper to batch via Promise.all up front.
  const out = new Map<number, RebookResolution>();
  const settled = await Promise.all(roIds.map(id => readCache<RebookResolution>(KEY(id))));
  roIds.forEach((id, i) => {
    const v = settled[i];
    if (v) out.set(id, v);
  });
  return out;
}

export async function writeRebookResolution(r: RebookResolution): Promise<void> {
  await writeCache(KEY(r.roId), { ...r, updatedAt: new Date().toISOString() });
}

/**
 * Auto-reopen sweep — now a NO-OP for 'won' rebook resolutions.
 *
 * History: this used to reopen 'won' rows whose resolvedAt was > 12 h old
 * IF the RO was still in the missed-rebook list. Intent: "if the customer
 * didn't actually book, bring the row back tomorrow." Reality: this fired
 * false reopens whenever the new appointment wasn't reflected in
 * Tekmetric within 12 h (sync lag, different-shop booking, manual entry,
 * customer rebooked verbally), making the green checkmark feel like it
 * "doesn't stick."
 *
 * 'not_salvageable' ("Not Recovered") is already terminal — the manager's
 * verdict is the source of truth. 'won' ("Recovered") now gets the same
 * trust: once you click it, it stays clicked. If clicked by mistake, the
 * manager can manually un-check the row. Function signature preserved so
 * existing callers in syncJobs don't need to change.
 */
export async function reopenStaleRebookResolutions(_roIds: number[], _maxAgeHours = 12): Promise<number[]> {
  return [];
}

export async function logRebookAttempt(roId: number, actor?: string): Promise<RebookResolution> {
  const existing = await readRebookResolution(roId);
  const next: RebookResolution = {
    roId,
    status: existing?.status ?? 'open',
    note: existing?.note,
    resolvedBy: existing?.resolvedBy,
    resolvedAt: existing?.resolvedAt,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    lastAttemptAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (actor && !next.resolvedBy) next.resolvedBy = actor;
  await writeCache(KEY(roId), next);
  return next;
}
