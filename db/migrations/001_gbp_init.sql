-- Google Business Profile integration schema.
-- Run once against your Postgres DB: psql $DATABASE_URL -f db/migrations/001_gbp_init.sql

-- Holds OAuth tokens per connected Google account.
-- One row per account; refreshing the same account UPSERTs.
CREATE TABLE IF NOT EXISTS gbp_oauth_tokens (
  account_id TEXT PRIMARY KEY,          -- Google account resource name suffix, e.g. "accounts/123456"
  account_name TEXT NOT NULL,           -- human-readable name from Google
  refresh_token TEXT NOT NULL,
  access_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL,
  connected_by TEXT,                    -- email of the user that connected
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Locations discovered under each connected account. We sync these on connect
-- and on every hourly sync run so renamed/added locations are picked up.
CREATE TABLE IF NOT EXISTS gbp_locations (
  location_id TEXT PRIMARY KEY,          -- "accounts/<acct>/locations/<loc>"
  account_id TEXT NOT NULL REFERENCES gbp_oauth_tokens(account_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  shop_num TEXT,                         -- optional mapping to our SHOPS.num (e.g. "001"); set via admin UI
  primary_phone TEXT,
  storefront_address JSONB,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gbp_locations_shop_num_idx ON gbp_locations(shop_num);

-- Reviews. Primary key is the upstream review name so re-imports are idempotent.
CREATE TABLE IF NOT EXISTS gbp_reviews (
  review_id TEXT PRIMARY KEY,            -- "accounts/<acct>/locations/<loc>/reviews/<rev>"
  location_id TEXT NOT NULL REFERENCES gbp_locations(location_id) ON DELETE CASCADE,
  star_rating SMALLINT NOT NULL,         -- 1..5
  reviewer_display_name TEXT,
  reviewer_profile_photo_url TEXT,
  comment TEXT,
  create_time TIMESTAMPTZ NOT NULL,
  update_time TIMESTAMPTZ NOT NULL,
  reply_comment TEXT,
  reply_update_time TIMESTAMPTZ,
  raw JSONB,                              -- original payload for audit / future fields
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Hot path indexes: by location and by recency.
CREATE INDEX IF NOT EXISTS gbp_reviews_location_create_idx ON gbp_reviews(location_id, create_time DESC);
CREATE INDEX IF NOT EXISTS gbp_reviews_create_time_idx ON gbp_reviews(create_time DESC);
CREATE INDEX IF NOT EXISTS gbp_reviews_star_create_idx ON gbp_reviews(star_rating, create_time DESC);

-- Log of sync runs for observability / debugging.
CREATE TABLE IF NOT EXISTS gbp_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  account_id TEXT,                       -- nullable; null = all accounts in one run
  status TEXT NOT NULL,                  -- 'running' | 'ok' | 'partial' | 'error'
  locations_synced INT DEFAULT 0,
  reviews_inserted INT DEFAULT 0,
  reviews_updated INT DEFAULT 0,
  error_message TEXT
);
