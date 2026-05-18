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
  await writeCache(key, data);
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

export async function rosForShopNum(num: ShopNum, w: WindowKey): Promise<RepairOrder[]> {
  const shop = SHOP_BY_NUM[num];
  const out = await rosForShop(shop.tekmetricId, w);
  if (shop.tekmetricIdSecondary) out.push(...(await rosForShop(shop.tekmetricIdSecondary, w)));
  return out;
}
