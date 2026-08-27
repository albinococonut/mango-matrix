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
import { warmReturnCustomersForShop, warmFbrForShop, warmMissedCallbacksForShop, warmDeclinedJobsForShop, backfillWeekMetricsForShop, warmPartsMatrixRange, warmCallRecordingsForShop, prefetchCallLog } from '@/lib/syncJobs';
import { SHOPS } from '@/lib/shops';
import { takeWeeklySnapshot, checkWeeklyDrift, currentSnapshotWeekStart } from '@/lib/weeklySnapshot';
import { warmSalesEffectivenessForShop, SE_SHOP_CACHE_KEY } from '@/lib/salesEffectiveness';
import { computeAndCacheNewCustomers } from '@/lib/marketingNewCustomers';
import { computeAndCacheAttribution, computeAndCacheAttributionForShop, aggregateAttributionShops } from '@/lib/marketingAttribution';
import { readCache } from '@/lib/cache';

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

  // warm-sales-effectiveness: auto-picks the stalest shop (or ?shop=NNN for a specific one).
  // One shop per cron tick — keeps RC rate limits safe. The GH Actions schedule calls
  // this every 30 min; all 8 shops cycle through in ~4 hours.
  if (targetJob === 'warm-sales-effectiveness') {
    const shopParam = url.searchParams.get('shop') || '';
    let shopNum: string;
    if (shopParam && shopParam !== 'auto') {
      shopNum = shopParam;
    } else {
      // Pick the shop with the oldest SE cache (or no cache)
      const ages = await Promise.all(
        SHOPS.map(async s => {
          const c = await readCache<{ computedAt?: string }>(SE_SHOP_CACHE_KEY(s.num));
          const ts = c?.computedAt ? new Date(c.computedAt).getTime() : 0;
          return { num: s.num, ts };
        })
      );
      shopNum = ages.sort((a, b) => a.ts - b.ts)[0].num;
    }
    const t0 = Date.now();
    try {
      const msg = await warmSalesEffectivenessForShop(shopNum);
      return NextResponse.json({ job: 'warm-sales-effectiveness', status: 'ok', shop: shopNum, durationMs: Date.now() - t0, message: msg });
    } catch (e: any) {
      const errMsg: string = e?.message || String(e);
      // RC CMN-301 rate limit — transient, next tick will retry. Return 200 so
      // GH Actions doesn't spam failure emails for a recoverable condition.
      if (errMsg.includes('CMN-301') || errMsg.includes('Request rate exceeded')) {
        return NextResponse.json({ job: 'warm-sales-effectiveness', status: 'rate-limited', shop: shopNum, durationMs: Date.now() - t0, message: 'RC rate limited — will retry next tick' });
      }
      return NextResponse.json({ job: 'warm-sales-effectiveness', status: 'error', shop: shopNum, durationMs: Date.now() - t0, error: errMsg }, { status: 500 });
    }
  }

  if (targetJob === 'warm-call-recordings') {
    const shopParam = url.searchParams.get('shop') || '';
    const shops = shopParam === 'all' || !shopParam ? SHOPS.map(s => s.num) : [shopParam];
    const startedAt = new Date().toISOString();
    // Pre-fetch the RC call log once so all shops share the cache hit.
    // This avoids a thundering herd of 8 shops all hitting RC simultaneously.
    await prefetchCallLog();
    // Run all shops concurrently — they all hit the warm cache now.
    const settled = await Promise.allSettled(
      shops.map(async (num) => {
        const t0 = Date.now();
        const msg = await warmCallRecordingsForShop(num);
        return { shop: num, status: 'ok' as const, durationMs: Date.now() - t0, message: msg };
      })
    );
    const out = settled.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { shop: shops[i], status: 'error' as const, durationMs: 0, error: (r.reason as any)?.message || String(r.reason) }
    );
    return NextResponse.json({ startedAt, finishedAt: new Date().toISOString(), mode: 'targeted', job: targetJob, results: out });
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

  // warm-marketing-new-customers: full Tekmetric RO pull to compute first-visit months.
  // Runs rarely (daily from GH Actions) — not part of the 15-min sweep.
  if (targetJob === 'warm-marketing-new-customers') {
    const t0 = Date.now();
    try {
      const rows = await computeAndCacheNewCustomers();
      return NextResponse.json({ job: targetJob, status: 'ok', rows: rows.length, durationMs: Date.now() - t0 });
    } catch (e: any) {
      return NextResponse.json({ job: targetJob, status: 'error', durationMs: Date.now() - t0, error: e?.message || String(e) }, { status: 500 });
    }
  }

  // warm-marketing-attribution: WC call history → dedup by phone → TM lookup → RO revenue.
  // ?shop=NNN   process one shop and write a partial cache (used by per-shop workflow)
  // ?shop=aggregate  merge all partial caches into the final attribution key
  // (no ?shop param)  process all shops sequentially (legacy / manual dispatch)
  if (targetJob === 'warm-marketing-attribution') {
    const t0 = Date.now();
    const shopParam = url.searchParams.get('shop') || '';
    try {
      if (shopParam === 'aggregate') {
        const cache = await aggregateAttributionShops();
        return NextResponse.json({ job: targetJob, status: 'ok', mode: 'aggregate', callers: cache.callers.length, summaryRows: cache.summary.length, durationMs: Date.now() - t0 });
      }
      if (shopParam && shopParam !== 'all') {
        const result = await computeAndCacheAttributionForShop(shopParam);
        return NextResponse.json({ job: targetJob, status: 'ok', mode: 'shop', shop: shopParam, callers: result.callers, durationMs: Date.now() - t0 });
      }
      const cache = await computeAndCacheAttribution();
      return NextResponse.json({ job: targetJob, status: 'ok', mode: 'all', callers: cache.callers.length, summaryRows: cache.summary.length, durationMs: Date.now() - t0 });
    } catch (e: any) {
      return NextResponse.json({ job: targetJob, status: 'error', durationMs: Date.now() - t0, error: e?.message || String(e) }, { status: 500 });
    }
  }

  // ── Weekly snapshot (take) ────────────────────────────────────────────────
  // Called by run-weekly-audit.yml every Friday at ~7 PM MT.
  if (targetJob === 'take-weekly-snapshot') {
    const weekParam = url.searchParams.get('week');
    const weekStart = weekParam || currentSnapshotWeekStart();
    try {
      const snap = await takeWeeklySnapshot(weekStart);
      return NextResponse.json({
        job: 'take-weekly-snapshot', status: 'ok', weekStart,
        snappedAt: snap.snappedAt,
        chainRevenue: snap.chainRevenue,
        roCount: snap.ros.length,
      });
    } catch (e: any) {
      return NextResponse.json({ job: 'take-weekly-snapshot', status: 'error', weekStart, error: e?.message || String(e) }, { status: 500 });
    }
  }

  // ── Weekly drift check ────────────────────────────────────────────────────
  // Called by run-weekly-audit.yml every day at noon MT.
  if (targetJob === 'check-weekly-drift') {
    const weekParam = url.searchParams.get('week');
    const weekStart = weekParam || currentSnapshotWeekStart();
    try {
      const report = await checkWeeklyDrift(weekStart);
      if (!report) {
        return NextResponse.json({ job: 'check-weekly-drift', status: 'ok', weekStart, message: 'No snapshot found for this week — nothing to compare.' });
      }
      return NextResponse.json({
        job: 'check-weekly-drift', status: 'ok', weekStart,
        checkedAt: report.checkedAt,
        chainDelta: report.chainDelta,
        diffCount: report.diffs.length,
        diffs: report.diffs,
      });
    } catch (e: any) {
      return NextResponse.json({ job: 'check-weekly-drift', status: 'error', weekStart, error: e?.message || String(e) }, { status: 500 });
    }
  }

  // Targeted parts-matrix warm: ?job=warm-parts-matrix[&start=YYYY-MM-DD&end=YYYY-MM-DD&mode=all]
  // Useful for seeding a cold cache or warming a custom date range without
  // running the full sweep. The scheduled cron also runs this automatically via JOBS.
  if (targetJob === 'warm-parts-matrix') {
    const now = new Date();
    const endParam  = url.searchParams.get('end')   || now.toISOString().slice(0, 10);
    // Default start = Monday of current week so the warmed key matches the page's
    // default "this_week" range. Using today-6 was a persistent cache miss since
    // the page always requests Monday-to-today, not a rolling 7-day window.
    const dow = now.getUTCDay() || 7; // 1=Mon … 7=Sun
    const monDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1 - dow));
    const startParam = url.searchParams.get('start') || monDate.toISOString().slice(0, 10);
    const modeParam  = url.searchParams.get('mode')  || 'all';
    try {
      const msg = await warmPartsMatrixRange(startParam, endParam, modeParam);
      return NextResponse.json({ job: 'warm-parts-matrix', status: 'ok', message: msg });
    } catch (e: any) {
      const errMsg: string = e?.message || String(e);
      // Always return 200 — the warm job is best-effort. Any error (429, timeout,
      // ECONNRESET, etc.) is transient; the next GH Actions tick will retry.
      // Returning 500 here caused GH Actions to fail and send failure emails.
      const isRateLimit = errMsg.includes('429') || errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('aborted');
      return NextResponse.json({
        job: 'warm-parts-matrix',
        status: isRateLimit ? 'rate-limited' : 'error',
        message: `Warm job failed (will retry next tick): ${errMsg.slice(0, 200)}`,
      });
    }
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
