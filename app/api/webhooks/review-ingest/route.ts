// Zapier review ingestion webhook.
//
// Setup on Zapier:
//   1. In each review Zap (one per source: Google, Yelp, etc), add a
//      "Webhooks by Zapier > POST" action AFTER the existing Slack step.
//   2. URL: https://mango-matrix.vercel.app/api/webhooks/review-ingest
//   3. Set "Send as JSON" = true.
//   4. Data shape — Zapier "Custom Request" body, JSON:
//        {
//          "secret": "<REVIEW_WEBHOOK_SECRET>",
//          "shop": "Cottonwood ABQ",         // shop name as Google sees it
//          "rating": 5,                       // 1..5
//          "body": "Great service...",        // review text
//          "reviewer": "Jane Doe",            // reviewer name
//          "publishTime": "2026-05-21T12:00:00-07:00",  // ISO (optional;
//                                                       // server time used
//                                                       // if absent)
//          "source": "google",                // optional; for filtering
//          "id": "<unique-id>"                // optional; dedup key
//        }
//   5. Test the Zap, confirm 200 OK.
//
// Per-shop cache is a rolling list of the last 50 reviews. The dashboard
// reads it via /api/extras?view=zapier-reviews.

import { NextRequest, NextResponse } from 'next/server';
import { readCache, writeCache } from '@/lib/cache';
import { ZAPIER_REVIEWS_KEY, REVIEW_CACHE_MAX, matchShopName, type ZapierReview } from '@/lib/handlers/zapierReviews';

export const dynamic = 'force-dynamic';

function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const expected = process.env.REVIEW_WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'REVIEW_WEBHOOK_SECRET not configured' }, { status: 500 });
  }
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  // Accept secret in body (Zapier-friendly) OR Authorization header.
  const tokenFromBody = typeof body.secret === 'string' ? body.secret : '';
  const tokenFromHeader = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = tokenFromBody || tokenFromHeader;
  if (!token || !constEq(token, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const shopRaw = String(body.shop || body.shopName || body.location || '').trim();
  const shopNum = matchShopName(shopRaw);
  if (!shopNum) {
    return NextResponse.json({ error: `unknown shop: "${shopRaw}"` }, { status: 400 });
  }

  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: `rating must be 1..5, got: ${body.rating}` }, { status: 400 });
  }

  const review: ZapierReview = {
    id: String(body.id || body.zap_meta_id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    rating: Math.round(rating),
    body: String(body.body || body.text || body.review || '').slice(0, 4000),
    reviewerName: String(body.reviewer || body.author || body.reviewerName || 'Anonymous').slice(0, 120),
    publishTime: body.publishTime ? new Date(body.publishTime).toISOString() : new Date().toISOString(),
    source: body.source ? String(body.source).slice(0, 30) : undefined,
    receivedAt: new Date().toISOString(),
  };

  const existing = (await readCache<ZapierReview[]>(ZAPIER_REVIEWS_KEY(shopNum))) || [];
  // Dedup by id; new entry takes precedence.
  const filtered = existing.filter(r => r.id !== review.id);
  const next = [review, ...filtered].slice(0, REVIEW_CACHE_MAX);
  await writeCache(ZAPIER_REVIEWS_KEY(shopNum), next);

  return NextResponse.json({
    ok: true,
    shopNum,
    shopName: shopRaw,
    cached: next.length,
    review: { id: review.id, rating: review.rating, publishTime: review.publishTime },
  });
}
