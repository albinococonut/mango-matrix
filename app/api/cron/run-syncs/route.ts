// Single protected endpoint that runs every enabled sync job.
// Triggered every 15 minutes by GitHub Actions (.github/workflows/run-syncs.yml).
//
// Authorization: Bearer ${CRON_SECRET}. Refuses anything else.
//
// We use the Node runtime here (not Edge) because the sync jobs reach into the
// file-cache, the Anthropic SDK, and (when configured) the Postgres pool for
// GBP reviews — none of which run on Edge.

import { NextRequest, NextResponse } from 'next/server';
import { runAllSyncs } from '@/lib/syncJobs';
import { warmReturnCustomersForShop, warmFbrForShop, warmMissedCallbacksForShop, warmDeclinedJobsForShop, backfillWeekMetricsForShop } from '@/lib/syncJobs';
import { SHOPS } from '@/lib/shops';

export const dynamic = 'force-dynamic';
// Raised to 800s via BOTH this export AND vercel.json (without the
// vercel.json entry, the export is silently capped at 300s on Pro).
// The cron sweep has been taking ~5 min for a while and frequently
// 504-ing right at the boundary — that's what was filling Jessica's
// inbox with GH Actions failure emails for weeks.
export const maxDuration = 800;

function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  // Optional out-of-band admin secret. Lets an operator manually re-run the
  // syncs (e.g. to seed a cold cache or replay after a failed scheduled tick)
  // without exposing or rotating the CRON_SECRET the GitHub Actions schedule
  // depends on. Either secret authorizes the request via the same path.
  const adminExpected = process.env.CRON_SECRET_ADMIN;
  if (!expected && !adminExpected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured on the server' }, { status: 500 });
  }
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const okPrimary = !!expected && !!token && constEq(token, expected);
  const okAdmin = !!adminExpected && !!token && constEq(token, adminExpected);
  if (!okPrimary && !okAdmin) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Targeted-job mode: ?job=warm-return-customers[&shop=NNN|all]
  //
  // Lets an operator seed or refresh just the return-customers cache without
  // running the full 9-job sweep (which can take ~5 min and risks timing out
  // before the slow jobs complete). Useful for cold-start warms after a
  // schema change.
  const url = req.nextUrl;
  const targetJob = url.searchParams.get('job');

  // Backfill mode: ?job=backfill-week-metrics&week=YYYY-MM-DD&shop=NNN|all
  // Recomputes a PAST week's Re-Book % + Call-Conversion % per shop and merges
  // into that week's metric snapshot. One shop per call recommended to stay
  // under the function cap (conversion runs Claude on the week's calls).
  if (targetJob === 'backfill-week-metrics') {
    const week = url.searchParams.get('week');
    if (!week) return NextResponse.json({ error: 'week param required (YYYY-MM-DD, a Monday)' }, { status: 400 });
    const shopParam = url.searchParams.get('shop') || '';
    const shops = shopParam === 'all' || !shopParam ? SHOPS.map(s => s.num) : [shopParam];
    const startedAt = new Date().toISOString();
    const out: Array<{ shop: string; status: 'ok' | 'error'; durationMs: number; message?: string; error?: string }> = [];
    for (const num of shops) {
      const t0 = Date.now();
      try {
        const msg = await backfillWeekMetricsForShop(week, num);
        out.push({ shop: num, status: 'ok', durationMs: Date.now() - t0, message: msg });
      } catch (e: any) {
        out.push({ shop: num, status: 'error', durationMs: Date.now() - t0, error: e?.message || String(e) });
      }
    }
    return NextResponse.json({ startedAt, finishedAt: new Date().toISOString(), mode: 'backfill-week-metrics', week, results: out });
  }

  if (
    targetJob === 'warm-return-customers' ||
    targetJob === 'warm-fbr-leaderboard' ||
    targetJob === 'warm-missed-callbacks' ||
    targetJob === 'warm-declined-jobs'
  ) {
    const shopParam = url.searchParams.get('shop') || '';
    const shops = shopParam === 'all' || !shopParam
      ? SHOPS.map(s => s.num)
      : [shopParam];
    const runner = targetJob === 'warm-return-customers'
      ? warmReturnCustomersForShop
      : targetJob === 'warm-fbr-leaderboard'
        ? warmFbrForShop
        : targetJob === 'warm-missed-callbacks'
          ? warmMissedCallbacksForShop
          : warmDeclinedJobsForShop;
    const startedAt = new Date().toISOString();
    const out: Array<{ shop: string; status: 'ok' | 'error'; durationMs: number; message?: string; error?: string }> = [];
    for (const num of shops) {
      const t0 = Date.now();
      try {
        const msg = await runner(num);
        out.push({ shop: num, status: 'ok', durationMs: Date.now() - t0, message: msg });
      } catch (e: any) {
        out.push({ shop: num, status: 'error', durationMs: Date.now() - t0, error: e?.message || String(e) });
      }
    }
    return NextResponse.json({
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: 'targeted',
      job: targetJob,
      shopsRequested: shops,
      results: out,
    });
  }

  // Job-group filtering so the sweep can be split across multiple GH Actions
  // schedules — Vercel caps this function at 300s regardless of maxDuration
  // settings, so the full ~5min sweep was timing out. We run the light jobs
  // on the main 15-min schedule (?skip=heavy ones) and the two heavy jobs
  // (warm-return-customers ~124s + refresh-booked-rate-strict ~72s) on a
  // separate offset schedule (?only=those two). Each run lands well under 300s.
  const skip = (url.searchParams.get('skip') || '').split(',').map(s => s.trim()).filter(Boolean);
  const only = (url.searchParams.get('only') || '').split(',').map(s => s.trim()).filter(Boolean);

  const startedAt = new Date().toISOString();
  const results = await runAllSyncs({ only, skip });
  const finishedAt = new Date().toISOString();
  const summary = {
    startedAt, finishedAt,
    counts: {
      ok: results.filter(r => r.status === 'ok').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length,
    },
    jobs: results,
  };
  // Log each job result on its own line so the GH Actions log is scannable.
  for (const r of results) {
    const tag = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '·' : '✗';
    const detail = r.message || r.error || '';
    console.log(`[cron] ${tag} ${r.name} (${r.durationMs}ms) ${detail}`);
  }
  // Always 200 with a summary — GH Actions checks individual job statuses in the body.
  return NextResponse.json(summary);
}

// Allow GET for quick browser inspection by developers (still requires Bearer).
export async function GET(req: NextRequest) { return POST(req); }
