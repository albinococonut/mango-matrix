// Self-healing cache warm trigger. When a To Do handler reads its KV
// cache and gets null (the cache was evicted — Upstash free-tier
// eviction, manual purge, etc.), it calls tryWarmInBackground() to fire
// the same warm function the cron uses. The handler returns immediately
// with a "pending" row; the dashboard's 20-second poll picks up the
// rebuilt data on its next tick.
//
// Stampede protection: a KV lock key prevents 5 concurrent users from
// triggering 5 simultaneous warms (which would cost real $ for the
// Anthropic-classified missed-callbacks warm). First caller sets the
// lock; subsequent callers within the lock window see "alreadyWarming"
// and skip.
//
// Vercel caveat: the warm runs as an unawaited IIFE. Vercel's serverless
// runtime gives the function a brief grace window after the response
// ends to flush pending work, but a long warm CAN get killed. If that
// happens, the next page load past the lock TTL re-triggers — recovery
// just takes one extra hop instead of being instantaneous.

import { readCache, writeCache } from './cache';

const LOCK_TTL_SECONDS = 120;   // longer than any warm takes; balance: too long = slow retry after a killed warm

interface WarmLock {
  startedAt: string;
  jobName: string;
  shopNum: string;
}

const LOCK_KEY = (jobName: string, shopNum: string) => `warm_in_progress_${jobName}_${shopNum}`;

/**
 * Kick off `warmFn` in the background if no other warm for the same
 * (jobName, shopNum) pair is already running. Returns immediately —
 * caller MUST NOT await the warm itself.
 *
 * @returns { alreadyWarming: boolean } — true if a warm was already in
 *          progress and we skipped. Caller can use this to decide
 *          whether to surface a "warming…" message in the UI.
 */
export async function tryWarmInBackground(
  jobName: string,
  shopNum: string,
  warmFn: () => Promise<unknown>,
): Promise<{ alreadyWarming: boolean }> {
  const lockKey = LOCK_KEY(jobName, shopNum);

  const existing = await readCache<WarmLock>(lockKey);
  if (existing) return { alreadyWarming: true };

  // Set lock FIRST so concurrent reads observe "already warming." Race
  // window between read + write is ~one Upstash HTTP round-trip; at
  // worst we'd briefly fire two warms which then both write the same
  // result. Not great but not catastrophic — Anthropic costs ~doubled
  // for that one tick, then settled state.
  await writeCache(
    lockKey,
    { startedAt: new Date().toISOString(), jobName, shopNum } satisfies WarmLock,
    { ttlSeconds: LOCK_TTL_SECONDS },
  );

  // Fire-and-forget. The IIFE keeps the warm running independently of
  // the caller's response cycle (to the extent the runtime allows).
  void (async () => {
    try {
      await warmFn();
    } catch (e) {
      // Log but don't surface — the next page load will see no fresh
      // cache and try again past the lock TTL.
      // eslint-disable-next-line no-console
      console.error(`[warm-on-demand] ${jobName} ${shopNum} failed:`, e);
    }
  })();

  return { alreadyWarming: false };
}
