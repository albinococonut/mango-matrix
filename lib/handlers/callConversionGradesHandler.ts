import { NextResponse } from 'next/server';
import { readCache } from '@/lib/cache';
import { CC_SHOP_CACHE_KEY } from '@/lib/callConversionGrader';
import type { CallConversionShopCache } from '@/lib/callConversionGrader';
import { SHOPS } from '@/lib/shops';

export async function handle() {
  const results = await Promise.all(
    SHOPS.map(async (shop) => {
      const cache = await readCache<CallConversionShopCache>(CC_SHOP_CACHE_KEY(shop.num));
      if (!cache) {
        return { shopNum: shop.num, shopName: shop.name, cached: false, computedAt: null, avgScore: 0, totalGraded: 0, grades: [] };
      }
      return { ...cache, cached: true };
    })
  );

  const totalGraded = results.reduce((s, r) => s + r.totalGraded, 0);
  const avgScore = totalGraded > 0
    ? Math.round((results.reduce((s, r) => s + r.avgScore * r.totalGraded, 0) / totalGraded) * 10) / 10
    : 0;

  return NextResponse.json({
    shops: results,
    chain: { avgScore, totalGraded },
    computedAt: results.find(r => r.cached)?.computedAt ?? null,
  });
}
