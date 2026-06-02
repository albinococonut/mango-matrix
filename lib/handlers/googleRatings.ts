// Google Ratings — per-shop cumulative star rating + total review count.
// Backed by Google Places API v1 (Place Details w/ Atmosphere field mask).
//
// COST CONTROL: the handler is READ-ONLY. The refresh is handled exclusively
// by the warm-google-ratings sync job (lib/syncJobs.ts), which runs once
// per day at 3 AM Mountain. Net: 8 Places calls/day → ~$4–5/month, vs the
// up-to-6×/day-per-shop pattern the old on-demand handler produced.
//
// New per-review windowed counts (rolling 7d, this week) come from a
// completely separate Zapier-fed cache (lib/handlers/zapierReviews.ts) and
// are merged client-side in components/GoogleRatings.tsx. This file's
// job is just rating + total + the Google-relevance-sorted sample of 5.

import { NextResponse } from 'next/server';
import { SHOPS } from '@/lib/shops';
import { readCache, writeCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const GOOGLE_RATINGS_CACHE_KEY = 'google_ratings';
const API = 'https://places.googleapis.com/v1/places';
const FIELDS = 'id,displayName,rating,userRatingCount,reviews';

interface PlaceReview {
  publishTime?: string;
  rating?: number;
  text?: { text: string };
  authorAttribution?: { displayName: string };
}
interface PlaceDetails {
  rating?: number;
  userRatingCount?: number;
  reviews?: PlaceReview[];
}

interface ShopRatingRow {
  shopNum: string;
  shopName: string;
  rating: number | null;
  total: number;
  placeId?: string;
  reviews?: Array<{ publishTime: string; rating: number; text: string; author: string }>;
}

export interface GoogleRatingsPayload {
  computedAt: string;
  shops: ShopRatingRow[];
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

/**
 * Hit Google Places once for every shop with a known googlePlaceId. Writes
 * the full payload to KV under GOOGLE_RATINGS_CACHE_KEY. Called by the
 * daily cron — never by the read handler.
 */
export async function refreshGoogleRatings(): Promise<GoogleRatingsPayload> {
  const results: ShopRatingRow[] = [];
  for (const shop of SHOPS) {
    if (!shop.googlePlaceId) {
      results.push({ shopNum: shop.num, shopName: shop.name, rating: null, total: 0 });
      continue;
    }
    const p = await fetchPlace(shop.googlePlaceId);
    if (!p) {
      results.push({ shopNum: shop.num, shopName: shop.name, rating: null, total: 0, placeId: shop.googlePlaceId });
      continue;
    }
    const reviews = (p.reviews || []).map(rv => ({
      publishTime: rv.publishTime || '',
      rating: rv.rating || 0,
      text: rv.text?.text || '',
      author: rv.authorAttribution?.displayName || 'Anonymous',
    }));
    results.push({
      shopNum: shop.num,
      shopName: shop.name,
      rating: p.rating ?? null,
      total: p.userRatingCount ?? 0,
      placeId: shop.googlePlaceId,
      reviews,
    });
  }
  const payload: GoogleRatingsPayload = { computedAt: new Date().toISOString(), shops: results };
  await writeCache(GOOGLE_RATINGS_CACHE_KEY, payload);
  return payload;
}

/**
 * Read-only handler. Serves whatever the daily warm last wrote to KV. If
 * nothing's there yet (cold env, first deploy), returns an empty payload
 * so the UI shows "—" rather than erroring.
 */
export async function handle() {
  const cached = await readCache<GoogleRatingsPayload>(GOOGLE_RATINGS_CACHE_KEY);
  if (cached) return NextResponse.json(cached);
  const empty: GoogleRatingsPayload = {
    computedAt: new Date().toISOString(),
    shops: SHOPS.map(shop => ({
      shopNum: shop.num,
      shopName: shop.name,
      rating: null,
      total: 0,
      placeId: shop.googlePlaceId,
    })),
  };
  return NextResponse.json(empty);
}
