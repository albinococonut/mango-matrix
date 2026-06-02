# Mango Matrix — notes for Claude

This is the **Mango Matrix** dashboard (Next.js 14 App Router) for Mango
Automotive — an 8-shop automotive repair chain. Live at
<https://mango-matrix.vercel.app>.

## ⚠ Critical: working-directory drift

The session's default shell cwd is `/Users/theminiqueenbook/Desktop/Pink Pill`
(an unrelated project), not this directory. Bash cwd is **not reliably
persistent** in this sandbox — commands that depend on cwd will sometimes
land back in Pink Pill and produce wrong results.

**The two consequences seen in prior sessions:**

1. `npx vercel --prod` runs from the Pink Pill directory and deploys to the
   wrong Vercel project (`pink-pill-…vercel.app`) instead of mango-matrix.
2. `npx tsc --noEmit` runs against the wrong `tsconfig.json` and either
   silently typechecks the wrong project or reports zero errors against
   nothing.

**Always use absolute paths or explicit `--cwd` flags. Never rely on shell
cwd to be the mango-dashboard root.**

### Standard deploy command (use exactly this)

```bash
npx vercel@latest --cwd /Users/theminiqueenbook/mango-dashboard --prod --yes
```

### Standard typecheck command

```bash
npx tsc --noEmit --project /Users/theminiqueenbook/mango-dashboard/tsconfig.json
```

### Other shell commands

If a command must be run from this project's root (e.g. `npm install`),
prefix with the absolute `cd`:

```bash
cd /Users/theminiqueenbook/mango-dashboard && <command>
```

Read/Edit/Write tools take absolute paths and are unaffected by cwd — only
Bash needs this discipline.

## Deployment workflow

This project DOES use git internally for history but Vercel deploys are
triggered via the CLI, not git push. After every code change, deploy to
production with the deploy command above.

Always deploy after editing code, even for small changes — the user is
non-technical and won't think to do it themselves.

## Live site

- Production: <https://mango-matrix.vercel.app>
- Vercel project: `mango-matrix` under team `jannepacific-6328s-projects`

## Architecture (high-level)

- Next.js 14.2 App Router (sync `cookies()`, not async)
- Upstash Redis (KV) for all server-side caching — NOT Postgres. Any code
  that imports `lib/db.ts` is dead scaffolding; ignore it.
- GitHub Actions cron at `*/15 * * * *` hits `/api/cron/run-syncs` with a
  Bearer token. Sync jobs are round-robin (one shop per tick).
- Tekmetric (8 shops, primary + Yuma secondary) + WhatConverts (per-shop
  WHATCONVERTS_NNN keys) + Anthropic (Claude Haiku for call classification +
  salvageability scoring) are the three external data sources.
- Auth is a single signed cookie (`mango_session`) carrying `role` =
  `employee` | `executive`. Routes verify via `verifyRoleCookie` from
  `@/lib/auth`. `cookies()` is sync — do NOT `await cookies()`.

## Working with the user

- Non-technical. Default to click-by-click instructions, never raw commands.
- Cannot edit Vercel env vars or Google Cloud Console without explicit
  guidance.
- Expects Claude to handle code edits AND prod deploys without being
  asked.
- The Pink Pill project (different codebase, different Vercel app) lives at
  `/Users/theminiqueenbook/Desktop/Pink Pill`. If you see references to
  Pink Pill or Supabase `pledges` table, that's the OTHER project — don't
  mix them up.
