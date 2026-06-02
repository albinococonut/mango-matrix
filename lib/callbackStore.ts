// Per-lead callback resolution state.
//
// One KV entry per lead_id that an advisor / manager has acted on. Calls
// without an entry are implicitly "open". We only persist EVENTS — never
// re-derive state from scores — so a manager's "resolved" stamp survives
// rescoring and cache rebuilds.
//
// Stored shape is intentionally small: status + optional note + timestamps
// + actor (best-effort; we don't have a real user identity yet so we
// accept whatever the client sends).

import { readCache, writeCache } from './cache';

export type CallbackStatus = 'open' | 'resolved' | 'not_salvageable';

export interface CallbackResolution {
  leadId: number;
  status: CallbackStatus;
  note?: string;
  resolvedBy?: string;        // advisor / manager identifier
  resolvedAt?: string;        // ISO
  attemptCount?: number;      // how many callback attempts logged
  lastAttemptAt?: string;     // ISO of most recent attempt
  updatedAt: string;          // ISO
}

const KEY = (leadId: number) => `callback_resolution_${leadId}`;

export async function readResolution(leadId: number): Promise<CallbackResolution | null> {
  return await readCache<CallbackResolution>(KEY(leadId));
}

export async function readResolutions(leadIds: number[]): Promise<Map<number, CallbackResolution>> {
  // Parallel KV reads — see readDeclinedJobResolutions for the
  // why-not-sequential note. Cheap insurance against future queue growth.
  const out = new Map<number, CallbackResolution>();
  const settled = await Promise.all(leadIds.map(id => readCache<CallbackResolution>(KEY(id))));
  leadIds.forEach((id, i) => {
    const v = settled[i];
    if (v) out.set(id, v);
  });
  return out;
}

export async function writeResolution(r: CallbackResolution): Promise<void> {
  await writeCache(KEY(r.leadId), { ...r, updatedAt: new Date().toISOString() });
}

/**
 * Auto-reopen sweep — now a NO-OP for resolved callbacks.
 *
 * History: this used to reopen 'resolved' rows whose resolvedAt was > 12 h
 * old IF the lead was still surfaced as missed. The intent was "catch a
 * stray 'done' click — bring it back tomorrow if Tekmetric still doesn't
 * show the customer booked." In practice that produced false reopens: a
 * legitimate recovery (manager called, customer booked) gets re-listed
 * the next morning because the appointment hasn't synced to Tekmetric
 * yet, was booked at a different shop, or was entered manually outside
 * the system the missed-callback list reads from. Managers reported this
 * as "the green checkmark doesn't stick."
 *
 * 'not_salvageable' ("Not Recovered") is already terminal here — the
 * manager's verdict is the source of truth. We extend that same trust to
 * 'resolved' ("Recovered"). If a manager clicked done by mistake they can
 * still manually un-check the row; we no longer second-guess them via a
 * background sweep. The function signature is preserved so existing
 * callers in syncJobs don't need to change.
 */
export async function reopenStaleResolutions(_leadIds: number[], _maxAgeHours = 12): Promise<number[]> {
  return [];
}

/**
 * Increment the attempt counter without changing status. Used when an
 * advisor clicks "Call Back Now" — we record the attempt so we can later
 * surface "X attempts, no resolution" patterns.
 */
export async function logAttempt(leadId: number, actor?: string): Promise<CallbackResolution> {
  const existing = await readResolution(leadId);
  const next: CallbackResolution = {
    leadId,
    status: existing?.status ?? 'open',
    note: existing?.note,
    resolvedBy: existing?.resolvedBy,
    resolvedAt: existing?.resolvedAt,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    lastAttemptAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (actor && !next.resolvedBy) next.resolvedBy = actor;
  await writeCache(KEY(leadId), next);
  return next;
}
