// Computes new-customer counts (first RO at each shop per customer) from Tekmetric.
// This is expensive — hits the full RO history for every shop — so it's run by the
// cron job and the result is cached in Redis. The marketing dashboard reads from
// cache only; it never triggers this computation on page load.

import { fetchAllRepairOrders } from '@/lib/tekmetric';
import { SHOPS } from '@/lib/shops';
import { writeCache } from '@/lib/cache';

export interface ShopMonthNewCustomers {
  shopNum: string;
  month: string; // YYYY-MM
  newCustomers: number;
}

export const MARKETING_NC_CACHE_KEY = 'marketing_new_customers_v1';

export async function computeAndCacheNewCustomers(): Promise<ShopMonthNewCustomers[]> {
  const results: ShopMonthNewCustomers[] = [];

  await Promise.all(
    SHOPS.filter(s => s.openedAt).map(async (shop) => {
      try {
        const startISO = shop.openedAt! + 'T00:00:00Z';
        const endISO   = new Date().toISOString();

        const ros = await fetchAllRepairOrders({
          shopId: shop.tekmetricId,
          postedDateStart: startISO,
          postedDateEnd:   endISO,
        });

        const firstRO = new Map<number, string>(); // customerId -> YYYY-MM
        for (const ro of ros) {
          if (!ro.customerId || !ro.postedDate) continue;
          const month = ro.postedDate.slice(0, 7);
          const prev  = firstRO.get(ro.customerId);
          if (!prev || month < prev) firstRO.set(ro.customerId, month);
        }

        const counts = new Map<string, number>();
        for (const month of firstRO.values()) {
          counts.set(month, (counts.get(month) ?? 0) + 1);
        }
        for (const [month, nc] of counts) {
          results.push({ shopNum: shop.num, month, newCustomers: nc });
        }
      } catch (e) {
        console.error(`[marketing-nc] shop ${shop.num} failed:`, e);
      }
    })
  );

  await writeCache(MARKETING_NC_CACHE_KEY, results);
  return results;
}
