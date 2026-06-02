// Accounts Receivable (executive-only; route wrapper does the role check).
//
// Current open AR (KPIs + customer table) is range-independent and is stored
// durably per mode as `ar_current_<mode>`, rewritten ONCE DAILY by the
// after-close cron. The request path serves that durable value instantly and
// never cold-pulls the YTD RO window. The chart's date range scopes ONLY the
// trend, which is built from the permanent daily snapshots (Tekmetric exposes
// no historical AR, so we retain one snapshot per day forever).

import { NextRequest, NextResponse } from 'next/server';
import { customRange, TEKMETRIC_REPORT_TZ } from '@/lib/dates';
import { rosForChainCached, rosForChain } from '@/lib/dataAccess';
import type { RepairOrder } from '@/lib/tekmetric';
import { readCache, writeCache, isFresh } from '@/lib/cache';
import {
  ARMode, readSnapshots, currentARFromRos, AR_CURRENT_KEY, CurrentAR,
} from '@/lib/ar';
import { toZonedTime } from 'date-fns-tz';

// A missed daily cron (or a fresh deploy) self-heals: stale durable value is
// served instantly while a background refresh repopulates it.
const CURRENT_STALE_MS = 26 * 60 * 60 * 1000;

function ytdStart(now: Date): string {
  return `${now.getFullYear()}-01-01`;
}

// Open A/R can include invoices billed well before this calendar year. Pulling
// only YTD silently dropped aged receivables (confirmed: ~$26k of still-unpaid
// 2025 invoices were invisible). Use a trailing 24-month lookback so aged AR
// is captured; anything >12 months old is flagged `aged` for the UI to label.
const AR_LOOKBACK_MONTHS = 24;
function arLookbackStart(today: string): string {
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - AR_LOOKBACK_MONTHS);
  return d.toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Pull the YTD RO window (cache-first, live only as a last resort) and derive
// current AR. Used ONLY to bootstrap the durable key the first time / when a
// daily cron has been missed — steady state is the after-close cron.
async function computeCurrentAR(mode: ARMode, today: string): Promise<CurrentAR> {
  const lookStart = arLookbackStart(today); // trailing 24 months
  const endYmds = [today, addDaysYmd(today, 1), addDaysYmd(today, -1), addDaysYmd(today, 2)];
  let ros: RepairOrder[] = [];
  for (const ey of endYmds) {
    const w = customRange(lookStart, ey);
    const r = await rosForChainCached({ startISO: w.startISO, endISO: w.endISO });
    // Require ALL shops' windows to be cached — accepting a partial hit
    // silently undercounts AR (one shop hits → ros = that one shop only).
    if (r.hits === r.total) { ros = r.ros; break; }
  }
  if (ros.length === 0) {
    const w = customRange(lookStart, today);
    ros = await rosForChain({ startISO: w.startISO, endISO: w.endISO });
  }
  return currentARFromRos(ros, mode);
}

const refreshing: Record<string, boolean> = {};
function refreshCurrentInBackground(mode: ARMode, today: string) {
  if (refreshing[mode]) return;
  refreshing[mode] = true;
  (async () => {
    try {
      await writeCache(AR_CURRENT_KEY(mode), await computeCurrentAR(mode, today));
    } catch (e) {
      console.error('[ar] background current refresh failed:', (e as any)?.message);
    } finally {
      refreshing[mode] = false;
    }
  })().catch(() => { refreshing[mode] = false; });
}

export async function handle(req: NextRequest) {
  const mode = (req.nextUrl.searchParams.get('mode') || 'over30') as ARMode;
  const nowMtn = toZonedTime(new Date(), TEKMETRIC_REPORT_TZ);
  const today = nowMtn.toISOString().slice(0, 10);
  const tStart = req.nextUrl.searchParams.get('start') || ytdStart(nowMtn);
  const tEnd = req.nextUrl.searchParams.get('end') || today;

  const curKey = AR_CURRENT_KEY(mode);
  let current = await readCache<CurrentAR>(curKey);
  if (!current) {
    // KV was evicted (Upstash free tier) or this is a fresh deploy.
    // Doing the 24-month Tekmetric pull inline exceeds maxDuration and the
    // function returns Vercel's HTML error page ("An error occurred...") —
    // which the client can't JSON.parse, so A/R shows $0 with a diagnostic
    // banner. Instead: fire the bootstrap in the background and serve an
    // empty "warming" payload now. The next page poll picks up the real
    // value once the warm finishes (typically ~20-40s for 24mo × 8 shops).
    refreshCurrentInBackground(mode, today);
    return NextResponse.json({
      mode,
      generatedAt: new Date().toISOString(),
      asOf: today,
      refreshedAt: null,
      range: { start: tStart, end: tEnd },
      summary: { total: 0, count: 0, byShop: [] },
      liveTotals: { total: 0, over30: 0, new: 0 },
      agedTotal: 0,
      customers: [],
      trend: { real: [], points: 0, firstSnapshot: today },
      namesResolved: 0,
      warming: true,
      note: 'A/R cache is rebuilding in the background (Upstash eviction recovery). Refresh in ~30s.',
    });
  } else if (!(await isFresh(curKey, CURRENT_STALE_MS))) {
    // Daily cron missed — serve the durable value now, self-heal in the bg.
    refreshCurrentInBackground(mode, today);
  }

  // Trend = real daily snapshots only (cheap). The date range scopes the
  // CHART, never the live totals.
  const snaps = (await readSnapshots()).filter((s) => s.date >= tStart && s.date <= tEnd);
  const snapDates = new Set(snaps.map((s) => s.date));
  const liveTotals = current.liveTotals;
  const real = [
    ...snaps.map((s) => ({ date: s.date, total: s.total, over30: s.over30, new: s.new })),
    ...(snapDates.has(today) || today < tStart || today > tEnd ? [] : [{ date: today, ...liveTotals }]),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    mode,
    generatedAt: new Date().toISOString(),
    asOf: today,
    refreshedAt: current.computedAt,
    range: { start: tStart, end: tEnd },
    summary: current.summary,
    liveTotals,
    agedTotal: current.agedTotal,
    customers: current.customers,
    trend: { real, points: real.length, firstSnapshot: real[0]?.date || today },
    namesResolved: current.namesResolved,
    note: 'Current A/R is captured once daily after close and stored durably; each day is retained as a permanent snapshot (Tekmetric exposes no historical AR). The date range scopes only the trend chart, not the live totals.',
  });
}
