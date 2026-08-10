-- Daily Ticker schema — UNUSED FOR NOW, kept as documentation only.
--
-- NOTE (2026-07-28): production has no DATABASE_URL, so the ticker system was
-- built on the existing Upstash Redis instead (lib/ticker.ts via lib/cache.ts):
--   key mango:ticker:override — JSON of the single override row
--   key mango:ticker:history  — JSON array of up to 50 lines, newest first
-- If the dashboard ever moves ticker storage to Postgres, this migration is
-- the schema to run: psql $DATABASE_URL -f db/migrations/002_ticker.sql

-- Admin override. Single logical row (id = 1), maintained via upsert.
-- When enabled AND within [starts_at, ends_at] (null = unbounded), the
-- override message replaces the automatic ticker verbatim.
CREATE TABLE IF NOT EXISTS ticker_override (
  id SERIAL PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  message TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'Company News',
  starts_at TIMESTAMPTZ NULL,
  ends_at TIMESTAMPTZ NULL,
  updated_by TEXT,                       -- email of the executive who last saved
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Every ticker line ever published. The daily Claude job inserts one row per
-- day (source = 'auto'); the latest row is what the intranet shows when no
-- override is active. Also serves as the repetition-check memory (last 14).
CREATE TABLE IF NOT EXISTS ticker_history (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  topic TEXT,                            -- short machine label, e.g. "shop-005-gp-streak"
  source TEXT NOT NULL DEFAULT 'auto',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ticker_history_created_idx ON ticker_history(created_at DESC);
