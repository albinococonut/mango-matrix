# Deferred work — Mango Matrix

Features that are scoped, designed, or scaffolded but not yet wired into the
live production build. Each entry lists the blocker and the smallest piece of
work needed to ship.

## 1. 180-day return rate

**Where:** `components/FBRLeaderboard.tsx` summary strip — currently shows
"—" for the "180d Return Rate" card.

**Blocker:** Computing it requires a 360-day historical RO pull per shop
(360 because we need today-180 through today+180 to detect "did the customer
come back"). That blows past the Tekmetric rate budget for a synchronous
request and would need to live behind a slower batch cron.

**Smallest path to ship:**
- Add `compute180dReturnRate` to `lib/fbr.ts`: for ROs closed 180–360 days
  ago, did the customer post another RO within 180 days of that close?
- Add a `refresh-return-rate` job to `lib/syncJobs.ts` (gated on a new
  `ENABLE_RETURN_RATE` env var so it doesn't run on every cron tick — it's
  a slow one).
- Cache the result under key `return_rate_180d` and read it from
  `/api/fbr?view=leaderboard` so the summary strip can display it.
- Acceptable refresh cadence: weekly.

## 2. Server-side goals (exec-only editing)

**Where:** `components/ShopPerformanceTable.tsx` — goals are currently stored
in `localStorage` per-browser, so each user sees their own goals.

**Blocker:** No persistence layer. Vercel KV or a tiny Postgres table would
work; we deferred until a paid Vercel tier or a managed DB is in place.

**Smallest path to ship:**
- Add `app/api/goals/route.ts`: GET (any role) + PUT (executive only via
  `getRole(req) === 'executive'`).
- Persist as a single JSON document keyed by `shopNum`.
- Update `lib/goals.ts` to fetch from `/api/goals` on mount and write to it
  on save (instead of localStorage).
- Hide the "Edit goals" button for employees on the client and refuse PUTs
  on the server.

Pick Vercel KV (simplest, paid tier required) or reuse the GBP-deferred
Postgres table once that's live.

## 3. Google Business Profile review sync

**Where:** Scaffolded in `_disabled_routes/auth/google/*` and the original
`gbpReviewSync` in `_disabled_jobs/syncJobs-full.ts` (full version of the
sync registry).

**Blocker:**
- Requires Postgres (we have OAuth client + env vars, no DB yet).
- Requires Google to approve our OAuth consent screen for the
  `business.manage` scope (multi-week verification process).
- The bundled Postgres + Google API libs push the sync function past
  Vercel Hobby's 250MB unzipped size cap — needs Pro tier or function
  isolation.

**Smallest path to ship:**
- Provision Postgres (Neon, Supabase, or Vercel Postgres).
- Run the schema in `db/schema.sql`.
- Submit OAuth consent screen for verification.
- Restore `gbpReviewSync` to `lib/syncJobs.ts` JOBS array.
- Restore `app/auth/google/*` routes from `_disabled_routes/`.
- Upgrade to Vercel Pro (or split GBP into its own deployable function).

## 4. Anthropic strict-classifier booked-rate

**Where:** `_disabled_jobs/syncJobs-full.ts` `refreshBookedRate` job (the
"strict" Claude pass that re-classifies WhatConverts call transcripts).

**Blocker:** The Anthropic SDK alone pushes past 250MB unzipped. The
booked-rate UI in `components/AppointmentBookedRate.tsx` currently shows
only the baseline (heuristic) computation.

**Smallest path to ship:**
- Upgrade to Vercel Pro to lift the 250MB cap, OR isolate the classifier
  into its own deployable (a separate API project that the cron hits).
- Restore `refreshBookedRate` to `lib/syncJobs.ts` JOBS array.

## 5. Re-Book leaderboard prior-week delta

**Where:** `components/FBRLeaderboard.tsx` `SummaryCard` — `delta` is always
0 because the API returns `chainFbrPriorWeek: 0` as a placeholder.

**Smallest path to ship:**
- In `app/api/fbr/route.ts` `view='leaderboard'`, compute the same metric
  for the *previous* full week (Mon-Sun two weeks back) and include it as
  `chainFbrPriorWeek` in the payload.
- The leaderboard component already wires it through — no client change
  needed.
