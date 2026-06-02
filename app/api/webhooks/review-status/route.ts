// Public diagnostic for the Zapier review pipeline. Returns per-shop
// counts + last-received timestamps so we can verify each shop's review
// Zap is actually POSTing to /api/webhooks/review-ingest as expected.
//
// Safe to leave open: counts + timestamps only. No reviewer names, no
// review text, no shop-name leakage beyond what's already public on the
// Mango Automotive website. Sits under /api/webhooks/* so the middleware
// auth gate doesn't block it.

import { NextResponse } from 'next/server';
import { readCache } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';
import { ZAPIER_REVIEWS_KEY, type ZapierReview } from '@/lib/handlers/zapierReviews';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const detailed = url.searchParams.get('detailed') === '1';

  const rows = await Promise.all(SHOPS.map(async (s) => {
    const list = (await readCache<ZapierReview[]>(ZAPIER_REVIEWS_KEY(s.num))) || [];
    const newest = list[0];
    const base = {
      shopNum: s.num,
      shopName: s.name,
      reviewCount: list.length,
      lastReceivedAt: newest?.receivedAt ?? null,
      lastPublishTime: newest?.publishTime ?? null,
      lastRating: newest?.rating ?? null,
    };
    if (!detailed) return base;
    // Verbose mode: include rating + publishTime + receivedAt for every
    // cached review. No author / no body text — keeps the endpoint safe
    // to leave open for debugging.
    return {
      ...base,
      reviews: list.map(r => ({
        rating: r.rating,
        publishTime: r.publishTime,
        receivedAt: r.receivedAt,
        source: r.source ?? null,
      })),
    };
  }));
  const totalReviews = rows.reduce((sum, r) => sum + r.reviewCount, 0);
  const shopsWithData = rows.filter(r => r.reviewCount > 0).length;
  return NextResponse.json({
    summary: {
      totalReviews,
      shopsWithData,
      shopsTotal: SHOPS.length,
      checkedAt: new Date().toISOString(),
    },
    shops: rows,
  });
}
