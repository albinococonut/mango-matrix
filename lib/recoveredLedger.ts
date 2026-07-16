// Durable "customers recovered this week" ledger.
//
// WHY THIS EXISTS: the To Do feeds (missed-callbacks / missed-rebooks /
// declined-jobs) are transient rolling-window caches. A row marked "recovered"
// (resolved / won) can leave that feed two ways:
//   1. the 12h auto-reopen sweep resets it back to 'open' (still-missed rows), or
//   2. its source call/RO ages out of the rolling window.
// So counting "recovered" off the live feed under-reports as the week goes on.
//
// This ledger is the source of truth instead: an append-only per-shop set of
// recovered row-ids, keyed by ISO week-start. It survives reopen + window churn.
// Manual "recover" adds; manual "undo"/"not recovered" removes. The background
// auto-reopen does NOT touch it (it writes the resolution store directly, not
// through the action routes), so a manager's explicit recovery still counts for
// the week even after the task resurfaces for re-verification.

import { readCache, writeCache } from './cache';
import { SHOPS } from './shops';
import { TEKMETRIC_REPORT_TZ } from './dates';
import { toZonedTime } from 'date-fns-tz';
import { startOfWeek } from 'date-fns';

// One letter per queue keeps ledger entries unique across the three feeds
// (a callback leadId and a rebook roId could otherwise collide).
export type RecoveryQueue = 'cb' | 'rb' | 'dj';

// Monday-of-current-week (YYYY-MM-DD) in the chain's report timezone, so the
// ledger's week boundary matches every other "this week" on the dashboard.
export function weekStartYmd(now: Date = new Date()): string {
  const local = toZonedTime(now, TEKMETRIC_REPORT_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const KEY = (shopNum: string, weekYmd: string) => `recovered_set_${shopNum}_${weekYmd}`;
// Self-clean old weeks (we only ever read the current one) while keeping a
// few weeks of history around for safety near week boundaries.
const LEDGER_TTL_SECONDS = 60 * 60 * 24 * 45; // ~6 weeks

function entry(queue: RecoveryQueue, id: number): string {
  return `${queue}:${id}`;
}

// Parallel timestamped log so the new To-Do Recoveries trophy can answer
// arbitrary windows (this week vs rolling 7d). The original `recovered_set_*`
// store is a deduped string[] and has no timestamps, so it can only answer
// "this calendar week." This log keeps the same week-keyed sharding (so
// reads stay scoped) but stores entry → ISO timestamp.
const TS_KEY = (shopNum: string, weekYmd: string) => `recovered_ts_${shopNum}_${weekYmd}`;

/** Mark a row recovered for the current week (idempotent — dedupes by id). */
export async function recordRecovery(shopNum: string, queue: RecoveryQueue, id: number): Promise<void> {
  const weekYmd = weekStartYmd();
  const key = KEY(shopNum, weekYmd);
  const set = (await readCache<string[]>(key)) || [];
  const e = entry(queue, id);
  if (!set.includes(e)) {
    set.push(e);
    await writeCache(key, set, { ttlSeconds: LEDGER_TTL_SECONDS });
  }
  // Mirror into the timestamped log. Idempotent: first-write wins so a
  // re-tick after undo+redo doesn't drift the recovery time.
  const tsKey = TS_KEY(shopNum, weekYmd);
  const ts = (await readCache<Record<string, string>>(tsKey)) || {};
  if (!ts[e]) {
    ts[e] = new Date().toISOString();
    await writeCache(tsKey, ts, { ttlSeconds: LEDGER_TTL_SECONDS });
  }
}

/** Un-mark a row (manual undo / "not recovered") for the current week. */
export async function removeRecovery(shopNum: string, queue: RecoveryQueue, id: number): Promise<void> {
  const weekYmd = weekStartYmd();
  const key = KEY(shopNum, weekYmd);
  const set = (await readCache<string[]>(key)) || [];
  const e = entry(queue, id);
  const idx = set.indexOf(e);
  if (idx >= 0) {
    set.splice(idx, 1);
    await writeCache(key, set, { ttlSeconds: LEDGER_TTL_SECONDS });
  }
  // Remove from the timestamped log too — keeps the trophy count and the
  // ledger in sync after a manual undo.
  const tsKey = TS_KEY(shopNum, weekYmd);
  const ts = (await readCache<Record<string, string>>(tsKey)) || {};
  if (ts[e]) {
    delete ts[e];
    await writeCache(tsKey, ts, { ttlSeconds: LEDGER_TTL_SECONDS });
  }
}

/**
 * Per-shop count of items recovered in a window. Uses the canonical
 * `recovered_set_*` data — the deduped string-set per shop/week that the
 * dashboard has been writing for months. The timestamped log added with the
 * trophy is only used for sub-week precision on `rolling_7d`; legacy items
 * (recovered before the log existed) still count toward the weekly tally
 * because the set is the source of truth.
 *
 * Window semantics:
 *   - 'this_week'  → count of items in this Monday-anchored set (chain TZ).
 *                    A shop with 12 recoveries since Monday → count = 12.
 *   - 'rolling_7d' → this week's set + last week's set summed. Without per-
 *                    day timestamps for legacy data, this is the best
 *                    approximation we can give the operator. Early Monday
 *                    morning it reads slightly high (last week's full Mon-
 *                    Sun is included); by Sunday it converges to ~7 days.
 */
export async function recoveredCountsByWindow(
  window: 'this_week' | 'rolling_7d' = 'this_week',
  now: Date = new Date(),
): Promise<{ window: string; windowStartISO: string; windowEndISO: string; byShop: Record<string, number> }> {
  const thisWeekYmd = weekStartYmd(now);
  const prevWeekYmd = weekStartYmd(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));

  const byShop: Record<string, number> = {};
  for (const s of SHOPS) byShop[s.num] = 0;

  await Promise.all(SHOPS.map(async (s) => {
    const setThis = (await readCache<string[]>(KEY(s.num, thisWeekYmd))) || [];
    let count = setThis.length;
    if (window === 'rolling_7d' && prevWeekYmd !== thisWeekYmd) {
      const setPrev = (await readCache<string[]>(KEY(s.num, prevWeekYmd))) || [];
      count += setPrev.length;
    }
    byShop[s.num] = count;
  }));

  const nowMtn = toZonedTime(now, TEKMETRIC_REPORT_TZ);
  const windowStart = window === 'rolling_7d'
    ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    : startOfWeek(nowMtn, { weekStartsOn: 1 });
  return {
    window,
    windowStartISO: windowStart.toISOString(),
    windowEndISO: now.toISOString(),
    byShop,
  };
}

/** Per-shop count of customers recovered in the current week. */
/** Chain-wide totals broken down by queue type for the given window. */
export async function recoveredQueueBreakdown(
  window: 'this_week' | 'rolling_7d' = 'this_week',
  now: Date = new Date(),
): Promise<{ callbacks: number; rebooks: number; declinedJobs: number; total: number }> {
  const thisWeekYmd = weekStartYmd(now);
  const prevWeekYmd = weekStartYmd(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  let cb = 0, rb = 0, dj = 0;
  await Promise.all(SHOPS.map(async (s) => {
    const sets: string[][] = [(await readCache<string[]>(KEY(s.num, thisWeekYmd))) || []];
    if (window === 'rolling_7d' && prevWeekYmd !== thisWeekYmd) {
      sets.push((await readCache<string[]>(KEY(s.num, prevWeekYmd))) || []);
    }
    for (const set of sets) {
      for (const e of set) {
        if (e.startsWith('cb:')) cb++;
        else if (e.startsWith('rb:')) rb++;
        else if (e.startsWith('dj:')) dj++;
      }
    }
  }));
  return { callbacks: cb, rebooks: rb, declinedJobs: dj, total: cb + rb + dj };
}

export async function recoveredCountsThisWeek(): Promise<{ weekStart: string; byShop: Record<string, number> }> {
  const { weekStart, byShop } = await recoveredSetsThisWeek();
  const counts: Record<string, number> = {};
  for (const [num, ids] of Object.entries(byShop)) counts[num] = ids.length;
  return { weekStart, byShop: counts };
}

/**
 * Per-shop SET of recovered entry-ids (`cb:`/`rb:`/`dj:` prefixed) for the
 * current week. The client unions these with the rows it currently shows as
 * recovered so visibly-checkmarked customers always get credit — including
 * recoveries marked before this ledger existed (which aren't recorded here but
 * are still visible in the feed). Returning ids (not just counts) lets the
 * client dedupe the union.
 */
export async function recoveredSetsThisWeek(): Promise<{ weekStart: string; byShop: Record<string, string[]> }> {
  const weekStart = weekStartYmd();
  const byShop: Record<string, string[]> = {};
  await Promise.all(SHOPS.map(async (s) => {
    byShop[s.num] = (await readCache<string[]>(KEY(s.num, weekStart))) || [];
  }));
  return { weekStart, byShop };
}
