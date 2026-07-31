import { NextRequest, NextResponse } from 'next/server';
import { verifyRoleCookie } from '@/lib/auth';
import { cookies } from 'next/headers';
import { readCache } from '@/lib/cache';
import { SE_SHOP_CACHE_KEY, getSalesCallHandled, markSalesCallHandled, getSalesCallNotes, saveSalesCallNote } from '@/lib/salesEffectiveness';
import type { SalesEffectivenessShopCache } from '@/lib/salesEffectiveness';
import { SHOPS } from '@/lib/shops';

export async function handle(req: NextRequest) {
  const role = verifyRoleCookie(cookies().get('mango_session')?.value);

  // POST to mark a call as handled or save a note (employee+ allowed)
  if (req.method === 'POST') {
    if (!role) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const { shopNum, callId, note } = body ?? {};
    if (!shopNum || !callId) return NextResponse.json({ error: 'shopNum and callId required' }, { status: 400 });
    if (note !== undefined) {
      await saveSalesCallNote(String(shopNum), String(callId), String(note));
    } else {
      await markSalesCallHandled(String(shopNum), String(callId));
    }
    return NextResponse.json({ ok: true });
  }

  // GET — fetch all shops
  const results = await Promise.all(
    SHOPS.map(async (shop) => {
      const cache = await readCache<SalesEffectivenessShopCache>(SE_SHOP_CACHE_KEY(shop.num));
      if (!cache) return { shopNum: shop.num, shopName: shop.name, cached: false, computedAt: null, avgScore: 0, totalGraded: 0, needsCoachingCount: 0, grades: [] };

      const [handled, notes] = await Promise.all([
        getSalesCallHandled(shop.num),
        getSalesCallNotes(shop.num),
      ]);
      // Filter out non-inspection calls (pricing inquiries, pickups, etc.) at read time
      // so stale cache entries never reach the dashboard while awaiting next warm.
      const inspectionOnly = cache.grades.filter((g: any) => g.isInspectionResultsCall !== false);
      const gradesWithHandled = inspectionOnly.map(g => ({
        ...g,
        handled: handled.has(g.callId),
        note: notes.get(g.callId) ?? '',
      }));
      return { ...cache, grades: gradesWithHandled, cached: true };
    })
  );

  const totalGraded = results.reduce((s, r) => s + r.totalGraded, 0);
  const chainAvg = totalGraded > 0
    ? Math.round((results.reduce((s, r) => s + r.avgScore * r.totalGraded, 0) / totalGraded) * 10) / 10
    : 0;

  return NextResponse.json({
    shops: results,
    chain: { avgScore: chainAvg, totalGraded },
    computedAt: results.find(r => r.cached)?.computedAt ?? null,
  });
}
