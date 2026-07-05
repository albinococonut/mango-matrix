// Single funnel for "give me all RO data for window across (one|all) shops".
// Caches per shop+window so multiple API routes in the same request share work.

import { fetchAllRepairOrders, RepairOrder } from './tekmetric';
import { SHOPS, SHOP_BY_NUM, ShopNum } from './shops';
import { readCache, writeCache, isFresh } from './cache';

const SHORT_CACHE_MS = 30 * 60 * 1000; // 30 min
const LONG_CACHE_MS = 24 * 60 * 60 * 1000;

interface WindowKey {
  startISO: string;
  endISO: string;
}

function cacheKey(shopId: number, w: WindowKey) {
  return `ros_${shopId}_${w.startISO.slice(0, 10)}_${w.endISO.slice(0, 10)}`;
}

export async function rosForShop(shopId: number, w: WindowKey, maxAgeMs = SHORT_CACHE_MS): Promise<RepairOrder[]> {
  const key = cacheKey(shopId, w);
  if (await isFresh(key, maxAgeMs)) {
    const v = await readCache<RepairOrder[]>(key);
    if (v) return v;
  }
  const data = await fetchAllRepairOrders({
    shopId,
    postedDateStart: w.startISO,
    postedDateEnd: w.endISO,
  });
  // Dated RO windows are large and regenerable. Expire them so they can't
  // accumulate forever and exhaust the cache tier (root cause of the AR
  // "warming" bug). 14 days comfortably covers every window the dashboard
  // re-requests (this_week / this_month / trailing comparisons).
  await writeCache(key, data, { ttlSeconds: 14 * 24 * 60 * 60 });
  return data;
}

export async function rosForChain(w: WindowKey, opts: { excludeSecondary?: boolean } = {}): Promise<RepairOrder[]> {
  // Build the full list of shop IDs to fetch in one pass, then fan out in
  // parallel. Sequential fetching (the old pattern) wasted ~250ms per shop
  // on every cache miss — with 8+ shops that adds up to 2–4s of dead wait.
  const ids: number[] = [];
  for (const shop of SHOPS) {
    ids.push(shop.tekmetricId);
    if (shop.tekmetricIdSecondary && !opts.excludeSecondary) {
      // Fleet-only secondaries (e.g. Yuma-B / 18346) are included here so their
      // revenue reaches chainKpi for the Net Sales reconciliation. chainKpi
      // buckets them separately and adds only revenue — never cars, GP, or ARO.
      ids.push(shop.tekmetricIdSecondary);
    }
  }
  const results = await Promise.all(ids.map(id => rosForShop(id, w)));
  return results.flat();
}

/**
 * Cache-only chain read: returns whatever RO windows are already cached (any
 * age) and NEVER triggers a live Tekmetric fetch. Used on request paths that
 * must stay fast even when Tekmetric is rate-limited (projection, AR) — a
 * background refresh keeps the cache warm. `hits` reports how many of the
 * shop windows were actually available so callers can flag partial data.
 */
export async function rosForChainCached(w: WindowKey): Promise<{ ros: RepairOrder[]; hits: number; total: number }> {
  const ids: number[] = [];
  for (const shop of SHOPS) {
    // Same fleet-only exclusion as rosForChain — cached path must stay consistent.
    ids.push(shop.tekmetricId);
    if (shop.tekmetricIdSecondary) ids.push(shop.tekmetricIdSecondary);
  }
  const total = ids.length;
  const values = await Promise.all(ids.map(id => readCache<RepairOrder[]>(cacheKey(id, w))));
  const ros: RepairOrder[] = [];
  let hits = 0;
  for (const v of values) {
    if (v) { ros.push(...v); hits++; }
  }
  return { ros, hits, total };
}

export async function rosForShopNum(num: ShopNum, w: WindowKey): Promise<RepairOrder[]> {
  const shop = SHOP_BY_NUM[num];
  // Fleet-only secondaries excluded — same rule as rosForChain.
  if (shop.tekmetricIdSecondary && !shop.tekmetricIdSecondaryFleetOnly) {
    const [primary, secondary] = await Promise.all([
      rosForShop(shop.tekmetricId, w),
      rosForShop(shop.tekmetricIdSecondary, w),
    ]);
    return [...primary, ...secondary];
  }
  return rosForShop(shop.tekmetricId, w);
}
