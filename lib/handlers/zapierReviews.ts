// Zapier-fed reviews — replaces the Google Places "New reviews" panel with
// a live feed from your Zapier-to-Slack pipeline. Same Zaps that post to
// #general add a second "Webhooks by Zapier (POST)" step pointed at
// /api/webhooks/review-ingest on the dashboard.
//
// Storage: one rolling list per shop, capped at 50 entries.
// Time windows: rolling-7d and WTD are derived at read time from publishTime.

import { NextResponse } from 'next/server';
import { readCache } from '@/lib/cache';
import { SHOPS, type ShopNum } from '@/lib/shops';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfWeek } from 'date-fns';
import { CHAIN_TZ } from '@/lib/dates';

export const ZAPIER_REVIEWS_KEY = (num: string) => `zapier_reviews_${num}`;
export const REVIEW_CACHE_MAX = 50;

export interface ZapierReview {
  id: string;                      // dedup key (Zapier hook id or our hash)
  rating: number;                  // 1..5
  body: string;
  reviewerName: string;
  publishTime: string;             // ISO
  source?: string;                 // 'google' | 'yelp' | 'facebook' | etc.
  receivedAt: string;              // server timestamp
}

// Per-window slice: {total, fiveStar, belowFive, reviews}. Mirrors the
// shape the existing GoogleRatings component expects on `windows.rolling7d`
// / `windows.thisWeek`, so the UI swap is one-line.
interface WindowSlice {
  total: number;
  fiveStar: number;
  belowFive: number;
  reviews: Array<{ publishTime: string; rating: number; text: string; author: string }>;
}

function buildSlice(reviews: ZapierReview[], sinceMs: number): WindowSlice {
  const inRange = reviews.filter(r => r.publishTime && new Date(r.publishTime).getTime() >= sinceMs);
  return {
    total: inRange.length,
    fiveStar: inRange.filter(r => r.rating === 5).length,
    belowFive: inRange.filter(r => r.rating > 0 && r.rating < 5).length,
    reviews: inRange.map(r => ({ publishTime: r.publishTime, rating: r.rating, text: r.body, author: r.reviewerName })),
  };
}

function windowBoundaries() {
  const nowMs = Date.now();
  const rolling7dMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  const mtnNow = toZonedTime(new Date(), CHAIN_TZ);
  const thisWeekMtn = startOfWeek(mtnNow, { weekStartsOn: 1 });
  const thisWeekMs = fromZonedTime(thisWeekMtn, CHAIN_TZ).getTime();
  return { rolling7dMs, thisWeekMs };
}

// ---- Shop-name matching --------------------------------------------------
//
// Zapier sends shop names as they appear in the review source (e.g. "Cottonwood
// ABQ", "The Heights ABQ", "The Valley"). Normalize and match against our
// canonical list. Returns null on no match so the webhook can 400 cleanly.

const NAME_OVERRIDES: Record<string, ShopNum> = {
  'cottonwood abq': '001',
  'cottonwood': '001',
  'the heights abq': '002',
  'heights abq': '002',
  'the heights': '002',
  'heights': '002',
  'downtown abq': '003',
  'downtown': '003',
  'pellicano': '004',
  'las cruces': '005',
  'yuma': '006',
  'montana': '007',
  'the valley': '009',
  'valley': '009',
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function matchShopName(input: string | null | undefined): ShopNum | null {
  if (!input) return null;
  const n = normalize(input);
  if (NAME_OVERRIDES[n]) return NAME_OVERRIDES[n];
  // Fallback: substring on the canonical shop name.
  for (const s of SHOPS) {
    if (n.includes(normalize(s.name))) return s.num as ShopNum;
  }
  return null;
}

// ---- Endpoint shape (mirrors googleRatings response) ---------------------

export async function handle() {
  const { rolling7dMs, thisWeekMs } = windowBoundaries();
  const shops = [];
  for (const s of SHOPS) {
    const list = (await readCache<ZapierReview[]>(ZAPIER_REVIEWS_KEY(s.num))) || [];
    shops.push({
      shopNum: s.num,
      shopName: s.name,
      // Cumulative rating + total cannot be derived from individual review
      // events — those come from Google Places elsewhere. Surface what we
      // have from the live feed only.
      rating: null,
      total: 0,
      windows: {
        rolling7d: buildSlice(list, rolling7dMs),
        thisWeek: buildSlice(list, thisWeekMs),
      },
    });
  }
  return NextResponse.json({ computedAt: new Date().toISOString(), shops });
}
