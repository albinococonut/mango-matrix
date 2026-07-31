import { NextRequest, NextResponse } from 'next/server';
import { requireExecutive } from '@/lib/serverAuth';
import { warmSalesEffectivenessForShop, SE_SHOP_CACHE_KEY } from '@/lib/salesEffectiveness';
import { readCache } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = requireExecutive(async (_req: NextRequest) => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const results: Record<string, string> = {};
  let first = true;
  for (const shop of SHOPS) {
    // Skip shops already warmed in the past hour (avoids redundant RC calls)
    const existing = await readCache<{ computedAt?: string }>(SE_SHOP_CACHE_KEY(shop.num));
    if (existing?.computedAt) {
      const age = Date.now() - new Date(existing.computedAt).getTime();
      if (age < 60 * 60 * 1000) {
        results[shop.num] = `already warm (${Math.round(age / 60000)}m ago)`;
        continue;
      }
    }
    // 20s gap between RC calls keeps well under the 10 req/min rate limit
    if (!first) await delay(20000);
    first = false;
    try {
      results[shop.num] = await warmSalesEffectivenessForShop(shop.num);
    } catch (e: any) {
      results[shop.num] = `ERROR: ${e?.message ?? 'unknown'}`;
    }
  }
  return NextResponse.json({ ok: true, results });
});
