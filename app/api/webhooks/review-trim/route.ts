// Admin: trim a shop's Zapier review cache to keep only the N most-recent
// entries. Useful when a shop's cache has gotten ahead of others (e.g.
// from test-step floods during Zap setup) and you want to even out the
// "New reviews" leaderboard so no one starts with an artificial lead.
//
// Auth: same REVIEW_WEBHOOK_SECRET as /api/webhooks/review-ingest.
// Public path (under /api/webhooks/* → middleware allows).
//
// POST body: { secret, shopNum, keep }
//   - shopNum: e.g. "001" (Cottonwood). Required.
//   - keep:    integer >= 0. How many most-recent reviews to retain.
//              keep=0 wipes the shop's cache entirely.

import { NextRequest, NextResponse } from 'next/server';
import { readCache, writeCache } from '@/lib/cache';
import { ZAPIER_REVIEWS_KEY, type ZapierReview } from '@/lib/handlers/zapierReviews';
import { SHOP_BY_NUM } from '@/lib/shops';

export const dynamic = 'force-dynamic';

function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const expected = process.env.REVIEW_WEBHOOK_SECRET;
  if (!expected) return NextResponse.json({ error: 'REVIEW_WEBHOOK_SECRET not configured' }, { status: 500 });
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const token = typeof body.secret === 'string' ? body.secret : (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !constEq(token, expected)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const shopNum = String(body.shopNum || '').trim();
  if (!SHOP_BY_NUM[shopNum as keyof typeof SHOP_BY_NUM]) {
    return NextResponse.json({ error: `unknown shopNum: "${shopNum}"` }, { status: 400 });
  }
  const keep = Number(body.keep);
  if (!Number.isFinite(keep) || keep < 0 || keep > 200) {
    return NextResponse.json({ error: `keep must be 0..200, got: ${body.keep}` }, { status: 400 });
  }

  const existing = (await readCache<ZapierReview[]>(ZAPIER_REVIEWS_KEY(shopNum))) || [];
  // Sort by publishTime descending so the trim keeps the most-recently
  // published reviews. The cache is stored received-at-newest-first
  // (because the webhook prepends), but for trim purposes the dashboard
  // windows reviews by publishTime — keeping a 2022 entry over a fresh
  // one would make the shop look empty in the rolling-7d view.
  const sorted = [...existing].sort((a, b) =>
    (b.publishTime || '').localeCompare(a.publishTime || '')
  );
  const trimmed = sorted.slice(0, Math.floor(keep));
  await writeCache(ZAPIER_REVIEWS_KEY(shopNum), trimmed);

  return NextResponse.json({
    ok: true,
    shopNum,
    before: existing.length,
    after: trimmed.length,
    kept: trimmed.map(r => ({ id: r.id, rating: r.rating, publishTime: r.publishTime })),
  });
}
