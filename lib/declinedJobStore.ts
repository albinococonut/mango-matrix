// Per-declined-job resolution state. Mirror of rebookStore.ts but keyed by
// jobId (since a single RO can have multiple declined jobs and a manager
// may resolve them independently — e.g. customer agrees to the brake job
// but not the trans flush). Events only — never re-derive state from the
// source Tekmetric data — so "won" stamps survive cache rebuilds.

import { readCache, writeCache } from './cache';

export type DeclinedJobStatus = 'open' | 'won' | 'not_salvageable';

export interface DeclinedJobResolution {
  jobId: number;
  status: DeclinedJobStatus;
  note?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  attemptCount?: number;
  lastAttemptAt?: string;
  updatedAt: string;
}

const KEY = (jobId: number) => `declined_job_resolution_${jobId}`;

export async function readDeclinedJobResolution(jobId: number): Promise<DeclinedJobResolution | null> {
  return await readCache<DeclinedJobResolution>(KEY(jobId));
}

export async function readDeclinedJobResolutions(jobIds: number[]): Promise<Map<number, DeclinedJobResolution>> {
  // Parallel KV reads. Sequential read of ~1600 entries (200 per shop ×
  // 8 shops) took ~128 s and tripped the Vercel function timeout (HTTP 504).
  // Promise.all over Upstash's HTTP client lands in ~1–2 s for the same set.
  const out = new Map<number, DeclinedJobResolution>();
  const settled = await Promise.all(jobIds.map(id => readCache<DeclinedJobResolution>(KEY(id))));
  jobIds.forEach((id, i) => {
    const v = settled[i];
    if (v) out.set(id, v);
  });
  return out;
}

export async function writeDeclinedJobResolution(r: DeclinedJobResolution): Promise<void> {
  await writeCache(KEY(r.jobId), { ...r, updatedAt: new Date().toISOString() });
}

/**
 * Auto-reopen sweep — now a NO-OP for 'won' declined-job resolutions.
 *
 * History: this used to reopen 'won' rows whose resolvedAt was > 12 h old
 * IF the job was still un-authorized in Tekmetric. Intent: "if the customer
 * didn't actually authorize, bring the row back tomorrow." Reality: this
 * fired false reopens because authorizing a previously-declined job often
 * happens on a NEW RO (not the original one this row points to), or the
 * Tekmetric job-status change lags > 12 h. Managers reported the green
 * checkmark "not sticking" — a recovery they actually made resurfaced
 * the next morning.
 *
 * 'not_salvageable' ("Not Recovered") is already terminal — the manager's
 * verdict is final. 'won' ("Recovered") now gets the same trust. If a
 * checkmark was a mistake, the manager can manually un-check it. Function
 * signature preserved so existing callers in syncJobs keep working.
 */
export async function reopenStaleDeclinedJobResolutions(_jobIds: number[], _maxAgeHours = 12): Promise<number[]> {
  return [];
}

export async function logDeclinedJobAttempt(jobId: number, actor?: string): Promise<DeclinedJobResolution> {
  const existing = await readDeclinedJobResolution(jobId);
  const next: DeclinedJobResolution = {
    jobId,
    status: existing?.status ?? 'open',
    note: existing?.note,
    resolvedBy: existing?.resolvedBy,
    resolvedAt: existing?.resolvedAt,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    lastAttemptAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (actor && !next.resolvedBy) next.resolvedBy = actor;
  await writeCache(KEY(jobId), next);
  return next;
}
