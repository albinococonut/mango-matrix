# Mango Matrix ↔ Mango Intranet integration contract

Two Claude Code instances work on Jesse's Mango Automotive systems:

- **The Matrix instance (you)** — this repo, `/Users/theminiqueenbook/mango-dashboard`.
  Next.js 14, deployed to Vercel with `npx vercel@latest --cwd /Users/theminiqueenbook/mango-dashboard --prod --yes`.
  Live at https://matrix.mangoautomotive.com (also mango-matrix.vercel.app).
- **The Intranet instance** — `/Users/theminiqueenbook/Desktop/MangoIntranet`.
  Static HTML on GitHub Pages (deploys on push to main). Live at
  https://intranet.mangoautomotive.com. Pages: `/` (portal), `/kudos/`, `/university/`.

Jesse is non-technical and relays messages between instances. When you change
anything listed under "Shared contracts," say so explicitly in your reply so
Jesse can relay it to the intranet instance (and vice versa).

## Shared contracts — do not break without coordinating

### 1. Public ticker API (the intranet reads this on every page load)

`GET https://matrix.mangoautomotive.com/api/ticker`
→ `200 {"text": string|null, "source": "override"|"auto"|"none"}` with
`Access-Control-Allow-Origin: *`.

The intranet homepage fetches this client-side and scrolls `text` in its
bottom ticker (falling back to a legacy Cloudflare Worker feed, then built-in
messages, when `text` is null). Renaming the route, changing the response
shape, removing CORS, or re-gating it behind the auth middleware breaks the
intranet ticker silently.

### 2. Ticker write API (a scheduled Claude task on this Mac posts daily)

- `POST /api/ticker` with `Authorization: Bearer <TICKER_CRON_SECRET>` and
  body `{"text": "...", "topic": "..."}` — publishes the day's line.
- `GET /api/ticker?context=1` with the same bearer — returns the generation
  context used to compose the daily ticker line. Full response shape:

  ```json
  {
    "recent":          [...],          // last 14 auto-generated lines
    "override":        {...}|null,     // active admin override row
    "shopNames":       {"001":"Cottonwood", ...},
    "generatedAt":     "ISO",
    "storeConfigured": true,

    // Live golden-mango data (null until first legitimate Friday crown fires)
    "currentStandings": {
      "periodStart": "ISO",            // Friday boundary of the crowned week
      "revenue":    ["001","003",...], // shopNums ranked best → worst
      "gp":         ["001","003",...],
      "tech":       ["001","003",...],
      "comebacks":  ["001","003",...], // ASC: fewest comebacks = best
      "overall":    ["001","003",...]  // ranked by total score
    },
    "goldenMango": {
      "shopNum":       "001",
      "shopName":      "Cottonwood",
      "defendingSince": "ISO",         // when this shop's current streak began
      "isTie":         false,
      "tiedShopNames": ["Cottonwood"]
    },

    // Last ≤4 weekly trophies from Redis (populates going forward from each Friday crown)
    "trophyTail": [
      {
        "weekStart":   "YYYY-MM-DD",   // Monday of the crowned week
        "periodStart": "ISO",
        "champion":    "001",
        "rankings": {
          "revenue":   ["001",...],
          "gp":        ["001",...],
          "tech":      ["001",...],
          "comebacks": ["001",...]
        }
      }
    ]
  }
  ```

  `trophyTail` is the live Redis store — it was previously a slice of the
  static `data/trophyHistory.json` file (last entry 2026-05-11). It will be
  empty until the next Friday crown writes to Redis, then accumulate up to 4
  entries going forward.
- The secret lives in Vercel prod env `TICKER_CRON_SECRET` and locally in
  `.env.ticker.local` (gitignored) in this repo. The scheduled task
  (`mango-matrix-daily-ticker`, 6:30 AM daily, managed by the intranet
  instance's session) reads the local file. If you rotate the secret, update
  BOTH places.

### 3. Admin override

`/admin/ticker` (executive role) manages the override stored in Upstash Redis
key `ticker:override`; history in `ticker:history` (see `lib/ticker.ts`,
`TICKER_SYSTEM.md`). An active override is displayed verbatim and always wins
over the generated line. Don't repurpose those Redis keys.

### 4. Design language

The intranet was restyled to match this app's "luxury" diagnostic look:
body `#FBF7F0`, inner layer `#FBFAF8`, the four fixed blurred orbs
(blue/gold/amber/teal), glass cards (26px, white gradient, blur 22px),
Fraunces + Inter, kicker labels `#938C81`, accent `#E8863E`/`#B5631F`,
dot-pill badges, 160deg watercolor highlight boxes. If the Matrix design
system changes materially, flag it so the intranet can follow.

### 5. Shop number → name mapping

Canonical mapping (source of truth: `lib/shops.ts`):

| # | Name | City | State |
|---|------|------|-------|
| 001 | Cottonwood | Albuquerque | NM |
| 002 | The Heights | Albuquerque | NM |
| 003 | Downtown | Albuquerque | NM |
| 004 | Pellicano | El Paso | TX |
| 005 | Las Cruces | Las Cruces | NM |
| 006 | Yuma | Yuma | AZ |
| 007 | Montana | El Paso | TX |
| 009 | The Valley | Albuquerque | NM |

008 does not exist. The `?context=1` response now includes a `shopNames`
object (`{"001":"Cottonwood", ...}`) so the generator never has to guess.

## Nice-to-haves the Matrix instance may build when asked

- Richer `?context=1` payload (revenue/GP pacing, call conversion, rebook,
  reviews) so daily tickers can use more of TICKER_SYSTEM.md's story types.
  Keep it additive — never remove existing fields.
- A "post to ticker" quick action on the admin page that writes a one-off
  line into history (source `manual`) without enabling a standing override.

## Facts both instances rely on

- DNS for mangoautomotive.com lives in Squarespace (Google-nameserver zone).
  intranet CNAME → albinococonut.github.io; matrix → Vercel. Squarespace DNS
  edits require Jesse to complete a Google re-verification popup.
- The intranet's Matrix tile links to https://matrix.mangoautomotive.com and
  uses a static copy of this app's favicon (no live dependency).
