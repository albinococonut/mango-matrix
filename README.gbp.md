# Google Business Profile review integration — setup

This integration replaces the Places-API-based ratings card with a real,
un-truncated review feed pulled directly from Google Business Profile and
stored in Postgres. Hourly sync; deduplicated by review ID; OAuth refresh
tokens handled automatically.

The dashboard's Google Ratings card uses GBP data when connected and
silently falls back to Places when it's not — so you can deploy the code
before completing the Google setup.

## 1) Apply for Business Profile API access (do this first — takes days)

Google gates the Business Profile APIs. Until you're approved, OAuth will
succeed but the API calls return 403.

1. Go to https://developers.google.com/my-business
2. Click "Get started" → "Apply for API access"
3. Use the same Google account that owns / manages Mango's Business
   Profile locations
4. Project: create a new Google Cloud project (or pick one) and provide its
   project ID
5. Wait for approval email (sometimes hours, sometimes weeks)

While that's pending, do steps 2–5 below so you're ready.

## 2) Enable the APIs and create OAuth credentials

In the Google Cloud Console for the project above:

1. APIs & Services → Library → enable each of these:
   - **My Business Account Management API**
   - **My Business Business Information API**
   - **Google My Business API** (the v4 one — search "My Business API" if not visible)
2. APIs & Services → Credentials → "Create credentials" → "OAuth client ID"
3. Application type: **Web application**
4. Authorized redirect URIs (add both):
   - `https://YOUR-VERCEL-DOMAIN.vercel.app/api/gbp/oauth/callback`
   - `http://localhost:3000/api/gbp/oauth/callback`
5. Copy the **Client ID** and **Client secret** — you'll paste them as env vars
6. OAuth consent screen → set User type to **External** (or Internal if
   you're using Google Workspace). Add the `business.manage` scope.

## 3) Provision Postgres

Any Postgres works. Easiest options:

- **Vercel Postgres** (Vercel dashboard → Storage → Create Database)
- **Supabase** (https://supabase.com → New project → copy connection string)
- **Neon** (https://neon.tech → free tier)

Grab the connection string. It looks like:
`postgresql://user:pass@host:5432/dbname?sslmode=require`

## 4) Run the migration

```bash
psql "$DATABASE_URL" -f db/migrations/001_gbp_init.sql
```

Or paste the contents of `db/migrations/001_gbp_init.sql` into your DB
provider's SQL editor and run it.

## 5) Set env vars

Locally in `.env.local`:

```
DATABASE_URL=postgresql://...
GBP_OAUTH_CLIENT_ID=xxxxxx.apps.googleusercontent.com
GBP_OAUTH_CLIENT_SECRET=xxxxxx
# Optional — only set if your redirect URI isn't auto-detectable. Default uses VERCEL_URL.
# GBP_OAUTH_REDIRECT_URI=https://your-deploy.vercel.app/api/gbp/oauth/callback
```

In Vercel project settings → Environment Variables, add the same three.

## 6) Connect the account

1. Restart `npm run dev` (or redeploy on Vercel)
2. Visit `http://localhost:3000/admin/gbp` (or `/admin/gbp` in production)
3. Click **Connect Google account** — Google's consent page opens
4. Sign in as the user that manages Mango's Business Profile, approve access
5. You'll land back on the admin page with a list of accounts + locations

## 7) Map locations to shops

On the admin page, each Google location has a "Map to shop" dropdown. Pick
the matching shop (001 Cottonwood, 002 The Heights, etc.) so the dashboard
joins the right reviews to the right shop. **Unmapped locations are
ignored by the dashboard** (their reviews are still stored in the DB).

## 8) Verify

Click **Sync now** on the admin page. You should see:
- "Synced N accounts · M new reviews"
- Each location's "Reviews" count populates
- The dashboard's Google Ratings card now shows "Source: Business Profile API"
- 7-day counts are accurate (no longer capped at 5)

The hourly cron `0 * * * *` in `vercel.json` keeps things fresh after that.

## Endpoints

- `GET  /api/gbp/oauth/authorize` — kicks off OAuth (redirects to Google)
- `GET  /api/gbp/oauth/callback`  — Google redirects here, persists tokens
- `GET  /api/gbp/oauth/status`    — connection state + accounts/locations
- `POST /api/gbp/oauth/disconnect` — `{accountId}` removes an account
- `GET|POST /api/gbp/sync`         — runs sync for every connected account
- `PATCH /api/gbp/locations`      — `{locationId, shopNum}` map to shop
- `GET /api/gbp/reviews?fiveStarLast7=1` — chain-wide 5★ reviews last 7d
- `GET /api/gbp/reviews?locationId=...&limit=50&sinceDays=30`
- `GET /api/gbp/reviews-summary`  — per-location summary + chain weekly trend

## Helper queries (lib/reviews.ts)

- `new5StarLast7Days({ locationId?, limit? })`
- `reviewsByLocation(locationId, limit, sinceDays?)`
- `locationSummaries()` → array with `last7Days` / `last30Days` rollups
- `locationTrend(locationId, weeks=12)` → weekly count + avg rating
- `chainTrend(weeks=12)`

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| OAuth says "did not return a refresh token" | User already granted access | Revoke at https://myaccount.google.com/permissions and retry |
| `403` on listAccounts | API access not approved yet | Wait for Google approval email |
| `REFRESH_REVOKED` in sync logs | User removed access | Reconnect via admin page |
| `DATABASE_URL not configured` | Postgres env var missing | Set DATABASE_URL in `.env.local` and Vercel env |
| Sync hangs | Large location with many reviews | Each sync handles pagination; check `gbp_sync_runs` table for last run |
