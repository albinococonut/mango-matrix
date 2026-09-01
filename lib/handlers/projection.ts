// Revenue Projection handler (executive-only; route wrapper does the role
// check). Builds an INDEPENDENT projection per shop, then rolls shops up into
// districts and a portfolio total. Heavy inputs (20-week history) are cached
// separately from the per-period payload so changing the period is cheap.

import { NextRequest, NextResponse } from 'next/server';
import { customRange, resolveRange, RangeKey, TEKMETRIC_REPORT_TZ } from '@/lib/dates';
import { rosForChainCached, rosForChain } from '@/lib/dataAccess';
import { Appointment } from '@/lib/tekmetric';
import { chainKpi, isCountedRO } from '@/lib/metrics';
import { SHOPS, SHOP_BY_TEKMETRIC_ID, DISTRICTS, isRampingShop, ShopNum } from '@/lib/shops';
import { DEFAULT_GOALS, workingDaysBetween, isWorkingDay } from '@/lib/goals';
import { weeklyShopHistory, weeklyHistoryFromHeatmapCache, WeeklyHistory } from '@/lib/forecast/history';
import { computeDowProfile, weekRevenueElapsed, DowProfile } from '@/lib/forecast/dow';
import { projectShop, rollUp, backtestShop, PeriodSpec, ShopProjection } from '@/lib/forecast/engine';
import { projectV2, capPerJobAndSum, detectCheckpoint, V2Input } from '@/lib/forecast/engineV2';
import { readSettledWeeks } from '@/lib/reconcile';
import { holidayFactors } from '@/lib/holidays';
import { writeProjectionLog, logWriteEnabled, modelV2Enabled, ProjectionLog } from '@/lib/learningStore';
import { readBiasCorrection } from '@/lib/projBias';
import { readBandMultiplier } from '@/lib/projCalibration';
import { readCache, writeCache, isFresh, cacheUpdatedAt } from '@/lib/cache';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter,
  startOfDay, endOfDay, addWeeks, addMonths,
} from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const HISTORY_WEEKS = 20;
const HISTORY_FRESH_MS = 12 * 60 * 60 * 1000; // weekly history changes slowly
const PAYLOAD_FRESH_MS = 30 * 60 * 1000;

// Per-shop appointments for the current week — CACHE-ONLY on the request
// path. The dashboard must never fan out into 8 live Tekmetric fetches; only
// the `warm-projection-appts` background cron writes this cache (round-robin
// one shop per tick). Stale-while-revalidate: stale data still served with a
// freshness flag; missing/expired cache returns null so callers degrade
// gracefully (bookedAppts=null) rather than fabricating 0.
const APPTS_STALE_AFTER_MS = 2 * 60 * 60 * 1000;     // 2h: still served, flagged stale
const APPTS_EXPIRED_AFTER_MS = 8 * 60 * 60 * 1000;   // 8h: drop, return null
type ApptsFreshness = 'fresh' | 'stale' | 'missing';
interface ApptsResult { appts: Appointment[]; freshness: ApptsFreshness; ageMs: number | null }
async function getApptsForWeekCached(shopId: number, weekStartMt: Date): Promise<ApptsResult> {
  const wkYmd = weekStartMt.toISOString().slice(0, 10);
  const cacheKey = `proj_appts_${shopId}_${wkYmd}`;
  const updatedAt = await cacheUpdatedAt(cacheKey);
  if (updatedAt == null) return { appts: [], freshness: 'missing', ageMs: null };
  const ageMs = Date.now() - updatedAt;
  if (ageMs > APPTS_EXPIRED_AFTER_MS) return { appts: [], freshness: 'missing', ageMs };
  const appts = (await readCache<Appointment[]>(cacheKey)) || [];
  return { appts, ageMs, freshness: ageMs > APPTS_STALE_AFTER_MS ? 'stale' : 'fresh' };
}

// Per-shop 80th-percentile authorized-job-subtotal cap (data/proj_job_caps.json).
// Loaded once per process; missing file → no effective cap (Infinity), with a warning.
let _jobCapsMemo: Record<string, number> | null = null;
function loadJobCaps(): Record<string, number> {
  if (_jobCapsMemo) return _jobCapsMemo;
  try {
    const p = path.join(process.cwd(), 'data', 'proj_job_caps.json');
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      _jobCapsMemo = j.caps || {};
      return _jobCapsMemo!;
    }
  } catch (e) { console.warn('[projection] proj_job_caps.json read failed:', (e as any)?.message); }
  console.warn('[projection] data/proj_job_caps.json missing — approved-unbilled per-job cap NOT enforced');
  _jobCapsMemo = {};
  return _jobCapsMemo;
}

type PeriodKey = 'today' | 'this_week' | 'next_week' | 'this_month' | 'next_month' | 'this_quarter' | 'custom';

function fullBounds(key: PeriodKey, now: Date, start?: string, end?: string): { fs: Date; fe: Date; isFuture: boolean } {
  switch (key) {
    case 'today': return { fs: startOfDay(now), fe: endOfDay(now), isFuture: false };
    case 'this_week': return { fs: startOfWeek(now, { weekStartsOn: 1 }), fe: endOfWeek(now, { weekStartsOn: 1 }), isFuture: false };
    case 'next_week': { const n = addWeeks(now, 1); return { fs: startOfWeek(n, { weekStartsOn: 1 }), fe: endOfWeek(n, { weekStartsOn: 1 }), isFuture: true }; }
    case 'this_month': return { fs: startOfMonth(now), fe: endOfMonth(now), isFuture: false };
    case 'next_month': { const n = addMonths(now, 1); return { fs: startOfMonth(n), fe: endOfMonth(n), isFuture: true }; }
    case 'this_quarter': return { fs: startOfQuarter(now), fe: endOfQuarter(now), isFuture: false };
    case 'custom': {
      const fs = start ? startOfDay(new Date(start + 'T12:00:00')) : startOfDay(now);
      const fe = end ? endOfDay(new Date(end + 'T12:00:00')) : endOfDay(now);
      return { fs, fe, isFuture: fs > now };
    }
  }
}

// Debounced background rebuild of the full 20-week history so a request never
// waits on Tekmetric. At most one rebuild in flight; at most every 30 min.
let lastHistoryBuild = 0;
let historyBuilding = false;
function rebuildHistoryInBackground() {
  if (historyBuilding || Date.now() - lastHistoryBuild < 30 * 60 * 1000) return;
  historyBuilding = true;
  (async () => {
    try {
      const h = await weeklyShopHistory(HISTORY_WEEKS);
      await writeCache('proj_history_20w', h);
      lastHistoryBuild = Date.now();
    } catch (e) {
      console.error('[projection] background history rebuild failed:', (e as any)?.message);
    } finally {
      historyBuilding = false;
    }
  })().catch(() => { historyBuilding = false; });
}

// Background (non-blocking) build of the day-of-week revenue profile from a
// live 60-day pull, so the Fri-heavy weighting self-populates even when the
// window isn't cron-warmed. Debounced like the history rebuild.
let lastDowBuild = 0;
let dowBuilding = false;
function rebuildDowInBackground() {
  if (dowBuilding || Date.now() - lastDowBuild < 30 * 60 * 1000) return;
  dowBuilding = true;
  (async () => {
    try {
      const w = resolveRange('last_60_days');
      const ros = await rosForChain({ startISO: w.startISO, endISO: w.endISO });
      if (ros.length) { await writeCache('proj_dow', computeDowProfile(ros)); lastDowBuild = Date.now(); }
    } catch (e) {
      console.error('[projection] background dow build failed:', (e as any)?.message);
    } finally {
      dowBuilding = false;
    }
  })().catch(() => { dowBuilding = false; });
}

// Per-working-day goal rate from the weekly goal, scaled to any period length.
function goalForPeriod(shopNum: string, workingDaysTotal: number): number | null {
  const g = DEFAULT_GOALS[shopNum];
  if (!g?.revenueWeekly) return null;
  const perWorkDay = g.revenueWeekly / 5;
  return Math.round(perWorkDay * workingDaysTotal);
}

export async function handle(req: NextRequest) {
  const period = (req.nextUrl.searchParams.get('period') || 'this_week') as PeriodKey;
  const cStart = req.nextUrl.searchParams.get('start') || undefined;
  const cEnd = req.nextUrl.searchParams.get('end') || undefined;
  // `bust=1` skips the SWR cache and awaits a fresh compute. The UI sends this
  // when the user clicks "Refresh" — without it, the SWR pattern would serve
  // the stale payload and only refresh in the background, so the click would
  // appear to do nothing until the user refreshes again.
  const bust = req.nextUrl.searchParams.get('bust') === '1';
  // v5: workingDaysElapsed for through-today periods now uses a fractional
  // count for the in-progress day (8a-6p window) instead of rounding to a
  // whole working day. Without this, the elapsed strip on the Diagnostic
  // read "1.0 / 5 days" at 9 AM Monday when only ~0.1 of one working day
  // had actually elapsed. Bump forces a fresh compute so the corrected
  // elapsed count lands on the next request instead of waiting out the
  // 30-min SWR TTL.
  const cacheKey = `projection_v5_${period}${period === 'custom' ? `_${cStart}_${cEnd}` : ''}`;

  // Stale-while-revalidate, same convention as the heatmap route.
  if (!bust) {
    const cached = await readCache(cacheKey);
    if (cached) {
      if (!(await isFresh(cacheKey, PAYLOAD_FRESH_MS))) {
        compute(period, cStart, cEnd, cacheKey).catch((e) => console.error('[projection] bg refresh failed:', e));
      }
      return NextResponse.json(cached);
    }
  }
  try {
    return NextResponse.json(await compute(period, cStart, cEnd, cacheKey));
  } catch (e: any) {
    console.error('[projection] failed:', e);
    return NextResponse.json({ error: e?.message || 'projection failed' }, { status: 500 });
  }
}

async function compute(period: PeriodKey, cStart: string | undefined, cEnd: string | undefined, cacheKey: string) {
  const nowMtn = toZonedTime(new Date(), TEKMETRIC_REPORT_TZ);
  const { fs, fe, isFuture } = fullBounds(period, nowMtn, cStart, cEnd);

  // Working-day accounting (same calendar the goals/heatmap use).
  let workingDaysTotal = workingDaysBetween(fs, fe);
  let workingDaysElapsed = 0;
  if (period === 'today') {
    workingDaysTotal = isWorkingDay(nowMtn) ? 1 : 1; // a day is a day for pacing
    // fraction of a ~10h business day (8a–6p) already elapsed
    const h = nowMtn.getHours() + nowMtn.getMinutes() / 60;
    workingDaysElapsed = isFuture ? 0 : Math.min(1, Math.max(0.05, (h - 8) / 10));
  } else if (!isFuture) {
    const through = nowMtn < fe ? nowMtn : fe;
    // If the period extends through today (this_week / this_month / this_quarter),
    // count WHOLE working days strictly before today, then add the partial
    // fraction of today's 8a-6p business window. Without this, the elapsed
    // count was rounding to a full day even at 9 AM — e.g. "1.0 / 5 days"
    // when only ~0.1 of one working day had actually elapsed.
    const throughIsNow = through === nowMtn;
    if (throughIsNow) {
      const today00 = startOfDay(nowMtn);
      const beforeToday = workingDaysBetween(fs, new Date(today00.getTime() - 1));
      if (isWorkingDay(nowMtn)) {
        const h = nowMtn.getHours() + nowMtn.getMinutes() / 60;
        const todayFrac = Math.min(1, Math.max(0, (h - 8) / 10)); // 8a-6p window
        workingDaysElapsed = beforeToday + todayFrac;
      } else {
        workingDaysElapsed = beforeToday;
      }
    } else {
      // Period already ended (e.g. last_week) → whole-day count is correct.
      workingDaysElapsed = workingDaysBetween(fs, through);
    }
  }
  workingDaysTotal = Math.max(0.5, workingDaysTotal);

  const periodLabels: Record<PeriodKey, string> = {
    today: 'Today', this_week: 'This Week', next_week: 'Next Week',
    this_month: 'This Month', next_month: 'Next Month', this_quarter: 'This Quarter',
    custom: cStart && cEnd ? `${cStart} → ${cEnd}` : 'Custom',
  };
  const spec: PeriodSpec = {
    key: period, label: periodLabels[period],
    workingDaysTotal, workingDaysElapsed, isFuture,
  };

  // --- history: NEVER block a request on Tekmetric. Prefer the cached
  // 20-week build; if it's missing or stale, derive instantly from the
  // already-cached heatmap payload and rebuild the full series in the
  // background so the next load is richer. ---
  let hist = await readCache<WeeklyHistory>('proj_history_20w');
  const histFresh = hist && (await isFresh('proj_history_20w', HISTORY_FRESH_MS));
  if (!histFresh) {
    if (!hist) hist = await weeklyHistoryFromHeatmapCache();
    rebuildHistoryInBackground();
  }
  if (!hist) {
    hist = { weeks: [], shops: SHOPS.map((s) => ({ shopNum: s.num, shopName: s.name, points: [] })) };
  }

  // --- per-shop day-of-week revenue profile (slow-changing; cache-only so it
  // never blocks). Lets a Monday read as a Monday and credit Friday-heavy
  // weeks correctly instead of flat proration. ---
  let dow = await readCache<DowProfile>('proj_dow');
  if (!dow || !(await isFresh('proj_dow', HISTORY_FRESH_MS))) {
    try {
      const w60 = resolveRange('last_60_days');
      const { ros } = await rosForChainCached({ startISO: w60.startISO, endISO: w60.endISO });
      if (ros.length) { dow = computeDowProfile(ros); await writeCache('proj_dow', dow); }
    } catch (e) { console.warn('[projection] dow profile cache read skipped:', (e as any)?.message); }
    // Not cached → build it live in the background so it self-populates.
    if (!dow) rebuildDowInBackground();
  }

  // --- current-period actuals per shop (skip when the period is future) ---
  const actualBy = new Map<string, { revenue: number; cars: number; gpDollars: number; billedHours: number }>();
  for (const s of SHOPS) actualBy.set(s.num, { revenue: 0, cars: 0, gpDollars: 0, billedHours: 0 });
  let rosThisWeek: any[] = []; // hoisted so v2 enhancement (below) can read approved-unbilled per shop
  if (!isFuture && workingDaysElapsed > 0) {
    // Reuse the cron-warmed standard window keys; cache-only so the request
    // never blocks on Tekmetric. If the window isn't cached yet the engine
    // falls back to a pure history projection (still useful, not empty).
    const stdKey: RangeKey =
      period === 'today' ? 'today'
      : period === 'this_week' ? 'this_week'
      : period === 'this_month' ? 'this_month'
      : period === 'this_quarter' ? 'this_quarter'
      : 'this_month';
    const wr = period === 'custom'
      ? customRange(fs.toISOString().slice(0, 10), (nowMtn < fe ? nowMtn : fe).toISOString().slice(0, 10))
      : resolveRange(stdKey);
    try {
      const { ros: rosFetched } = await rosForChainCached({ startISO: wr.startISO, endISO: wr.endISO });
      rosThisWeek = rosFetched;
      const kpi = chainKpi(rosFetched);
      for (const k of kpi.byShop) {
        const a = actualBy.get(k.shopNum);
        if (a) { a.revenue = k.revenue; a.cars = k.cars; a.gpDollars = k.gpDollars; }
      }
      for (const o of rosFetched) {
        if (!isCountedRO(o)) continue;
        const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
        if (!meta) continue;
        const a = actualBy.get(meta.num);
        if (!a) continue;
        for (const j of o.jobs || []) if (j.authorized) a.billedHours += j.laborHours || 0;
      }
    } catch (e) {
      console.warn('[projection] actuals read failed, using history-only:', (e as any)?.message);
    }
  }

  // --- yesterday's snapshot for "change since yesterday" ---
  const snapKey = `proj_snap_${period}`;
  const prevSnap = (await readCache<Record<string, number>>(snapKey)) || {};

  // --- holiday short-week awareness ---
  // For a single-week target, scale each shop's baseline by how it ACTUALLY
  // performed on prior same-holiday weeks (from the permanent archive) instead
  // of a flat working-day proration. Empty when the week isn't a holiday week
  // or no prior occurrence is archived yet → engine falls back to working-day
  // proration. Only weekly targets get this; a single holiday inside a month/
  // quarter is already a small slice handled by working-day proration.
  let holidayByShop: Record<string, number> = {};
  let holidayNote: string | null = null;
  if (period === 'this_week' || period === 'next_week') {
    try {
      const hf = await holidayFactors(fs.toISOString().slice(0, 10));
      holidayByShop = hf.byShop;
      holidayNote = hf.note;
    } catch (e) { console.warn('[projection] holiday factors skipped:', (e as any)?.message); }
  }

  // --- per-shop independent projections ---
  const histByShop = new Map(hist.shops.map((s) => [s.shopNum, s.points]));
  const projections: ShopProjection[] = [];
  const backtests: Record<string, ReturnType<typeof backtestShop>> = {};
  const todaySnap: Record<string, number> = {};
  for (const s of SHOPS) {
    const points = histByShop.get(s.num) || [];
    const ramping = isRampingShop(s, new Date());
    // For the in-progress weekly view, replace flat working-day proration
    // with this shop's learned day-of-week revenue curve (Fri-heavy etc.).
    let shopSpec = spec;
    if (period === 'this_week' && !isFuture && dow) {
      const w = dow.byShop[s.num] || dow.chain;
      if (w) shopSpec = { ...spec, revenueElapsedFraction: weekRevenueElapsed(w, nowMtn) };
    }
    // Empirical holiday multiplier wins over flat working-day proration.
    const hMul = holidayByShop[s.num];
    if (hMul != null && hMul > 0) {
      shopSpec = { ...shopSpec, holidayFactor: hMul, holidayNote: holidayNote ?? undefined };
    }
    const proj = projectShop({
      shopNum: s.num, shopName: s.name, district: s.district,
      history: points,
      period: shopSpec,
      actuals: actualBy.get(s.num)!,
      goalRevenue: goalForPeriod(s.num, workingDaysTotal),
      isRamping: ramping,
      prevExpected: prevSnap[s.num] ?? null,
    });
    // Strip the v1-inherited per-shop drift note ("accuracy slipping" copy)
    // so it can't surface via cached payloads or unrelated render paths.
    (proj as any).driftNote = null;
    projections.push(proj);
    backtests[s.num] = backtestShop(s.num, s.name, s.district, points, ramping);
    todaySnap[s.num] = proj.expected;
  }

  // ============================================================
  // v2 projection enhancement + learning-store writer (this_week only)
  //
  // Independent of the model-serving flag, when PROJECTION_LOG_WRITE is on we
  // write a learning-store record per shop so v2 has live data accumulating
  // even while v1 is still serving. When PROJECTION_MODEL_V2 is on we replace
  // the per-shop projection's serving fields with v2's output.
  //
  // Booked-appts is held at 0 in this first wiring (handler doesn't currently
  // fetch /appointments); the live appointment fetch is the LAST item to
  // harden before flipping v2 serving ON, and it's surfaced in QC.
  // ============================================================
  if (period === 'this_week' && !isFuture) {
    const jobCaps = loadJobCaps();
    const settledWeeks = await readSettledWeeks();
    const weekStartISO = fs.toISOString().slice(0, 10);
    const { label: cpLabel } = detectCheckpoint(nowMtn);
    // Per-shop this-week appointments — CACHE-ONLY (background cron warms;
    // request path never hits Tekmetric). Each shop returns one of
    //   - fresh   (cron-warmed within 2h)            → use as-is
    //   - stale   (older than 2h, younger than 8h)   → use, mark stale
    //   - missing (no cache or older than 8h)        → bookedAppts=null
    const apptByShop = new Map<string, ApptsResult>();
    await Promise.all(SHOPS.map(async (sh) => {
      apptByShop.set(sh.num, await getApptsForWeekCached(sh.tekmetricId, fs));
    }));
    const weekEndMs = fe.getTime();
    for (const proj of projections) {
      const shop = proj.shopNum;
      const a = actualBy.get(shop) || { revenue: 0, cars: 0, gpDollars: 0, billedHours: 0 };
      // approved-unbilled, per-job capped to shop 80th-pct
      const cap = jobCaps[shop] ?? Number.POSITIVE_INFINITY;
      const cpMs = nowMtn.getTime();
      const jobSubs: number[] = [];
      for (const o of rosThisWeek) {
        const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
        if (!meta || meta.num !== shop) continue;
        const postedMs = o.postedDate ? new Date(o.postedDate).getTime() : Infinity;
        if (postedMs <= cpMs) continue;             // already in rev_so_far
        for (const j of o.jobs || []) {
          if (j.authorized && j.authorizedDate && new Date(j.authorizedDate).getTime() <= cpMs) {
            jobSubs.push((j.subtotal || 0) / 100);
          }
        }
      }
      const approvedUnbilled = capPerJobAndSum(jobSubs, cap);
      // Expose on the per-shop projection so the diagnostic can detect whether
      // a car-count gap is a throughput constraint (queue full) vs a demand gap.
      (proj as any).approvedUnbilled = approvedUnbilled;
      const apptRes = apptByShop.get(shop) || { appts: [] as Appointment[], freshness: 'missing' as ApptsFreshness, ageMs: null };
      // Null when cache is missing/expired — the model must not fabricate 0.
      const bookedAppts: number | null = apptRes.freshness === 'missing'
        ? null
        : apptRes.appts.filter((a) =>
            a.createdDate && a.startTime &&
            new Date(a.createdDate).getTime() <= cpMs &&
            new Date(a.startTime).getTime() > cpMs &&
            new Date(a.startTime).getTime() <= weekEndMs,
          ).length;
      // trailing-12 / trailing-4 medians from settled snapshots
      const shopSettled = settledWeeks
        .filter((w) => w.weekStart < weekStartISO && w.perShop[shop] != null)
        .map((w) => w.perShop[shop]);
      const t12 = shopSettled.slice(-12);
      const t4 = shopSettled.slice(-4);
      const median = (xs: number[]) => {
        if (!xs.length) return 0;
        const s = [...xs].sort((x, y) => x - y);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      };
      const shopBaselineMedian = median(t12);
      const shopBaselineTrailing4 = median(t4);

      const v2Input: V2Input = {
        shopNum: shop, shopName: proj.shopName, nowMtn,
        revSoFar: a.revenue,
        approvedUnbilled,
        bookedAppts,
        shopBaselineMedian, shopBaselineTrailing4,
      };
      const v2Raw          = projectV2(v2Input);
      const biasCorrection = await readBiasCorrection(shop);
      const bandMult       = await readBandMultiplier(cpLabel);

      // Two post-processing adjustments, applied in order:
      // 1) Bias correction: shifts point/low/high proportionally to correct the
      //    rolling mean signed error for this shop (neutral until 6 settled weeks).
      // 2) Band calibration: widens/narrows [low,high] around the point to hit the
      //    target 80% coverage rate for this checkpoint.
      const bPoint = Math.round(v2Raw.point * biasCorrection);
      const bLow   = Math.round(v2Raw.low   * biasCorrection);
      const bHigh  = Math.round(v2Raw.high  * biasCorrection);
      const v2 = {
        ...v2Raw,
        point: bPoint,
        low:   Math.round(bPoint - (bPoint - bLow)  * bandMult),
        high:  Math.round(bPoint + (bHigh - bPoint) * bandMult),
        contributions: biasCorrection !== 1.0
          ? [...v2Raw.contributions, { label: `Bias ×${biasCorrection.toFixed(3)}`, amount: bPoint - v2Raw.point }]
          : v2Raw.contributions,
      };

      // Always write the learning-store record (gated by LOG_WRITE inside).
      const logRec: ProjectionLog = {
        week: weekStartISO, shop, checkpoint: cpLabel,
        capturedAt: new Date().toISOString(),
        features: {
          revSoFar: a.revenue, approvedUnbilled,
          bookedAppts,
          apptsFreshness: apptRes.freshness,
          carsSoFar: a.cars, gpSoFarPct: a.revenue > 0 ? (a.gpDollars / a.revenue) * 100 : 0,
          aroSoFar: a.cars ? a.revenue / a.cars : 0,
          elapsedBizFrac: v2.elapsedBizFrac,
          shopBaselineMedian, shopBaselineTrailing4,
        },
        projection: {
          modelVersion: modelV2Enabled() ? v2.modelVersion : 'v1',
          point: modelV2Enabled() ? v2.point : proj.expected,
          low:   modelV2Enabled() ? v2.low   : proj.worstCase,
          high:  modelV2Enabled() ? v2.high  : proj.bestCase,
          confidence: modelV2Enabled() ? v2.confidence : (proj.confidence ?? 0) / 100,
          isRamping: v2.isRamping,
          contributions: v2.contributions,
        },
        actualFinalRevenue: null, errorAbs: null, errorPct: null,
      };
      if (logWriteEnabled()) {
        // AWAIT so per-shop writes serialize on the proj_log_index — parallel
        // fire-and-forget writes raced and lost ~1 row per request.
        try { await writeProjectionLog(logRec); }
        catch (e) { console.warn('[projection] log write failed:', (e as any)?.message); }
      }

      // If v2 is the active serving model, swap its fields onto the projection.
      if (modelV2Enabled()) {
        (proj as any).expected = v2.point;
        (proj as any).bestCase = v2.high;
        (proj as any).worstCase = v2.low;
        (proj as any).confidence = Math.round(v2.confidence * 100);
        (proj as any).contributions = v2.contributions;
        (proj as any).isRamping = v2.isRamping;
        if (v2.rampWarning) (proj as any).rampWarning = v2.rampWarning;
        (proj as any).modelVersion = v2.modelVersion;
        (proj as any).apptsFreshness = apptRes.freshness;
        if (biasCorrection !== 1.0) (proj as any).biasCorrection = biasCorrection;
      } else {
        // Always attach contributions for the tooltip even when v1 serves —
        // so QC can compare v2's reasoning against v1's number side-by-side.
        (proj as any).contributionsV2 = v2.contributions;
        (proj as any).pointV2 = v2.point;
        (proj as any).confidenceV2 = v2.confidence;
        if (v2.rampWarning) (proj as any).rampWarningV2 = v2.rampWarning;
        (proj as any).apptsFreshness = apptRes.freshness;
      }
    }
  }

  // refresh the daily snapshot at most once per UTC day
  const snapDay = (await readCache<string>(`${snapKey}_day`)) || '';
  const today = new Date().toISOString().slice(0, 10);
  if (snapDay !== today) {
    await writeCache(snapKey, todaySnap);
    await writeCache(`${snapKey}_day`, today);
  }

  const districts = DISTRICTS.map((d) =>
    rollUp(d.name, projections.filter((p) => d.shopNums.includes(p.shopNum as ShopNum))),
  );
  const portfolio = rollUp('Portfolio', projections);

  // chain-level backtest accuracy (revenue-weighted MAPE across shops)
  const wsum = projections.reduce((s, p) => s + p.expected, 0) || 1;
  const portfolioMape = Math.round(
    (projections.reduce((s, p) => s + (backtests[p.shopNum]?.mape || 0) * p.expected, 0) / wsum) * 10,
  ) / 10;

  // Chain actual revenue booked so far this period (sum of per-shop actuals).
  const actualRevenue = Math.round([...actualBy.values()].reduce((s, a) => s + a.revenue, 0));
  const payload = {
    period: { ...spec, actualRevenue },
    generatedAt: new Date().toISOString(),
    historyWeeks: hist.weeks.length,
    portfolio,
    districts,
    shops: projections,
    backtests,
    portfolioAccuracy: {
      mape: portfolioMape,
      // Text intentionally blank in this preview. The portfolio-level
      // "accurate within X%" line was v1-inherited and blended across
      // checkpoints where v1 is essentially useless (Mon AM ~95% MAPE),
      // misrepresenting v2's accuracy. Per-checkpoint v2 confidence is
      // surfaced per shop via the Why-this-number tooltip.
      text: '',
    },
  };
  await writeCache(cacheKey, payload);
  return payload;
}
