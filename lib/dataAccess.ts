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
  const out: RepairOrder[] = [];
  for (const shop of SHOPS) {
    out.push(...(await rosForShop(shop.tekmetricId, w)));
    if (shop.tekmetricIdSecondary && !opts.excludeSecondary) {
      out.push(...(await rosForShop(shop.tekmetricIdSecondary, w)));
    }
  }
  return out;
}

/**
 * Cache-only chain read: returns whatever RO windows are already cached (any
 * age) and NEVER triggers a live Tekmetric fetch. Used on request paths that
 * must stay fast even when Tekmetric is rate-limited (projection, AR) — a
 * background refresh keeps the cache warm. `hits` reports how many of the
 * shop windows were actually available so callers can flag partial data.
 */
export async function rosForChainCached(w: WindowKey): Promise<{ ros: RepairOrder[]; hits: number; total: number }> {
  const out: RepairOrder[] = [];
  let hits = 0;
  let total = 0;
  for (const shop of SHOPS) {
    const ids = [shop.tekmetricId, ...(shop.tekmetricIdSecondary ? [shop.tekmetricIdSecondary] : [])];
    for (const id of ids) {
      total++;
      const v = await readCache<RepairOrder[]>(cacheKey(id, w));
      if (v) { out.push(...v); hits++; }
    }
  }
  return { ros: out, hits, total };
}

export async function rosForShopNum(num: ShopNum, w: WindowKey): Promise<RepairOrder[]> {
  const shop = SHOP_BY_NUM[num];
  const out = await rosForShop(shop.tekmetricId, w);
  if (shop.tekmetricIdSecondary) out.push(...(await rosForShop(shop.tekmetricIdSecondary, w)));
  return out;
}
