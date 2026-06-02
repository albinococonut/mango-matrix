// Shared discovery — list every Google account + every location it manages,
// then write the snapshot to KV under DISCOVERED_KEY for /admin/gbp to read.
//
// Factored out of /api/gbp/oauth/callback so the same code path can be
// invoked manually via /api/gbp/discover without forcing a re-OAuth. Helps
// when the first discovery is throttled by per-minute quota (very common on
// freshly approved My Business API projects with default quota = 1/min).

import { writeCache } from './cache';
import { listAccounts, listLocations, type GbpAccount, type GbpLocation } from './gbp';
import { DISCOVERED_KEY } from './gbpAuth';

export interface DiscoveredSnapshot {
  fetched_at: string;
  accounts: Array<GbpAccount & { locations: GbpLocation[] }>;
}

/** Sleep `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

/**
 * Walk every account → every location, with explicit spacing between calls
 * so we don't burn through the per-minute quota in a burst. Each listLocations
 * call is preceded by 1.5s wait. lib/gbp.ts handles 429 retries internally,
 * so this is the second line of defense against quota throttling.
 */
export async function runDiscovery(): Promise<DiscoveredSnapshot> {
  const accounts = await listAccounts();
  const enriched: DiscoveredSnapshot['accounts'] = [];
  for (let i = 0; i < accounts.length; i++) {
    if (i > 0) await delay(1500);
    const acct = accounts[i];
    const locations = await listLocations(acct.name).catch(() => [] as GbpLocation[]);
    enriched.push({ ...acct, locations });
  }
  const snapshot: DiscoveredSnapshot = {
    fetched_at: new Date().toISOString(),
    accounts: enriched,
  };
  await writeCache(DISCOVERED_KEY, snapshot);
  return snapshot;
}
