// Google Ratings leaderboard: per-shop current rating + last-7-day review counts.
// Uses Google Places API v1 (places.googleapis.com). Cached 4 hours.

import { NextResponse } from 'next/server';
import { SHOPS } from '@/lib/shops';
import { isFresh, readCache, writeCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';
const CACHE_KEY = 'google_ratings';
const FRESH_MS = 4 * 60 * 60 * 1000;
const API = 'https://places.googleapis.com/v1/places';
const FIELDS = 'id,displayName,rating,userRatingCount,reviews';

interface PlaceReview {
  publishTime?: string;  // ISO
  rating?: number;
  text?: { text: string };
  authorAttribution?: { displayName: string };
}
interface PlaceDetails {
  rating?: number;
  userRatingCount?: number;
  reviews?: PlaceReview[];
}

async function fetchPlace(placeId: string): Promise<PlaceDetails | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY not configured');
  const r = await fetch(`${API}/${placeId}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    cache: 'no-store',
  });
  if (!r.ok) {
    console.error(`[google-ratings] place ${placeId} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return null;
  }
  return r.json();
}

export async function handle() {
  if (await isFresh(CACHE_KEY, FRESH_MS)) {
    const cached = await readCache(CACHE_KEY);
    if (cached) return NextResponse.json(cached);
  }
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    const results = [];
    for (const shop of SHOPS) {
      if (!shop.googlePlaceId) {
        results.push({ shopNum: shop.num, shopName: shop.name, rating: null, total: 0, recentTotal: 0, fiveStar: 0, belowFive: 0 });
        continue;
      }
      const p = await fetchPlace(shop.googlePlaceId);
      if (!p) {
        results.push({ shopNum: shop.num, shopName: shop.name, rating: null, total: 0, recentTotal: 0, fiveStar: 0, belowFive: 0 });
        continue;
      }
      const allReviews = (p.reviews || []).map(rv => ({
        publishTime: rv.publishTime || '',
        rating: rv.rating || 0,
        text: rv.text?.text || '',
        author: rv.authorAttribution?.displayName || 'Anonymous',
      }));
      const recent = allReviews.filter(rv => rv.publishTime && new Date(rv.publishTime).getTime() >= cutoff);
      const fiveStar = recent.filter(rv => rv.rating === 5).length;
      const belowFive = recent.filter(rv => rv.rating > 0 && rv.rating < 5).length;
      results.push({
        shopNum: shop.num,
        shopName: shop.name,
        rating: p.rating ?? null,
        total: p.userRatingCount ?? 0,
        recentTotal: recent.length,
        fiveStar,
        belowFive,
        placeId: shop.googlePlaceId,
        // Up to the 5 reviews Google returns. We surface them in the popup so the user
        // can read what was posted. NOTE: Places v1 sorts these by "relevance" (not date),
        // so "last 7 days" counts may undercount. For accurate 7-day windows we'd need
        // the Google Business Profile API (OAuth + shop-owner auth required).
        reviews: allReviews,
      });
    }
    const payload = { computedAt: new Date().toISOString(), shops: results };
    await writeCache(CACHE_KEY, payload);
    return NextResponse.json(payload);
  } catch (e: any) {
    console.error('[google-ratings] failed:', e);
    return NextResponse.json({ error: e?.message || 'google-ratings failed' }, { status: 500 });
  }
}
