// Dashboard-optimized review query helpers. Each function returns shapes the
// frontend can render directly — no joins or transformations on the client.
// All queries are indexed by (location_id, create_time DESC) or (create_time DESC).

import { hasDatabase, sql } from './db';

export interface ReviewRow {
  reviewId: string;
  locationId: string;
  shopNum: string | null;
  starRating: number;
  reviewerDisplayName: string | null;
  reviewerProfilePhotoUrl: string | null;
  comment: string | null;
  createTime: string;
  updateTime: string;
  replyComment: string | null;
  replyUpdateTime: string | null;
}

export interface LocationSummary {
  locationId: string;
  title: string;
  shopNum: string | null;
  averageRating: number | null;
  totalReviews: number;
  last7Days: { total: number; fiveStar: number; belowFive: number };
  last30Days: { total: number; fiveStar: number; belowFive: number };
}

function toRow(r: any): ReviewRow {
  return {
    reviewId: r.review_id,
    locationId: r.location_id,
    shopNum: r.shop_num ?? null,
    starRating: r.star_rating,
    reviewerDisplayName: r.reviewer_display_name,
    reviewerProfilePhotoUrl: r.reviewer_profile_photo_url,
    comment: r.comment,
    createTime: r.create_time,
    updateTime: r.update_time,
    replyComment: r.reply_comment,
    replyUpdateTime: r.reply_update_time,
  };
}

/** New 5-star reviews in the last 7 days, chain-wide. Optionally filter by location. */
export async function new5StarLast7Days(opts: { locationId?: string; limit?: number } = {}): Promise<ReviewRow[]> {
  if (!hasDatabase()) return [];
  const db = sql();
  const limit = opts.limit ?? 200;
  const rows = opts.locationId
    ? await db`SELECT r.*, l.shop_num FROM gbp_reviews r LEFT JOIN gbp_locations l ON l.location_id = r.location_id
               WHERE r.location_id = ${opts.locationId} AND r.star_rating = 5
                 AND r.create_time >= NOW() - INTERVAL '7 days'
               ORDER BY r.create_time DESC LIMIT ${limit}`
    : await db`SELECT r.*, l.shop_num FROM gbp_reviews r LEFT JOIN gbp_locations l ON l.location_id = r.location_id
               WHERE r.star_rating = 5 AND r.create_time >= NOW() - INTERVAL '7 days'
               ORDER BY r.create_time DESC LIMIT ${limit}`;
  return rows.map(toRow);
}

/** Reviews for one location, most recent first. */
export async function reviewsByLocation(locationId: string, limit = 100, sinceDays?: number): Promise<ReviewRow[]> {
  if (!hasDatabase()) return [];
  const db = sql();
  const rows = sinceDays
    ? await db`SELECT r.*, l.shop_num FROM gbp_reviews r LEFT JOIN gbp_locations l ON l.location_id = r.location_id
               WHERE r.location_id = ${locationId} AND r.create_time >= NOW() - (${sinceDays}::text || ' days')::interval
               ORDER BY r.create_time DESC LIMIT ${limit}`
    : await db`SELECT r.*, l.shop_num FROM gbp_reviews r LEFT JOIN gbp_locations l ON l.location_id = r.location_id
               WHERE r.location_id = ${locationId}
               ORDER BY r.create_time DESC LIMIT ${limit}`;
  return rows.map(toRow);
}

/**
 * Per-location summary used by the dashboard leaderboard.
 * One row per known location, with rolled-up counts for last 7d / 30d.
 */
export async function locationSummaries(): Promise<LocationSummary[]> {
  if (!hasDatabase()) return [];
  const db = sql();
  const rows = await db`
    SELECT
      l.location_id, l.title, l.shop_num,
      COUNT(r.*) AS total_reviews,
      AVG(r.star_rating)::numeric(10,2) AS avg_rating,
      COUNT(*) FILTER (WHERE r.create_time >= NOW() - INTERVAL '7 days') AS recent7,
      COUNT(*) FILTER (WHERE r.create_time >= NOW() - INTERVAL '7 days' AND r.star_rating = 5) AS recent7_five,
      COUNT(*) FILTER (WHERE r.create_time >= NOW() - INTERVAL '7 days' AND r.star_rating < 5) AS recent7_below,
      COUNT(*) FILTER (WHERE r.create_time >= NOW() - INTERVAL '30 days') AS recent30,
      COUNT(*) FILTER (WHERE r.create_time >= NOW() - INTERVAL '30 days' AND r.star_rating = 5) AS recent30_five,
      COUNT(*) FILTER (WHERE r.create_time >= NOW() - INTERVAL '30 days' AND r.star_rating < 5) AS recent30_below
    FROM gbp_locations l
    LEFT JOIN gbp_reviews r ON r.location_id = l.location_id
    GROUP BY l.location_id, l.title, l.shop_num
    ORDER BY l.shop_num NULLS LAST, l.title
  `;
  return rows.map((r: any) => ({
    locationId: r.location_id, title: r.title, shopNum: r.shop_num,
    averageRating: r.avg_rating !== null ? Number(r.avg_rating) : null,
    totalReviews: Number(r.total_reviews),
    last7Days: { total: Number(r.recent7), fiveStar: Number(r.recent7_five), belowFive: Number(r.recent7_below) },
    last30Days: { total: Number(r.recent30), fiveStar: Number(r.recent30_five), belowFive: Number(r.recent30_below) },
  }));
}

export interface TrendPoint { weekStart: string; reviewCount: number; avgRating: number | null }

/**
 * Per-location trend: weekly review count + avg rating for the last N weeks.
 * Returns an array of weeks (oldest first) suitable for sparkline/heatmap rendering.
 */
export async function locationTrend(locationId: string, weeks = 12): Promise<TrendPoint[]> {
  if (!hasDatabase()) return [];
  const db = sql();
  const rows = await db`
    WITH weeks AS (
      SELECT generate_series(
        date_trunc('week', NOW() - (${weeks}::text || ' weeks')::interval),
        date_trunc('week', NOW()),
        INTERVAL '1 week'
      ) AS week_start
    )
    SELECT
      w.week_start AS week_start,
      COUNT(r.*) AS review_count,
      AVG(r.star_rating)::numeric(10,2) AS avg_rating
    FROM weeks w
    LEFT JOIN gbp_reviews r
      ON r.location_id = ${locationId}
      AND r.create_time >= w.week_start
      AND r.create_time <  w.week_start + INTERVAL '1 week'
    GROUP BY w.week_start
    ORDER BY w.week_start ASC
  `;
  return rows.map((r: any) => ({
    weekStart: new Date(r.week_start).toISOString().slice(0, 10),
    reviewCount: Number(r.review_count),
    avgRating: r.avg_rating !== null ? Number(r.avg_rating) : null,
  }));
}

/** Chain-wide trend (same shape, sums across all locations). */
export async function chainTrend(weeks = 12): Promise<TrendPoint[]> {
  if (!hasDatabase()) return [];
  const db = sql();
  const rows = await db`
    WITH weeks AS (
      SELECT generate_series(
        date_trunc('week', NOW() - (${weeks}::text || ' weeks')::interval),
        date_trunc('week', NOW()),
        INTERVAL '1 week'
      ) AS week_start
    )
    SELECT
      w.week_start AS week_start,
      COUNT(r.*) AS review_count,
      AVG(r.star_rating)::numeric(10,2) AS avg_rating
    FROM weeks w
    LEFT JOIN gbp_reviews r ON r.create_time >= w.week_start AND r.create_time < w.week_start + INTERVAL '1 week'
    GROUP BY w.week_start
    ORDER BY w.week_start ASC
  `;
  return rows.map((r: any) => ({
    weekStart: new Date(r.week_start).toISOString().slice(0, 10),
    reviewCount: Number(r.review_count),
    avgRating: r.avg_rating !== null ? Number(r.avg_rating) : null,
  }));
}
