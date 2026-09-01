import { NextRequest, NextResponse } from 'next/server';
import { requireExecutive } from '@/lib/serverAuth';
import { warmSalesEffectivenessForShop, SE_SHOP_CACHE_KEY } from '@/lib/salesEffectiveness';
import { readCache } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export const GET = requireExecutive(async (req: NextRequest) => {
  const shopParam = req.nextUrl.searchParams.get('shop');

  // Single-shop mode: ?shop=NNN — warms one shop immediately, no delay.
  // Use this to warm shops one at a time without risking a 300s timeout.
  if (shopParam) {
    const shop = SHOPS.find(s => s.num === shopParam);
    if (!shop) return NextResponse.json({ error: `unknown shop ${shopParam}` }, { status: 400 });
    try {
      const msg = await warmSalesEffectivenessForShop(shopParam);
      return NextResponse.json({ ok: true, shop: shopParam, message: msg });
    } catch (e: any) {
      return NextResponse.json({ ok: false, shop: shopParam, error: e?.message ?? 'unknown' }, { status: 500 });
    }
  }

  // All-shops mode (legacy): sequential with 20s gap to stay under RC rate limit.
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
