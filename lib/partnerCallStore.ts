// Partner call outcome log — append-only per RO.
// Keyed by roId so a single write-back covers all declined jobs on that visit.

import { readCache, writeCache } from './cache';

export interface PartnerCallOutcome {
  calledAt: string;      // ISO — when the call actually happened
  calledBy?: string;     // agent name from the calling system
  note?: string;         // free-text call summary
  recordingUrl?: string; // link to recording/transcript in the calling system
  loggedAt: string;      // ISO — when we received this POST
}

const KEY = (roId: number) => `partner_call_${roId}`;

export async function readCallOutcomes(roId: number): Promise<PartnerCallOutcome[]> {
  return (await readCache<PartnerCallOutcome[]>(KEY(roId))) ?? [];
}

export async function appendCallOutcome(roId: number, outcome: PartnerCallOutcome): Promise<PartnerCallOutcome[]> {
  const existing = await readCallOutcomes(roId);
  const updated = [...existing, outcome];
  await writeCache(KEY(roId), updated);
  return updated;
}
