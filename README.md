# Mango Automotive Dashboard

Rebuild of the existing Vercel dashboard with two new modules from the dev brief:

1. **Forward-Booking Rate (FBR) Leaderboard** — % of closed retail tickets where a follow-up appointment was scheduled at checkout. Per dev brief sections 3, 6, 8.
2. **Appointment-Booked Rate from Calls** — WTD-resetting bar chart computed from WhatConverts call transcripts. Two classifier paths: WhatConverts baseline (fast) and strict Claude classification (specific clock time offered AND customer agreed).

Plus the original dashboard surfaces:
- KPI cards (Revenue ex-tax, Cars, ARO, Close Rate)
- Revenue Projection (next 14 days, tech capacity, run rates, "What's Driving This")
- Forecast & Run Rate (next 31 days, monthly/annual)
- Revenue Opportunity (close rate gap)
- Period Comparison (YTD vs prior YTD)
- Shop Comparison line chart (daily/weekly/monthly)
- Shop Performance table (Revenue, Cars, ARO, Close, GP$, GP%, Parts GP%, Labor GP%, Discounts)
- Tech Production (top techs by billed hours, jobs, efficiency)

## Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Recharts for line + bar charts
- File-backed cache (swap for KV/Redis in prod)
- Anthropic SDK for strict transcript classification (Haiku 4.5)

## Local dev

```bash
cp .env.example .env.local
# fill in TEKMETRIC_CLIENT_ID, TEKMETRIC_CLIENT_SECRET
# fill in WHATCONVERTS_001 … WHATCONVERTS_009 in token:secret format
# fill in ANTHROPIC_API_KEY if using strict classifier
npm install
npm run dev
```

Open http://localhost:3000, log in with the value of `DASHBOARD_PASSWORD` (default `mango`).

## Deploy to Vercel

```bash
npx vercel --prod
```

Set the same env vars in the Vercel project settings.

### Cron schedule

`vercel.json` defines two cron jobs. Vercel cron times are UTC, so the brief's "hourly Mon-Fri 7a-7p Mountain" maps to UTC 13:00-01:00:

- `0 13-1 * * 1-5` — hourly baseline refresh, Mon-Fri business hours MT
- `0 14,18,23 * * 1-5` — three strict-LLM refreshes per day Mon-Fri (8am, noon, 5pm MT)

Vercel requires a Pro tier subscription for cron beyond the basic free hourly. Each strict refresh costs ~700 Haiku calls per week chain-wide (mid-single-digit dollars/month at current pricing).

To trigger manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://YOUR_DEPLOY.vercel.app/api/cron/booked-rate-refresh
# or with strict re-classification:
curl -H "Authorization: Bearer $CRON_SECRET" \
  'https://YOUR_DEPLOY.vercel.app/api/cron/booked-rate-refresh?strict=1'
```

## File map

```
app/
  layout.tsx              Root layout + Inter font
  page.tsx                Main dashboard composition
  globals.css             Tailwind base + component utilities
  login/page.tsx          Password gate UI
  api/
    login/route.ts        POST password -> sets auth cookie
    metrics/route.ts      Chain KPIs + daily series for a window
    forecast/route.ts     Forecast + revenue projection + tech capacity
    period-comparison/    YTD current vs prior overlay
    opportunity/route.ts  Close-rate gap calculation
    tech-production/      Top techs by billed hours
    fbr/route.ts          Forward-booking rate (leaderboard / heatmap views)
    booked-rate/route.ts  WhatConverts WTD snapshot (read-only cache)
    cron/
      booked-rate-refresh/   Vercel cron target -- baseline + optional strict
middleware.ts             Password gate
components/
  Header.tsx                       Date range + shop pickers
  KpiCards.tsx                     4 top cards
  RevenueProjectionCard.tsx        Next-14 + tech capacity + run rates
  ForecastCard.tsx                 Next-31 day projection
  RevenueOpportunityCard.tsx       Close-rate gap card
  PeriodComparison.tsx             YTD overlay chart
  ShopComparison.tsx               Per-shop daily/weekly/monthly chart
  ShopPerformanceTable.tsx         Full performance grid
  TechProduction.tsx               Tech leaderboard
  FBRLeaderboard.tsx               NEW - Forward-booking rate leaderboard
  FBRHeatmap.tsx                   NEW - 12-week heatmap
  AppointmentBookedRate.tsx        NEW - WhatConverts WTD bar chart
  charts/LineChartBlock.tsx        Recharts wrapper used by both line charts
lib/
  shops.ts                 Canonical shop map (Tekmetric IDs + WhatConverts profiles)
  tekmetric.ts             OAuth client, /repair-orders + /appointments pagination
  whatconverts.ts          Per-shop creds, /leads pagination, eligibility filter
  classify.ts              Anthropic SDK wrapper for the strict transcript prompt
  metrics.ts               Pure calculators: KPI, projection, forecast, opportunity, tech production
  fbr.ts                   FBR + KAR + fleet classifier per brief sections 3 + 6
  dataAccess.ts            Per-shop+window RO cache funnel
  dates.ts                 RangeKey -> {start, end} in Mountain TZ
  format.ts                USD / number / percent display helpers
  cache.ts                 File-backed JSON cache (replace with KV for prod)
data/cache/                Cached responses (gitignored)
vercel.json                Cron schedule
```

## What still needs wiring on real data (Phase-1 punch list)

- **Tekmetric `/appointments` query params:** I verified `/repair-orders` works with `postedDateStart`/`postedDateEnd`, but `/appointments` accepted `startTimeFrom`/`startTimeTo` with `200 OK` while returning rows outside the requested window — so the param names are different. Pull a real Tekmetric API doc and update `fetchAllAppointments` in `lib/tekmetric.ts`. Until then, FBR will be correct but slow (filtering client-side).
- **Period comparison change %** matches your live dashboard's −2.1% once Tekmetric returns the full prior-YTD set. Sanity-check after first run.
- **Tech "Efficiency"** uses an 8h/working-day expected denominator. Wire it to actual scheduled hours per tech once a tech-roster endpoint is available (Tekmetric exposes employees; we don't currently fetch their schedules).
- **Period over period deltas** in the Shop Performance table currently compare to the chain mean. Add a second window pull keyed to the previous equal-length period to produce true PoP deltas.
- **Customer fleet classifier name rules** require the Tekmetric `/customers` endpoint. Today we use the vehicle-count rule only. Wire `/customers` and apply the keyword + caps-ratio rules from brief section 6.
- **180-day return rate** is a monthly compute against a longer RO history. Schedule a separate `/api/cron/return-rate-monthly` once Phase 1 backfill is in place.
- **Admin "Edit Goals"** modal is a stub — add a `/api/goals` route with KV storage to persist target close rate, FBR target, and revenue goals per shop.

## Cost notes

- Tekmetric API has no published rate limit but pulls are cached 30 min per shop+window.
- WhatConverts per-shop quota: 5k requests/day default. Each cron run = 8 shops × ~1 page = 8 requests; well within limits.
- Anthropic Haiku 4.5: ~$0.80/MTok input, ~$4/MTok output. Each transcript is ~1.5k tokens. Strict refresh of all 8 shops WTD = ~700 calls × 1.5k = ~1.1M tokens/refresh. ~$1.20/refresh. Three refreshes/day Mon-Fri ≈ $18/week.

## Credentials handling

All API keys live server-side. Nothing in the bundle exposes them. The cookie-based auth gate matches the existing site's behavior. Strongly recommend setting `DASHBOARD_PASSWORD` to something stronger than `mango` before exposing this URL publicly.
