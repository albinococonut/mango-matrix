// Google Business Profile API client. Handles:
//  - listing accounts and locations
//  - listing reviews per location (paginated)
//  - syncing reviews into the gbp_reviews table (idempotent on review_id)
// Includes automatic token-refresh retry on 401, with bounded retry+backoff
// on 429/5xx so a transient Google blip doesn't take down the sync.
//
// We talk to two API surfaces:
//  - mybusinessaccountmanagement.googleapis.com (v1) - list accounts
//  - mybusinessbusinessinformation.googleapis.com  (v1) - list locations
//  - mybusiness.googleapis.com (v4) - reviews (legacy but still the only path
//      Google offers for individual review records)

import { sql } from './db';
import { getAccessTokenForAccount, refreshAccessToken } from './gbpAuth';

const ACCT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const REVIEWS_API = 'https://mybusiness.googleapis.com/v4';

interface RawAccount { name: string; accountName: string; type: string }
interface RawLocation { name: string; title: string; storefrontAddress?: any; phoneNumbers?: { primaryPhone?: string } }
interface RawReview {
  name: string; reviewId: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE' | string;
  comment?: string;
  createTime: string; updateTime: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

const STAR_TO_INT: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** Fetch wrapper with token refresh on 401 + exponential backoff on 429/5xx. */
async function gbpFetch(
  accountId: string,
  url: string,
  opts: { method?: 'GET' | 'POST' | 'PATCH'; body?: any } = {},
): Promise<any> {
  const maxAttempts = 5;
  let lastError: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await getAccessTokenForAccount(accountId);
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401) {
      // Force a refresh next loop iteration by clearing the cached access token.
      const db = sql();
      await db`UPDATE gbp_oauth_tokens SET access_token_expires_at = NOW() - INTERVAL '1 minute' WHERE account_id = ${accountId}`;
      continue;
    }
    if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
      const retryAfter = Number(r.headers.get('retry-after')) || 0;
      const delay = retryAfter ? retryAfter * 1000 : Math.min(15_000, 500 * 2 ** attempt);
      await new Promise(res => setTimeout(res, delay));
      lastError = new Error(`GBP ${url} ${r.status}: ${(await r.text()).slice(0, 300)}`);
      continue;
    }
    if (!r.ok) throw new Error(`GBP ${url} ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }
  throw lastError || new Error(`GBP ${url}: exhausted retries`);
}

export async function listAccounts(accountId: string): Promise<RawAccount[]> {
  const all: RawAccount[] = [];
  let pageToken: string | undefined;
  do {
    const url = `${ACCT_API}/accounts?pageSize=20${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const j = await gbpFetch(accountId, url);
    all.push(...(j.accounts || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return all;
}

export async function listLocations(accountId: string): Promise<RawLocation[]> {
  const all: RawLocation[] = [];
  let pageToken: string | undefined;
  const fields = 'name,title,storefrontAddress,phoneNumbers';
  do {
    const url = `${INFO_API}/${accountId}/locations?readMask=${encodeURIComponent(fields)}&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const j = await gbpFetch(accountId, url);
    all.push(...(j.locations || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return all;
}

export async function listReviewsForLocation(accountId: string, locationName: string): Promise<RawReview[]> {
  // locationName = "accounts/<acct>/locations/<loc>"
  const all: RawReview[] = [];
  let pageToken: string | undefined;
  do {
    const url = `${REVIEWS_API}/${locationName}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const j = await gbpFetch(accountId, url);
    all.push(...(j.reviews || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return all;
}

/**
 * Sync all locations + reviews for a single account.
 * UPSERTs locations and reviews so re-runs are idempotent.
 * Returns counts so the sync route can log them.
 */
export async function syncAccount(accountId: string): Promise<{ locations: number; inserted: number; updated: number }> {
  const db = sql();
  const locations = await listLocations(accountId);
  // Upsert locations.
  for (const loc of locations) {
    await db`
      INSERT INTO gbp_locations (location_id, account_id, title, primary_phone, storefront_address, updated_at)
      VALUES (${loc.name}, ${accountId}, ${loc.title}, ${loc.phoneNumbers?.primaryPhone ?? null}, ${loc.storefrontAddress ?? null as any}, NOW())
      ON CONFLICT (location_id) DO UPDATE SET
        title = EXCLUDED.title,
        primary_phone = EXCLUDED.primary_phone,
        storefront_address = EXCLUDED.storefront_address,
        updated_at = NOW()
    `;
  }
  let inserted = 0;
  let updated = 0;
  for (const loc of locations) {
    const reviews = await listReviewsForLocation(accountId, loc.name);
    for (const rv of reviews) {
      const star = typeof rv.starRating === 'string' ? STAR_TO_INT[rv.starRating] ?? 0 : Number(rv.starRating) || 0;
      // We use ON CONFLICT to dedupe by review_id. xmax = 0 means insert happened.
      const result = await db`
        INSERT INTO gbp_reviews (
          review_id, location_id, star_rating, reviewer_display_name, reviewer_profile_photo_url,
          comment, create_time, update_time, reply_comment, reply_update_time, raw
        ) VALUES (
          ${rv.name}, ${loc.name}, ${star}, ${rv.reviewer?.displayName ?? null}, ${rv.reviewer?.profilePhotoUrl ?? null},
          ${rv.comment ?? null}, ${rv.createTime}, ${rv.updateTime},
          ${rv.reviewReply?.comment ?? null}, ${rv.reviewReply?.updateTime ?? null}, ${rv as any}
        )
        ON CONFLICT (review_id) DO UPDATE SET
          star_rating = EXCLUDED.star_rating,
          reviewer_display_name = EXCLUDED.reviewer_display_name,
          reviewer_profile_photo_url = EXCLUDED.reviewer_profile_photo_url,
          comment = EXCLUDED.comment,
          update_time = EXCLUDED.update_time,
          reply_comment = EXCLUDED.reply_comment,
          reply_update_time = EXCLUDED.reply_update_time,
          raw = EXCLUDED.raw
        RETURNING (xmax = 0) AS inserted
      `;
      if ((result[0] as any)?.inserted) inserted++; else updated++;
    }
    await db`UPDATE gbp_locations SET last_synced_at = NOW() WHERE location_id = ${loc.name}`;
  }
  return { locations: locations.length, inserted, updated };
}

/**
 * Sync every connected account. Logs to gbp_sync_runs and continues on per-account
 * errors so one revoked token doesn't kill the whole run.
 */
export async function syncAll(): Promise<{ accounts: number; totalInserted: number; totalUpdated: number; errors: string[] }> {
  const db = sql();
  const accounts = await db`SELECT account_id FROM gbp_oauth_tokens`;
  const runIds: number[] = [];
  let totalInserted = 0, totalUpdated = 0;
  const errors: string[] = [];
  for (const a of accounts) {
    const accountId = (a as any).account_id as string;
    const inserted = await db`INSERT INTO gbp_sync_runs (account_id, status) VALUES (${accountId}, 'running') RETURNING id`;
    const runId = (inserted[0] as any).id as number;
    runIds.push(runId);
    try {
      const r = await syncAccount(accountId);
      totalInserted += r.inserted; totalUpdated += r.updated;
      await db`UPDATE gbp_sync_runs SET status='ok', finished_at=NOW(), locations_synced=${r.locations}, reviews_inserted=${r.inserted}, reviews_updated=${r.updated} WHERE id=${runId}`;
    } catch (e: any) {
      const msg = e?.message || String(e);
      errors.push(`${accountId}: ${msg}`);
      await db`UPDATE gbp_sync_runs SET status='error', finished_at=NOW(), error_message=${msg} WHERE id=${runId}`;
    }
  }
  return { accounts: accounts.length, totalInserted, totalUpdated, errors };
}
