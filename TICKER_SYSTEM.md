# Daily Ticker — Operating Spec

The Mango Automotive intranet shows a single scrolling ticker line. That line
comes from this dashboard. A daily Claude job generates it from Matrix data;
executives can override it from `/admin/ticker`. This document is the full
operating logic for the generator, plus the API contract.

## Objective

One line per day that makes people glance at the ticker and feel the pulse of
the company — a real story from yesterday's Matrix data, told with energy.
Recognition first, momentum second, curiosity always. It should read like a
sharp colleague sharing the one thing worth knowing today, not like a report.

## Output requirements

- Exactly **one line** of output. Nothing before it, nothing after it.
- **8–22 words.**
- **At most 1 emoji** (zero is fine).
- **One story per line.** Never combine two stories.
- **No em dashes.**
- **No invented data.** Every number and name must come from the Matrix
  context. If a number isn't in the data, don't use a number.
- **No metric lists.** Never string together stats ("Revenue $X, GP Y%, ARO
  $Z"). Pick one fact and make it mean something.
- **Don't repeat structure on consecutive days.** If yesterday's line was
  "Shop X did Y", today's must be shaped differently.

## Step 1 — Read the Matrix

Fetch the generation context (see API below). It contains:

- `recent` — the last 14 published ticker lines (repetition memory).
- `override` — the currently active admin override, or null.
- `trophyTail` — the last 4 weeks of trophy rankings (revenue, gp, tech,
  comebacks) across the 8 shops.
- `generatedAt` — server timestamp.

Read it all before writing anything. The line must be grounded in this data.

## Step 2 — Pick the story (candidate priority order)

Evaluate candidates top-down; the first strong one wins:

1. **Urgent/emergency company message** (only when explicitly provided —
   never inferred from metrics).
2. **A shop or person doing something exceptional** — a first-ever win, a
   streak extended, a category flipped from last place toward the top.
3. **A meaningful trend** — three-plus weeks of climbing in a trophy
   category, a chain-wide movement.
4. **A tight race** — two shops trading a trophy category back and forth.
5. **A comeback story** — a shop that was last in a category now mid-pack or
   better.
6. **A steady-excellence note** — a shop quietly holding #1 for weeks.
7. **Culture/curiosity filler** — only when the data genuinely offers
   nothing; still must be true and company-relevant.

## Non-Matrix messages

The ticker can also carry non-metric company messages (events, announcements,
recognition submitted by leadership). These arrive **only** via the admin
override — the generator never invents events, dates, or announcements.
Priority labels, highest to lowest urgency:

1. `Emergency`
2. `Leadership Announcement`
3. `Event`
4. `Recognition`
5. `Company News`

An active override always outranks the generated line regardless of priority;
the priority label exists for the intranet to style the strip (e.g. red for
Emergency) and for audit context.

## The seven styles

Rotate deliberately between these. Example patterns are shapes, not templates
to fill verbatim.

1. **Recognition** — name the shop/person and the achievement.
   *"Shop 005 just took the GP trophy for the third straight week 🏆"*
2. **Coaching** — one actionable nudge framed positively, never scolding.
   *"Rebook calls before 10am land twice as often. Early birds win."*
3. **Competition** — frame a race, invite shops to watch the standings.
   *"Two weeks running, 002 and 005 have swapped the revenue crown. Round three starts today."*
4. **Financial impact** — make one number tangible.
   *"Yesterday's recovered declined jobs paid for a technician's whole week."*
5. **Momentum** — direction over position.
   *"Shop 007 has climbed the tech board three weeks straight. Watch this space."*
6. **Curiosity** — open a loop that the dashboard closes.
   *"One shop just did something no shop has done all year. Check the Matrix."*
7. **Culture** — values, gratitude, shared identity.
   *"Eight shops, one standard: fix it right, treat them right."*

## Data-quality rules

- Only use numbers present in the fetched context. Never extrapolate,
  estimate, or "round up" into a claim the data doesn't make.
- If the trophy tail is missing or partial, fall back to styles that need no
  numbers (culture, curiosity, coaching) rather than guessing.
- Never name a person unless the data names them.
- Treat week-over-week movement as real only when the weeks are actually
  adjacent in the data.

## Repetition rules

- The system **stores the last 14 lines** (`recent` in the context). Read
  them every run.
- **No same topic more than 2 days in a row** unless genuinely urgent.
- **No same opening phrase within 7 days.** If four of the last seven lines
  start with "Shop", today's line starts differently.
- Don't reuse yesterday's structure (see output requirements).

## Tone

Energetic, specific, human. Confidence without hype. Coaching lines lift,
never shame.

- Bad: *"Call conversion was 61% yesterday, below the 75% target. Needs
  improvement."* (report-speak, negative framing, metric-first)
- Good: *"6 of 10 callers booked yesterday. Every extra yes this week is
  pure momentum 📈."* (same fact, human framing, forward-looking)

## Internal scoring model

Before writing, score each candidate story 1–5 on:

- **Freshness** — is this new information versus the last 14 lines?
- **Specificity** — does it name a shop/person/number the reader can verify?
- **Emotional pull** — pride, competition, curiosity, or gratitude?
- **Actionability** — does it invite the reader to do or check something?

Write the line for the highest-scoring story. On a tie, prefer the story
that uses a style not used in the last 3 days. Score the drafted line once
more against the output requirements before publishing; if it fails any hard
rule (word count, one story, no invented data), rewrite.

## Admin override precedence

- An **active override always wins**: enabled, and now is within
  `[starts_at, ends_at]` (null bounds are open-ended).
- The override message is displayed **verbatim — never rewritten,
  summarized, or "improved"** by the generator or the API.
- When the override is disabled or expires, the automatic daily ticker
  resumes immediately (latest `ticker_history` row).
- The daily job still runs and still publishes its line while an override is
  active — the line simply isn't displayed until the override ends.

## Output

Exactly one line. Publish it via the API below.

---

# API contract

Base URL: `https://mango-matrix.vercel.app` (also reachable at the
`matrix.mangoautomotive.com` domain if configured). All ticker endpoints
live at `/api/ticker` (single route file, all methods).

> **Storage (2026-07-28):** ticker data lives in the dashboard's existing
> **Upstash Redis** (the same KV used for all server-side caching) — key
> `mango:ticker:override` (JSON override row) and `mango:ticker:history`
> (JSON array, up to 50 lines, newest first). No Postgres involved;
> `db/migrations/002_ticker.sql` is kept as documentation only. If the
> Redis env vars (`KV_REST_API_URL`/`KV_REST_API_TOKEN`) are ever missing,
> the public GET returns `{"text": null, "source": "none"}` and
> POST/PUT/override-GET return **501**. Production has them configured, so
> the system is live today.

## GET /api/ticker (public, CORS `*`)

What the intranet polls. No auth.

```json
{ "text": "Shop 005 just took the GP trophy again 🏆", "source": "auto" }
```

- `source`: `"override"` (admin message, includes `"priority"`), `"auto"`
  (daily generated line), or `"none"` (nothing to show; `text` is null).
- `OPTIONS /api/ticker` answers CORS preflight.

## GET /api/ticker?context=1 (daily job; Bearer secret)

Header: `Authorization: Bearer <TICKER_CRON_SECRET>`. Wrong/missing → 403.

```json
{
  "recent": [ { "id": 12, "text": "...", "topic": "...", "source": "auto", "created_at": "..." } ],
  "override": null,
  "trophyTail": [ { "weekStart": "2026-05-04", "rankings": { "revenue": ["..."], "gp": ["..."], "tech": ["..."], "comebacks": ["..."] } } ],
  "generatedAt": "2026-07-28T12:00:00.000Z",
  "storeConfigured": true
}
```

`recent` = last 14 lines (newest first); `override` = the currently ACTIVE
override or null; `trophyTail` = last 4 weeks from `data/trophyHistory.json`.

## POST /api/ticker (daily job; Bearer secret)

Header: `Authorization: Bearer <TICKER_CRON_SECRET>`.
Body: `{ "text": "<the line>", "topic": "<short label, optional>" }`.

Validation: non-empty, single line, ≤ 280 chars. Stored in `ticker_history`
with `source: "auto"`. Returns `{ ok: true, row }`.

## PUT /api/ticker (admin UI; executive session cookie)

Body: `{ enabled, message, priority, starts_at, ends_at }` — upserts the
single `ticker_override` row (id=1), stamping `updated_by` with the
executive's email. `priority` must be one of the five labels above.
Timestamps are ISO strings or null. Used by `/admin/ticker`.

`GET /api/ticker?override=1` (executive session) returns the raw override
row for the admin form.

## Daily job flow

1. `GET /api/ticker?context=1` with the bearer secret.
2. Generate the line following every rule in this spec (read `recent` for
   repetition, `trophyTail` for stories, respect the override rules).
3. `POST /api/ticker` with the bearer secret and `{text, topic}`.

The secret lives in the Vercel env var `TICKER_CRON_SECRET` (production).
