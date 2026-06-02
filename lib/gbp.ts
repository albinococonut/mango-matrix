// Google Business Profile API client. Lists accounts/locations/reviews via
// the official Google APIs:
//   - mybusinessaccountmanagement.googleapis.com/v1  → accounts
//   - mybusinessbusinessinformation.googleapis.com/v1 → locations
//   - mybusiness.googleapis.com/v4                    → reviews (still v4;
//       Google has not migrated the reviews endpoint to v1 as of this writing)
//
// Auth is single-connection (one Google login covers all 8 shops). Token
// refresh + 401 retry happens transparently — callers just call the
// list* functions and get JSON back.

import { getAccessToken, readStoredTokens, writeStoredTokens } from './gbpAuth';

const ACCT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const REVIEWS_API = 'https://mybusiness.googleapis.com/v4';

export interface GbpAccount {
  name: string;          // "accounts/<id>"
  accountName: string;
  type: string;
}
export interface GbpLocation {
  name: string;          // "accounts/<acct>/locations/<loc>"
  title: string;
  storefrontAddress?: any;
  phoneNumbers?: { primaryPhone?: string };
}
export interface GbpReview {
  name: string; reviewId: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE' | string;
  comment?: string;
  createTime: string; updateTime: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

export const STAR_TO_INT: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/**
 * Fetch with automatic token refresh on 401 + exponential backoff on 429/5xx.
 * Force-expires the cached access token after a 401 so the next attempt
 * triggers a fresh refresh from Google.
 */
async function gbpFetch(url: string): Promise<any> {
  const maxAttempts = 5;
  let lastError: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await getAccessToken();
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (r.status === 401) {
      // Force-expire the cached access token so the next loop refreshes.
      const stored = await readStoredTokens();
      if (stored) {
        await writeStoredTokens({ ...stored, access_token_expires_at: new Date(Date.now() - 60_000).toISOString() });
      }
      continue;
    }
    if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
      // 429 from the My Business APIs is almost always per-minute quota. The
      // quota window resets on the minute boundary, so we need to wait long
      // enough to cross it. Start at 8s, double up to 70s max — five
      // attempts gives us 8s + 16s + 32s + 64s + 70s ≈ 3 minutes total,
      // which clears multiple per-minute windows.
      const retryAfter = Number(r.headers.get('retry-after')) || 0;
      const delay = retryAfter ? retryAfter * 1000 : Math.min(70_000, 8_000 * 2 ** attempt);
      await new Promise(res => setTimeout(res, delay));
      lastError = new Error(`GBP ${url} ${r.status}: ${(await r.text()).slice(0, 300)}`);
      continue;
    }
    if (!r.ok) throw new Error(`GBP ${url} ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }
  throw lastError || new Error(`GBP ${url}: exhausted retries`);
}

export async function listAccounts(): Promise<GbpAccount[]> {
  const all: GbpAccount[] = [];
  let pageToken: string | undefined;
  do {
    const url = `${ACCT_API}/accounts?pageSize=20${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const j = await gbpFetch(url);
    all.push(...(j.accounts || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return all;
}

export async function listLocations(accountName: string): Promise<GbpLocation[]> {
  // accountName = "accounts/<id>"
  const all: GbpLocation[] = [];
  let pageToken: string | undefined;
  const fields = 'name,title,storefrontAddress,phoneNumbers';
  do {
    const url = `${INFO_API}/${accountName}/locations?readMask=${encodeURIComponent(fields)}&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const j = await gbpFetch(url);
    all.push(...(j.locations || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return all;
}

export async function listReviewsForLocation(locationName: string): Promise<GbpReview[]> {
  // locationName = "accounts/<acct>/locations/<loc>"
  const all: GbpReview[] = [];
  let pageToken: string | undefined;
  do {
    const url = `${REVIEWS_API}/${locationName}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const j = await gbpFetch(url);
    all.push(...(j.reviews || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return all;
}
