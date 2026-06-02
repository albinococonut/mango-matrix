// Live presence for the To Do page. One Upstash KV key holds a map of
// { email -> { shopNum, lastSeenAt } }. Each open /todo tab pings every
// 15 s; entries older than PRESENCE_TTL_MS are pruned on every read or
// write so the map can't grow unbounded.
//
// Race tolerance: two simultaneous heartbeats can race on the read →
// modify → write cycle. The worst case is that one user's entry is
// briefly missing from the map until their next heartbeat 15 s later —
// acceptable for an internal coordination tool.

import { readCache, writeCache } from './cache';

const KEY = 'todo_presence_v1';
const PRESENCE_TTL_MS = 45_000;   // ~3 missed heartbeats

export interface PresenceEntry {
  shopNum: string;        // shop they're currently viewing
  lastSeenAt: string;     // ISO
}
export type PresenceMap = Record<string, PresenceEntry>;

export interface ActiveUser {
  email: string;
  shopNum: string;
  lastSeenAt: string;
}

function prune(map: PresenceMap): PresenceMap {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  const out: PresenceMap = {};
  for (const [email, entry] of Object.entries(map)) {
    const t = entry?.lastSeenAt ? new Date(entry.lastSeenAt).getTime() : 0;
    if (Number.isFinite(t) && t >= cutoff) out[email] = entry;
  }
  return out;
}

function toList(map: PresenceMap): ActiveUser[] {
  return Object.entries(map)
    .map(([email, e]) => ({ email, shopNum: e.shopNum, lastSeenAt: e.lastSeenAt }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** Read the active-user list, pruning stale entries. Does not write back. */
export async function readPresence(): Promise<ActiveUser[]> {
  const map = (await readCache<PresenceMap>(KEY)) || {};
  return toList(prune(map));
}

/**
 * Update this user's presence + return the current active-user list.
 * Read-prune-update-write in one shot so the key both stays fresh and
 * always reflects the calling user's most recent ping.
 */
export async function heartbeat(email: string, shopNum: string): Promise<ActiveUser[]> {
  const existing = (await readCache<PresenceMap>(KEY)) || {};
  const pruned = prune(existing);
  pruned[email] = { shopNum, lastSeenAt: new Date().toISOString() };
  await writeCache(KEY, pruned);
  return toList(pruned);
}

/** Remove this user's entry — used when their tab is hidden or closed. */
export async function leave(email: string): Promise<void> {
  const existing = (await readCache<PresenceMap>(KEY)) || {};
  if (!existing[email]) return;
  const pruned = prune(existing);
  delete pruned[email];
  await writeCache(KEY, pruned);
}
