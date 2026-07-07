// Registry of sync jobs the cron endpoint runs.
//
// Lightweight by design: only Tekmetric warm-ups + the tech-name lookup. Heavy
// jobs (Anthropic classification, Postgres-backed GBP review sync, FBR warm)
// live in _disabled_jobs until DB + paid Vercel tier are in place. Keeping
// this file dep-light is what lets the cron route stay under the 250MB
// serverless function size cap on Hobby.
//
// Each job is self-contained:
//   - `isEnabled` is evaluated at call time so toggling env vars takes effect
//     on the next cron tick without redeploy.
//   - `run()` should be idempotent and fail closed — throw on error so the
//     dispatcher can record the failure without bringing down sibling jobs.

import { resolveRange, customRange, CHAIN_TZ } from '@/lib/dates';
import { isAR, snapshotTotals, hasSnapshot, writeSnapshot, resolveCustomerNames, currentARFromRos, AR_CURRENT_KEY, ARMode } from '@/lib/ar';
import { rosForChain, rosForShop } from '@/lib/dataAccess';
import { fetchAllRepairOrders, fetchROsByCreatedDate, type RepairOrder } from '@/lib/tekmetric';
import { getTechnicianNames } from '@/lib/technicians';
import { fetchAllAppointments } from '@/lib/tekmetric';
import { classifyPricing, matrixRetail } from '@/lib/partsMatrix';
import { classifyFleet, shopFbr, shopKar, findForwardBookedAppt, isEligibleRO } from '@/lib/fbr';
import { resolveCustomerContacts, resolveVehicles } from '@/lib/ar';
import { c2d } from '@/lib/tekmetric';
import { DECLINED_JOBS_KEY, type DeclinedJobsShopCache } from '@/lib/handlers/declinedJobs';
import { MISSED_REBOOKS_KEY, type MissedRebookRow } from '@/lib/handlers/missedRebooks';
import { SHOPS, SHOP_BY_NUM, ShopNum, isRampingShop } from '@/lib/shops';
import { writeCache, readCache } from '@/lib/cache';
import { fetchAllLeads, isEligibleCall } from '@/lib/whatconverts';
import { classifyBatch, scoreSalvageabilityBatch } from '@/lib/classify';
import { MISSED_CALLBACKS_KEY, type MissedCallbacksShopCache } from '@/lib/handlers/missedCallbacks';
import { reopenStaleResolutions } from '@/lib/callbackStore';
import { reopenStaleRebookResolutions } from '@/lib/rebookStore';
import { reopenStaleDeclinedJobResolutions } from '@/lib/declinedJobStore';
import { refreshGoogleRatings, GOOGLE_RATINGS_CACHE_KEY, type GoogleRatingsPayload } from '@/lib/handlers/googleRatings';
import { writeMetricSnapshot, readMetricSnapshot, type WeeklyMetricSnapshot } from '@/lib/metricSnapshots';
import { addDays, addMonths, startOfWeek, endOfWeek, startOfYear } from 'date-fns';
import { chainKpi } from '@/lib/metrics';
import { getSettledWeek, writeSettledWeek, FREEZE_AFTER_DAYS } from '@/lib/reconcile';
import { backfillWeeklyActuals } from '@/lib/learningStore';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { maybeCrown } from '@/lib/goldenMango';
import { isCountedRO, isPostOfficeName } from '@/lib/metrics';
import { RC_SHOP_KEY, type ReturnCustomersShop } from '@/lib/handlers/returnCustomers';

export interface SyncJob {
  name: string;
  isEnabled(): boolean;
  run(): Promise<{ message?: string; details?: Record<string, unknown> }>;
}

const warmTekmetric: SyncJob = {
  name: 'warm-tekmetric-cache',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    // last_7_days is what the live "Week to Date" sections request; the cron
    // MUST warm it or those sections cold-compute (429) and look empty.
    // Soft refresh via rosForChain (honors the 30-min cache) — force-refresh
    // was tried but added ~30s/tick and pushed the whole sweep over Vercel's
    // 300s function cap, causing constant GH Actions failures.
    const windows = ['last_7_days', 'this_week', 'this_month'] as const;
    let totalROs = 0;
    for (const r of windows) {
      const w = resolveRange(r);
      const ros = await rosForChain({ startISO: w.startISO, endISO: w.endISO });
      totalROs += ros.length;
    }
    await writeCache('hb_tekmetric', { ros: totalROs });
    return { message: `${totalROs} ROs cached across this_week + this_month` };
  },
};

const refreshTechNames: SyncJob = {
  name: 'refresh-tech-names',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    const names = await getTechnicianNames();
    return { message: `tech roster refreshed`, details: { count: Object.keys(names).length } };
  },
};

// Re-Book warming, ONE shop per cron tick (round-robin). Pulling all 8 shops'
// 6-month appointment windows in a single burst reliably 429s Tekmetric — the
// chronic cause of the Re-Book section breaking. Instead each tick warms a
// single shop into a durable per-shop Redis key (fbr_shop_<num>); over ~8
// ticks (~2h) every shop is populated and then continuously refreshed. The
// /api/fbr endpoint assembles the leaderboard from these per-shop keys, so it
// shows partial data immediately and never an all-or-nothing failure.
export const FBR_SHOP_KEY = (num: string) => `fbr_shop_${num}`;
// Separate cache key for the Mon→today subset, derived from the SAME trailing-7
// raw RO fetch so we don't double-pull Tekmetric. Trophies read this; existing
// trailing-7 consumers continue reading FBR_SHOP_KEY.
export const FBR_SHOP_WTD_KEY = (num: string) => `fbr_shop_wtd_${num}`;
export const FBR_IDX_KEY = 'fbr_warm_idx';

/**
 * Warm the FBR + KAR caches for a single shop. Pulled out of the SyncJob so
 * an operator can target one shop via the admin route (cold cache, after a
 * formula change, etc.) without running the full 9-job sweep.
 */
export async function warmFbrForShop(shopNum: string): Promise<string> {
  const shop = SHOPS.find(s => s.num === shopNum);
  if (!shop) throw new Error(`unknown shop ${shopNum}`);

  const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
  const lastWeekStart = addDays(nowMtn, -7);
  const wkStartISO = fromZonedTime(lastWeekStart, CHAIN_TZ).toISOString();
  const wkEndISO = fromZonedTime(nowMtn, CHAIN_TZ).toISOString();
  const apptFromISO = wkStartISO;
  // Customers commonly book "next 6 months out" relative to TODAY (not
  // relative to last-week-start). Extending the fetch to nowMtn + 8 months
  // ensures appointments scheduled exactly 6 months from a late-in-week RO
  // are captured (previous +6mo-from-lastWeekStart cap was missing them).
  const apptToISO = fromZonedTime(addMonths(nowMtn, 8), CHAIN_TZ).toISOString();
  // Diagnostic boundary: this is where the OLD fetch window ended. Used
  // below to count appointments that the previous code would have missed.
  const oldCutoffMs = fromZonedTime(addMonths(lastWeekStart, 6), CHAIN_TZ).getTime();

  const ros = await rosForShop(shop.tekmetricId, { startISO: wkStartISO, endISO: wkEndISO });
  const fleetByCust = new Map<number, 'RETAIL' | 'FLEET'>();
  const vehiclesPerCust = new Map<number, Set<number>>();
  for (const r of ros) {
    if (!r.customerId) continue;
    const s = vehiclesPerCust.get(r.customerId) ?? new Set();
    s.add(r.vehicleId);
    vehiclesPerCust.set(r.customerId, s);
  }
  for (const [cid, vs] of vehiclesPerCust) {
    fleetByCust.set(cid, classifyFleet({ id: cid, fullName: '', vehicleCount: vs.size }));
  }
  const appts = await fetchAllAppointments({ shopId: shop.tekmetricId, startTimeFrom: apptFromISO, startTimeTo: apptToISO });
  // Diagnostic: how many of these appointments were outside the OLD 6mo
  // fetch window — i.e. would have been missed under the previous code.
  const apptsBeyondOldWindow = appts.filter(a => {
    const t = a.startTime ? new Date(a.startTime).getTime() : 0;
    return t > oldCutoffMs;
  }).length;
  const apptsByCust = new Map<number, typeof appts>();
  for (const a of appts) {
    if (!a.customerId) continue;
    const arr = apptsByCust.get(a.customerId) ?? [];
    arr.push(a);
    apptsByCust.set(a.customerId, arr);
  }
  const fbr = shopFbr(ros, fleetByCust, apptsByCust);
  const kar = shopKar(appts, ros);
  await writeCache(FBR_SHOP_KEY(shop.num), {
    shopNum: shop.num,
    shopName: shop.name,
    fbr: fbr ?? { eligibleROs: 0, forwardBookedROs: 0, fbrPct: 0, avgMonthsToRebook: null },
    kar: kar ?? { expectedAppts: 0, keptAppts: 0, karPct: 0 },
    ramping: isRampingShop(shop, nowMtn),
    weekStart: lastWeekStart.toISOString(),
    weekEnd: nowMtn.toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // --- Missed Rebooks queue ---
  // Customers who DID come in this rolling 7-day window but did NOT book a
  // future appointment (no callback within 14 days either). Dedupe by
  // customerId, keep the most recent eligible RO per customer (that RO's
  // vehicle is what they just brought in). Skip if no contact resolution
  // path is available (TEKMETRIC token missing). Per-customer fetches are
  // cap-limited inside the resolvers, so single warm has bounded API load.
  try {
    const eligibleAll = ros.filter(r => isEligibleRO(r, fleetByCust));
    const missedROs = eligibleAll.filter(r => !findForwardBookedAppt(r, apptsByCust));
    // Dedupe by customer; latest postedDate wins.
    const byCust = new Map<number, typeof missedROs[number]>();
    for (const r of missedROs) {
      if (!r.customerId) continue;
      const prev = byCust.get(r.customerId);
      if (!prev || (r.postedDate && (!prev.postedDate || r.postedDate > prev.postedDate))) {
        byCust.set(r.customerId, r);
      }
    }
    const custIds = Array.from(byCust.keys());
    const vehIds = Array.from(new Set(Array.from(byCust.values()).map(r => r.vehicleId).filter(Boolean)));
    const [contacts, vehicles] = await Promise.all([
      resolveCustomerContacts(custIds, 60),
      resolveVehicles(vehIds, 60),
    ]);
    const customers: MissedRebookRow[] = Array.from(byCust.values())
      .map((r): MissedRebookRow => ({
        roId: r.id,
        customerId: r.customerId,
        customerName: contacts.get(r.customerId)?.name || `Account #${r.customerId}`,
        phone: contacts.get(r.customerId)?.phone,
        vehicle: vehicles.get(r.vehicleId) || undefined,
        postedDate: r.postedDate || '',
      }))
      .sort((a, b) => (b.postedDate || '').localeCompare(a.postedDate || ''));
    await writeCache(MISSED_REBOOKS_KEY(shop.num), {
      shopNum: shop.num,
      shopName: shop.name,
      computedAt: new Date().toISOString(),
      windowStart: lastWeekStart.toISOString().slice(0, 10),
      windowEnd: nowMtn.toISOString().slice(0, 10),
      customers,
    });
    // Auto-reopen: customers still in the missed-rebook list whose "won"
    // stamp is older than 12h were a premature click — they still have no
    // forward-booked appointment. Resurface so the manager sees the lead.
    await reopenStaleRebookResolutions(customers.map(c => c.roId));
  } catch (e: any) {
    console.error(`[warm-fbr] missed-rebooks shop ${shop.num} failed: ${e?.message || e}`);
    // Don't fail the warm — leaderboard cache is already written above.
  }

  // --- Week-to-date (Mon→now MT) variant for trophies ---
  const monday = startOfWeek(nowMtn, { weekStartsOn: 1 });
  // Convert the MT-wall-clock Monday back to a real UTC instant before
  // storing. `monday` is a date-fns-tz zoned date whose .toISOString() is
  // NOT a correct UTC timestamp — it's the MT wall-clock value that happens
  // to format as ISO. The stale-week check in app/api/fbr reads weekStart
  // and compares it against fromZonedTime(thisMon, CHAIN_TZ), which IS
  // correct UTC, so they would never match without this conversion.
  const mondayISO = fromZonedTime(monday, CHAIN_TZ).toISOString();
  const rosWtd = ros.filter((r) => r.postedDate && r.postedDate >= mondayISO);
  const fbrWtd = shopFbr(rosWtd, fleetByCust, apptsByCust);
  await writeCache(FBR_SHOP_WTD_KEY(shop.num), {
    shopNum: shop.num,
    shopName: shop.name,
    fbr: fbrWtd ?? { eligibleROs: 0, forwardBookedROs: 0, fbrPct: 0, avgMonthsToRebook: null },
    ramping: isRampingShop(shop, nowMtn),
    weekStart: mondayISO,
    weekEnd: nowMtn.toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return `shop ${shop.num} (${shop.name}) — trailing7: ${fbr?.forwardBookedROs ?? 0}/${fbr?.eligibleROs ?? 0} (${((fbr?.fbrPct ?? 0) * 100).toFixed(1)}%) · wtd: ${fbrWtd?.forwardBookedROs ?? 0}/${fbrWtd?.eligibleROs ?? 0} (${((fbrWtd?.fbrPct ?? 0) * 100).toFixed(1)}%) · appts past old 6mo window: ${apptsBeyondOldWindow}`;
}

/**
 * BACKFILL one past week's Re-Book % and Call-Conversion % for one shop, and
 * merge them into that week's metric snapshot. Lets us reconstruct history
 * the live snapshots don't have yet:
 *   - Re-Book is fully deterministic (ROs + appointments → shopFbr).
 *   - Conversion is recomputed from that week's WhatConverts leads via the
 *     Claude classifier (costs API credits; bounded to the weeks we backfill).
 * One shop per call keeps each invocation well under the function cap.
 * `weekStartYmd` must be the Monday of the target week (chain tz).
 */
export async function backfillWeekMetricsForShop(weekStartYmd: string, shopNum: string): Promise<string> {
  const shop = SHOPS.find(s => s.num === shopNum);
  if (!shop) throw new Error(`unknown shop ${shopNum}`);
  const weekEndYmd = (() => { const d = new Date(weekStartYmd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); })();
  const w = customRange(weekStartYmd, weekEndYmd);

  // --- Re-Book: that week's ROs + forward appointments ---
  const ros = await rosForShop(shop.tekmetricId, { startISO: w.startISO, endISO: w.endISO });
  const fleetByCust = new Map<number, 'RETAIL' | 'FLEET'>();
  const vehiclesPerCust = new Map<number, Set<number>>();
  for (const r of ros) { if (!r.customerId) continue; const set = vehiclesPerCust.get(r.customerId) ?? new Set(); set.add(r.vehicleId); vehiclesPerCust.set(r.customerId, set); }
  for (const [cid, vs] of vehiclesPerCust) fleetByCust.set(cid, classifyFleet({ id: cid, fullName: '', vehicleCount: vs.size }));
  const apptToISO = addMonths(new Date(w.startISO), 8).toISOString();
  const appts = await fetchAllAppointments({ shopId: shop.tekmetricId, startTimeFrom: w.startISO, startTimeTo: apptToISO });
  const apptsByCust = new Map<number, typeof appts>();
  for (const a of appts) { if (!a.customerId) continue; const arr = apptsByCust.get(a.customerId) ?? []; arr.push(a); apptsByCust.set(a.customerId, arr); }
  const fbr = shopFbr(ros, fleetByCust, apptsByCust);
  const rebookPct = fbr ? Math.round(fbr.fbrPct * 1000) / 10 : 0;

  // --- Conversion: that week's WhatConverts leads, Claude-classified ---
  let conversionPct: number | null = null;
  let convDetail = 'conv skipped';
  try {
    const leads = await fetchAllLeads({ shop: shop.num as ShopNum, startDate: weekStartYmd, endDate: weekEndYmd });
    const eligible = leads.filter(isEligibleCall);
    if (eligible.length) {
      const results = await classifyBatch(eligible, 8);
      const booked = [...results.values()].filter((r: any) => r.appointment_booked).length;
      conversionPct = Math.round((booked / eligible.length) * 1000) / 10;
      convDetail = `conv ${booked}/${eligible.length} (${conversionPct}%)`;
    } else {
      conversionPct = null; convDetail = 'conv 0 eligible';
    }
  } catch (e: any) {
    convDetail = `conv FAILED: ${e?.message || e}`;
  }

  // --- Merge into the week's snapshot (preserve other shops + rating) ---
  const prev = await readMetricSnapshot(weekStartYmd);
  const snap: WeeklyMetricSnapshot = {
    weekStart: weekStartYmd,
    capturedAt: new Date().toISOString(),
    rebook: { ...(prev?.rebook || {}), [shop.num]: rebookPct },
    conversion: { ...(prev?.conversion || {}), ...(conversionPct != null ? { [shop.num]: conversionPct } : {}) },
    rating: { ...(prev?.rating || {}) },
  };
  await writeMetricSnapshot(snap);
  return `backfill ${weekStartYmd} shop ${shop.num}: rebook ${rebookPct}% (${fbr?.forwardBookedROs ?? 0}/${fbr?.eligibleROs ?? 0}) · ${convDetail}`;
}

const warmFbr: SyncJob = {
  name: 'warm-fbr-leaderboard',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    // Reverted to round-robin (1 shop per tick) after a brief experiment
    // running ALL 8 shops per tick hit Vercel's 300s Pro-tier function
    // cap (the maxDuration=800 export didn't override it without a
    // vercel.json declaration). 504 timeouts triggered failed GH Actions
    // every cron tick.
    //
    // Staleness from round-robin = up to 2 hours per shop. To keep FBR
    // numbers fresh for managers, /api/fbr should self-heal on read by
    // triggering a background re-warm when its cache is older than
    // ~10-15 min. That work happens in handler/route, not here.
    const idx = (await readCache<number>(FBR_IDX_KEY)) ?? 0;
    const shop = SHOPS[idx % SHOPS.length];
    await writeCache(FBR_IDX_KEY, (idx + 1) % SHOPS.length);
    return { message: await warmFbrForShop(shop.num) };
  },
};

// Re-locks the Golden Mango champion when the Friday-6pm-MT boundary rolls
// over; a no-op the rest of the week. Depends only on already-warmed Tekmetric
// data + the fbr_leaderboard cache, so it must run AFTER warmFbr each tick.
const updateGoldenMango: SyncJob = {
  name: 'update-golden-mango',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    const msg = await maybeCrown();
    return { message: msg };
  },
};

// Strict booked-rate (Claude-classified Call Conversion). Pulls WhatConverts
// leads for the rolling 7-day window, classifies each eligible call transcript
// with Anthropic, and writes the strict snapshot the Call Conversion section
// reads. Gated on ANTHROPIC_API_KEY so it's a no-op if the key is absent.
const refreshBookedRate: SyncJob = {
  name: 'refresh-booked-rate-strict',
  isEnabled: () => !!process.env.ANTHROPIC_API_KEY && !!process.env.WHATCONVERTS_001,
  async run() {
    const w = resolveRange('last_7_days');
    const startDate = w.startISO.slice(0, 10);
    const endDate = w.endISO.slice(0, 10);
    // WTD = Monday→today MT, derived from the SAME trailing-7 leads by
    // filtering on date_created. Written to a separate cache key so trailing-7
    // readers (KpiCards, RevenueOpportunityCard) are unaffected.
    const wWtd = resolveRange('wtd');
    const mondayDate = wWtd.startISO.slice(0, 10);
    const shops = Object.keys(SHOP_BY_NUM) as ShopNum[];
    const out: any[] = [];
    const outWtd: any[] = [];
    let totalElig = 0;
    let totalBooked = 0;
    let totalEligWtd = 0;
    let totalBookedWtd = 0;
    for (const num of shops) {
      try {
        const leads = await fetchAllLeads({ shop: num, startDate, endDate });
        const eligible = leads.filter(isEligibleCall);
        const results = await classifyBatch(eligible, 8);
        const booked = [...results.values()].filter((r: any) => r.appointment_booked).length;
        totalElig += eligible.length;
        totalBooked += booked;
        out.push({
          shopNum: num, shopName: SHOP_BY_NUM[num].name,
          totalCalls: leads.length, eligible: eligible.length, booked,
          bookedRatePct: eligible.length ? Math.round((booked / eligible.length) * 1000) / 10 : 0,
        });

        // WTD subset — same classifications, filtered to leads whose
        // date_created is on/after Monday in MOUNTAIN TIME. Previously we
        // sliced the UTC ISO string directly, which silently miscounted
        // every Sunday-evening MT call (00:00–06:00 UTC Monday) as a
        // "Monday morning" call — easily inflating Monday's WTD by 5–15
        // calls per shop. Convert to MT-zoned date FIRST so the cutoff
        // matches every other "this week" boundary on the dashboard.
        const mtDateOf = (iso: string) => {
          // date-fns-tz toZonedTime returns the wall-clock equivalent in
          // the target zone; sliceing its ISO gives the local calendar
          // date. Wrap in try/catch for legacy rows with malformed strings.
          try { return toZonedTime(new Date(iso), CHAIN_TZ).toISOString().slice(0, 10); }
          catch { return iso.slice(0, 10); }
        };
        const leadsWtd = leads.filter((l) => l.date_created && mtDateOf(l.date_created) >= mondayDate);
        const eligibleWtd = leadsWtd.filter(isEligibleCall);
        const bookedWtd = eligibleWtd.filter((l) => {
          const cls = results.get(l.lead_id);
          return cls?.appointment_booked === true;
        }).length;
        totalEligWtd += eligibleWtd.length;
        totalBookedWtd += bookedWtd;
        outWtd.push({
          shopNum: num, shopName: SHOP_BY_NUM[num].name,
          totalCalls: leadsWtd.length, eligible: eligibleWtd.length, booked: bookedWtd,
          bookedRatePct: eligibleWtd.length ? Math.round((bookedWtd / eligibleWtd.length) * 1000) / 10 : 0,
        });
      } catch (e: any) {
        out.push({ shopNum: num, shopName: SHOP_BY_NUM[num].name, totalCalls: 0, eligible: 0, booked: 0, bookedRatePct: 0, error: e?.message });
        outWtd.push({ shopNum: num, shopName: SHOP_BY_NUM[num].name, totalCalls: 0, eligible: 0, booked: 0, bookedRatePct: 0, error: e?.message });
      }
    }
    const strict = {
      windowStart: startDate, windowEnd: endDate,
      computedAt: new Date().toISOString(),
      classifier: 'claude_strict' as const,
      shops: out,
      chain: { eligible: totalElig, booked: totalBooked, bookedRatePct: totalElig ? Math.round((totalBooked / totalElig) * 1000) / 10 : 0 },
    };
    await writeCache('booked_rate_wtd_strict', strict);
    const strictWtd = {
      windowStart: mondayDate, windowEnd: endDate,
      computedAt: new Date().toISOString(),
      classifier: 'claude_strict' as const,
      shops: outWtd,
      chain: { eligible: totalEligWtd, booked: totalBookedWtd, bookedRatePct: totalEligWtd ? Math.round((totalBookedWtd / totalEligWtd) * 1000) / 10 : 0 },
    };
    await writeCache('booked_rate_week_to_date_strict', strictWtd);
    await writeCache('hb_whatconverts', { eligible: totalElig, booked: totalBooked });
    return { message: `strict booked-rate: trailing7 ${totalBooked}/${totalElig} · wtd ${totalBookedWtd}/${totalEligWtd} across ${shops.length} shops` };
  },
};

// Missed Conversion Callbacks — per-shop round-robin. Splitting this out
// from refreshBookedRate prevents the chain-wide refresh from blowing the
// 300s function timeout when Claude scoring runs across all 8 shops in
// sequence. One shop per tick (~30-60s each); full chain covers in ~2h.
const MC_IDX_KEY = 'missed_callbacks_warm_idx';
export async function warmMissedCallbacksForShop(shopNum: string): Promise<string> {
  const num = shopNum as ShopNum;
  if (!SHOP_BY_NUM[num]) throw new Error(`unknown shop ${shopNum}`);
  const w = resolveRange('last_7_days');
  const startDate = w.startISO.slice(0, 10);
  const endDate = w.endISO.slice(0, 10);
  const leads = await fetchAllLeads({ shop: num, startDate, endDate });
  const eligible = leads.filter(isEligibleCall);
  // Re-classify here (small Claude pass) so we know which are not-booked
  // without depending on refreshBookedRate's intermediate state.
  const cls = await classifyBatch(eligible, 8);
  const notBooked = eligible.filter((l) => !cls.get(l.lead_id)?.appointment_booked);
  const salvageScores = await scoreSalvageabilityBatch(notBooked, 6);
  const calls = notBooked.map((l) => {
    const s = salvageScores.get(l.lead_id) ?? { probability: 0, reason: '', angle: '' };
    const transcript = l.call_transcription || '';
    return {
      leadId: l.lead_id,
      dateCreated: l.date_created,
      callerName: l.caller_name || l.contact_name || '',
      callerPhone: l.contact_phone_number || '',
      callerCity: l.caller_city,
      callerState: l.caller_state,
      callDurationSeconds: l.call_duration_seconds || 0,
      recording: l.recording || undefined,
      playRecording: l.play_recording || undefined,
      transcriptPreview: transcript.length > 1200 ? transcript.slice(0, 1200) + '…' : transcript,
      salesAgent: l.lead_analysis?.['Sales Agent'],
      sentimentDetection: l.lead_analysis?.['Sentiment Detection'],
      intentDetection: l.lead_analysis?.['Intent Detection'],
      customerType: l.lead_analysis?.['Customer Type'],
      wcSummary: l.lead_analysis?.['Lead Summary'],
      probability: s.probability,
      reason: s.reason,
      angle: s.angle,
    };
  });
  // Shop's last-7-day ARO — used to monetize "estimated missed revenue" per
  // salvageable call (probability × ARO). Re-uses already-cached ROs via
  // rosForShop. Failure is non-fatal; the cache stores 0 and the UI shows "—".
  let shopAro = 0;
  try {
    const shopMeta = SHOP_BY_NUM[num];
    const shopIds = [shopMeta.tekmetricId, ...(shopMeta.tekmetricIdSecondary && !shopMeta.tekmetricIdSecondaryFleetOnly ? [shopMeta.tekmetricIdSecondary] : [])];
    const ros = [];
    for (const id of shopIds) {
      ros.push(...(await rosForShop(id, { startISO: w.startISO, endISO: w.endISO })));
    }
    const kpi = chainKpi(ros);
    const row = kpi.byShop.find(s => s.shopNum === num);
    if (row && row.aro > 0) shopAro = row.aro;
  } catch (e) {
    console.error(`[warm-missed-callbacks] shop ${num} ARO fetch failed:`, e);
  }
  const shopCache: MissedCallbacksShopCache = {
    shopNum: num,
    shopName: SHOP_BY_NUM[num].name,
    computedAt: new Date().toISOString(),
    windowStart: startDate,
    windowEnd: endDate,
    shopAro,
    calls,
  };
  await writeCache(MISSED_CALLBACKS_KEY(num), shopCache);
  const salvageable = calls.filter(c => c.probability >= 0.3).length;
  // Auto-reopen: any lead still in this warm pass whose "resolved" stamp is
  // older than 12h was a premature click — the customer didn't actually
  // book (we'd have classified them as booked and dropped them otherwise).
  // Resurface so the manager sees the lead again tomorrow.
  const reopened = await reopenStaleResolutions(calls.map(c => c.leadId));
  return `shop ${num} (${SHOP_BY_NUM[num].name}) — ${calls.length} not-booked eligible · ${salvageable} salvageable · shop ARO $${shopAro.toFixed(0)}${reopened.length ? ` · ${reopened.length} stale resolutions reopened` : ''}`;
}

const warmMissedCallbacks: SyncJob = {
  name: 'warm-missed-callbacks',
  isEnabled: () => !!process.env.ANTHROPIC_API_KEY && !!process.env.WHATCONVERTS_001,
  async run() {
    const idx = (await readCache<number>(MC_IDX_KEY)) ?? 0;
    const shop = SHOPS[idx % SHOPS.length];
    await writeCache(MC_IDX_KEY, (idx + 1) % SHOPS.length);
    return { message: await warmMissedCallbacksForShop(shop.num) };
  },
};

// Declined Jobs — Tekmetric jobs the customer did NOT authorize that are
// now > 30 days stale. Lookback is the current calendar year (Jan 1 of
// `now`'s year through today, MT) — the queue auto-resets each January.
// Round-robin one shop per cron tick. Cache shape lives in
// lib/handlers/declinedJobs.ts.
const DJ_IDX_KEY = 'declined_jobs_warm_idx';
const DECLINED_MIN_AGE_DAYS = 30;
const DECLINED_CACHE_CAP = 200;
const DECLINED_MIN_SUBTOTAL = 25;   // $25 — filter out tiny accessory line items

export async function warmDeclinedJobsForShop(shopNum: string): Promise<string> {
  const shop = SHOPS.find(s => s.num === shopNum);
  if (!shop) throw new Error(`unknown shop ${shopNum}`);

  const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
  const lookbackStart = startOfYear(nowMtn);   // Jan 1 (current year) in MT
  const cutoffOld    = addDays(nowMtn, -DECLINED_MIN_AGE_DAYS);
  const startISO = fromZonedTime(lookbackStart, CHAIN_TZ).toISOString();
  const endISO   = fromZonedTime(nowMtn, CHAIN_TZ).toISOString();
  const cutoffOldMs = fromZonedTime(cutoffOld, CHAIN_TZ).getTime();

  const shopIds = [shop.tekmetricId, ...(shop.tekmetricIdSecondary && !shop.tekmetricIdSecondaryFleetOnly ? [shop.tekmetricIdSecondary] : [])];
  const ros: any[] = [];
  for (const id of shopIds) {
    ros.push(...(await rosForShop(id, { startISO, endISO })));
  }

  // Walk ROs → declined jobs. Filter:
  //   - RO posted > 30d ago (gives the customer time to drive on it)
  //   - Job not authorized
  //   - Subtotal at least $25 (skip noise like air freshener / wiper add-ons)
  //   - RO not excluded (USPS etc) and in counted statuses
  type Item = { jobId: number; roId: number; customerId: number; jobName: string; jobSubtotal: number; declinedDate: string };
  const items: Item[] = [];
  for (const o of ros) {
    if (!o.customerId) continue;
    if (!isCountedRO(o)) continue;
    if (!o.postedDate) continue;
    const postedMs = new Date(o.postedDate).getTime();
    if (!Number.isFinite(postedMs) || postedMs >= cutoffOldMs) continue;
    for (const j of (o.jobs || [])) {
      if (j.authorized) continue;
      const subtotalDollars = c2d(j.subtotal || 0);
      if (subtotalDollars < DECLINED_MIN_SUBTOTAL) continue;
      items.push({
        jobId: j.id,
        roId: o.id,
        customerId: o.customerId,
        jobName: (j.name || '').slice(0, 200) || `Job #${j.id}`,
        jobSubtotal: subtotalDollars,
        declinedDate: o.postedDate,
      });
    }
  }

  // Newest declined first; cap so single warm payload stays bounded.
  items.sort((a, b) => (b.declinedDate || '').localeCompare(a.declinedDate || ''));
  const capped = items.slice(0, DECLINED_CACHE_CAP);

  // Customer contact lookup is cached durably; only the top-N most-recent
  // customers are live-fetched per warm so we don't hammer Tekmetric.
  const custIds = Array.from(new Set(capped.map(i => i.customerId)));
  const contacts = await resolveCustomerContacts(custIds, 80);

  const jobs = capped.map(i => ({
    jobId: i.jobId,
    roId: i.roId,
    customerId: i.customerId,
    customerName: contacts.get(i.customerId)?.name || `Account #${i.customerId}`,
    phone: contacts.get(i.customerId)?.phone,
    jobName: i.jobName,
    jobSubtotal: i.jobSubtotal,
    declinedDate: i.declinedDate,
  }));

  const payload: DeclinedJobsShopCache = {
    shopNum: shop.num,
    shopName: shop.name,
    shopId: shop.tekmetricId,
    computedAt: new Date().toISOString(),
    windowStart: startISO.slice(0, 10),
    windowEnd: endISO.slice(0, 10),
    jobs,
  };
  await writeCache(DECLINED_JOBS_KEY(shop.num), payload);
  const dollarsAtStake = jobs.reduce((s, j) => s + j.jobSubtotal, 0);
  // Auto-reopen: jobs still showing up in the warm pass (authorized=false,
  // > 30d old) whose "won" stamp is older than 12h were a premature click.
  // The customer still hasn't authorized; resurface tomorrow.
  const reopened = await reopenStaleDeclinedJobResolutions(jobs.map(j => j.jobId));
  return `shop ${shop.num} (${shop.name}) — ${jobs.length} declined jobs > 30d (capped at ${DECLINED_CACHE_CAP}) · $${dollarsAtStake.toFixed(0)} at stake${reopened.length ? ` · ${reopened.length} stale resolutions reopened` : ''}`;
}

const warmDeclinedJobs: SyncJob = {
  name: 'warm-declined-jobs',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    const idx = (await readCache<number>(DJ_IDX_KEY)) ?? 0;
    const shop = SHOPS[idx % SHOPS.length];
    await writeCache(DJ_IDX_KEY, (idx + 1) % SHOPS.length);
    return { message: await warmDeclinedJobsForShop(shop.num) };
  },
};

// Daily Accounts-Receivable snapshot. Tekmetric has no historical AR endpoint,
// so we capture one point per day AFTER close of business (≥7pm MT) and the AR
// trend chart builds forward from these. Idempotent: at most one snapshot per
// calendar day; also resolves AR customer names so the live AR view is fast.
const snapshotAR: SyncJob = {
  name: 'snapshot-ar-daily',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
    const date = nowMtn.toISOString().slice(0, 10);
    if (nowMtn.getHours() < 19) return { message: `before close (MT ${nowMtn.getHours()}h) — AR snapshot deferred` };
    if (await hasSnapshot(date)) return { message: `AR snapshot for ${date} already captured` };
    // Trailing 24-month lookback (matches the live AR handler) so the nightly
    // snapshot captures aged receivables, not just this calendar year.
    const arStart = (() => { const d = new Date(date + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 24); return d.toISOString().slice(0, 10); })();
    const w = customRange(arStart, date);
    const ros = await rosForChain({ startISO: w.startISO, endISO: w.endISO });
    const totals = snapshotTotals(ros);
    await writeSnapshot({ date, total: totals.total, over30: totals.over30, new: totals.new });
    // Pre-resolve AR customer names so the live view never blocks on them.
    const ids = Array.from(new Set(ros.filter(isAR).map((o) => o.customerId)));
    await resolveCustomerNames(ids, 200);
    // Durable per-mode current-AR snapshot — the page serves THIS, so it never
    // cold-pulls the YTD window. Names are already resolved above, so the
    // per-mode builds hit the durable name cache.
    for (const m of ['over30', 'new', 'total'] as ARMode[]) {
      await writeCache(AR_CURRENT_KEY(m), await currentARFromRos(ros, m));
    }
    return { message: `AR snapshot ${date}: total $${totals.total.toLocaleString()}, >30 $${totals.over30.toLocaleString()} (${ids.length} customers); durable current-AR written for 3 modes` };
  },
};

// Weekly metric snapshot — captures rebook %, conversion %, and Google rating
// for the CURRENT week into a durable per-week row. These three can't be
// reconstructed from Tekmetric after the fact (see lib/metricSnapshots.ts), so
// we accumulate them forward. Cheap: reads the already-warm week-to-date
// caches and writes one row. Overwrites the current week's row each run, so
// the row finalizes when the week ends and is robust to missed ticks.
const snapshotWeeklyMetrics: SyncJob = {
  name: 'snapshot-weekly-metrics',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
    const weekStart = startOfWeek(nowMtn, { weekStartsOn: 1 }).toISOString().slice(0, 10);

    const rebook: Record<string, number> = {};
    const conversion: Record<string, number> = {};
    const rating: Record<string, number> = {};

    // Rebook %: from the per-shop week-to-date FBR caches.
    for (const s of SHOPS) {
      const fb = await readCache<any>(FBR_SHOP_WTD_KEY(s.num));
      if (fb?.fbr && typeof fb.fbr.fbrPct === 'number') {
        rebook[s.num] = Math.round(fb.fbr.fbrPct * 1000) / 10;
      }
    }
    // Conversion %: from the week-to-date strict booked-rate cache.
    // Guard: refreshBookedRate uses Central Time (TEKMETRIC_REPORT_TZ) while
    // this job uses Mountain Time. During the ~1h window when Central is already
    // Monday but Mountain is still Sunday, the WTD cache's windowStart is the
    // NEW week — if we used those zeros we'd freeze 0% as the final value for
    // the just-closed week. Only pull conversion when the cache's week matches.
    const br = await readCache<any>('booked_rate_week_to_date_strict');
    if (br?.windowStart === weekStart) {
      for (const sh of (br?.shops || [])) {
        if (typeof sh.bookedRatePct === 'number') conversion[sh.shopNum] = sh.bookedRatePct;
      }
    }
    // Google rating: current cumulative rating per shop (point-in-time).
    const gr = await readCache<GoogleRatingsPayload>(GOOGLE_RATINGS_CACHE_KEY);
    for (const sh of (gr?.shops || [])) {
      if (typeof sh.rating === 'number' && sh.rating != null) rating[sh.shopNum] = sh.rating;
    }

    // Preserve any values already captured this week if a source is
    // momentarily cold (don't overwrite good data with blanks). For conversion,
    // also guard against overwriting a good non-zero value with zero — the WTD
    // cache can momentarily return 0 during a refresh cycle.
    const prev = await readMetricSnapshot(weekStart);
    const mergedConversion: Record<string, number> = { ...(prev?.conversion || {}) };
    for (const [shop, pct] of Object.entries(conversion)) {
      const prevPct = mergedConversion[shop];
      if (pct > 0 || prevPct === undefined) mergedConversion[shop] = pct;
    }
    const snap: WeeklyMetricSnapshot = {
      weekStart,
      capturedAt: new Date().toISOString(),
      rebook: { ...(prev?.rebook || {}), ...rebook },
      conversion: mergedConversion,
      rating: { ...(prev?.rating || {}), ...rating },
    };
    await writeMetricSnapshot(snap);
    return {
      message: `weekly metric snapshot ${weekStart}: rebook ${Object.keys(snap.rebook).length}/${SHOPS.length} · conv ${Object.keys(snap.conversion).length}/${SHOPS.length} · rating ${Object.keys(snap.rating).length}/${SHOPS.length} shops`,
    };
  },
};

// Weekend "settled re-pull": once a week is closed, re-pull it fresh (late
// edits/refunds have settled) and freeze it as the authoritative weekly
// number. Runs Sat/Sun after close; re-pulls the just-closed week + the two
// prior non-frozen weeks (adjustments can trickle in for a couple weeks);
// once per calendar day so the 15-min cron doesn't repeat it.
const reconcileWeekly: SyncJob = {
  name: 'reconcile-weekly-settled',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
    const dow = nowMtn.getDay(); // 0 Sun, 6 Sat (MT wall clock)
    if (!((dow === 0 || dow === 6) && nowMtn.getHours() >= 19)) {
      return { message: `not weekend-after-close (MT day ${dow} ${nowMtn.getHours()}h) — skipped` };
    }
    const today = nowMtn.toISOString().slice(0, 10);
    if (await readCache(`settled_run_${today}`)) {
      return { message: `weekly settle already ran ${today}` };
    }
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    // Monday of the week that contains "now" (this week ends tonight, Sun).
    const thisMon = startOfWeek(nowMtn, { weekStartsOn: 1 });
    const settled: string[] = [];
    for (let back = 0; back < 3; back++) {
      const mon = addDays(thisMon, -7 * back);
      const sun = addDays(mon, 6);
      const weekStart = ymd(mon);
      const weekEnd = ymd(sun);
      const ageDays = (nowMtn.getTime() - sun.getTime()) / 86_400_000;
      const prev = await getSettledWeek(weekStart);
      if (prev && ageDays > FREEZE_AFTER_DAYS) continue; // frozen — leave as-is
      const w = customRange(weekStart, weekEnd);
      const ros = await rosForChain({ startISO: w.startISO, endISO: w.endISO });
      const k = chainKpi(ros);
      const perShop: Record<string, number> = {};
      for (const s of k.byShop) perShop[s.shopNum] = Math.round(s.revenue);
      await writeSettledWeek({
        weekStart, weekEnd,
        chainRevenue: Math.round(k.totalRevenue),
        perShop,
        computedAt: new Date().toISOString(),
        repulls: (prev?.repulls ?? 0) + 1,
      });
      // Backfill the projection learning store for this just-closed week —
      // free, since we already have the settled per-shop revenue in hand.
      try {
        const r = await backfillWeeklyActuals(weekStart, perShop);
        if (r.updated > 0) settled.push(`${weekStart}: actuals filled ${r.updated} log rows`);
      } catch (e) { console.warn('[reconcile] backfillWeeklyActuals failed:', (e as any)?.message); }
      settled.push(`${weekStart}:$${Math.round(k.totalRevenue).toLocaleString()}`);
    }
    await writeCache(`settled_run_${today}`, true);
    return { message: `settled ${settled.length} week(s): ${settled.join(', ') || 'none (all frozen)'}` };
  },
};

// Round-robin warm of `proj_appts_<shopId>_<weekStart>` so the projection
// handler (v2's bookedAppts input) can read from cache instead of doing an
// 8-shop parallel live fetch per request (which 504'd at 60s). One shop per
// tick keeps Tekmetric load light; full chain refresh every ~8 ticks (~2h).
const PROJ_APPTS_IDX_KEY = 'proj_appts_warm_idx';
const warmProjectionAppts: SyncJob = {
  name: 'warm-projection-appts',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
    const ws = startOfWeek(nowMtn, { weekStartsOn: 1 });
    const we = endOfWeek(nowMtn, { weekStartsOn: 1 });
    const wkYmd = ws.toISOString().slice(0, 10);
    const idx = (await readCache<number>(PROJ_APPTS_IDX_KEY)) ?? 0;
    const shop = SHOPS[idx % SHOPS.length];
    await writeCache(PROJ_APPTS_IDX_KEY, (idx + 1) % SHOPS.length);
    const appts = await fetchAllAppointments({
      shopId: shop.tekmetricId,
      startTimeFrom: fromZonedTime(ws, CHAIN_TZ).toISOString(),
      startTimeTo: fromZonedTime(we, CHAIN_TZ).toISOString(),
    });
    await writeCache(`proj_appts_${shop.tekmetricId}_${wkYmd}`, appts);
    return { message: `proj-appts warmed shop ${shop.num} (${shop.name}) — ${appts.length} appts for week ${wkYmd}` };
  },
};

// Round-robin warm of `return_customers_shop_<num>`. Each tick fetches one
// shop's 18-month posted-RO history (heavy — round-robin, not parallel — to
// avoid 429s) and computes every Return-Customers + Churn metric from it.
//
// We bypass rosForShop's per-window cache here because an 18mo RO blob is
// large (~30 MB per shop) and rotating new cache keys daily would blow past
// Upstash's free-tier ceiling. Only the AGGREGATED result lives in cache.
//
// After ~8 ticks (~2h) every shop is populated; the leaderboard endpoint reads
// the per-shop keys only and never triggers a live fetch.
const RC_IDX_KEY = 'return_customers_warm_idx';

// Exported helper so an operator can target a specific shop out of band (see
// /api/cron/run-syncs?job=warm-return-customers&shop=NNN). The scheduled
// cron still does one shop per tick via round-robin.
export async function warmReturnCustomersForShop(shopNum: string): Promise<string> {
  const shop = SHOP_BY_NUM[shopNum as ShopNum];
  if (!shop) throw new Error(`unknown shop ${shopNum}`);
  const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
  const eighteenMoStart = addMonths(nowMtn, -18);
  const twelveMoStart   = addMonths(nowMtn, -12);
  const sevenDayStart   = addDays(nowMtn, -7);
  const weekStartMtn    = startOfWeek(nowMtn, { weekStartsOn: 1 });

  const eighteenMoStartISO = fromZonedTime(eighteenMoStart, CHAIN_TZ).toISOString();
  const endISO             = fromZonedTime(nowMtn, CHAIN_TZ).toISOString();
  const eighteenMoStartMs  = fromZonedTime(eighteenMoStart, CHAIN_TZ).getTime();
  const twelveMoStartMs    = fromZonedTime(twelveMoStart, CHAIN_TZ).getTime();
  const sevenDayStartMs    = fromZonedTime(sevenDayStart, CHAIN_TZ).getTime();
  const weekStartMs        = fromZonedTime(weekStartMtn, CHAIN_TZ).getTime();

  const shopIds = [shop.tekmetricId, ...(shop.tekmetricIdSecondary && !shop.tekmetricIdSecondaryFleetOnly ? [shop.tekmetricIdSecondary] : [])];
  const ros: RepairOrder[] = [];
  for (const id of shopIds) {
    ros.push(...(await fetchAllRepairOrders({
      shopId: id,
      postedDateStart: eighteenMoStartISO,
      postedDateEnd: endISO,
    })));
  }

  const visitsByCustomer = new Map<number, number[]>();
  for (const o of ros) {
    if (!isCountedRO(o)) continue;
    if (!o.customerId) continue;
    const t = o.postedDate ? new Date(o.postedDate).getTime() : 0;
    if (!t) continue;
    const arr = visitsByCustomer.get(o.customerId) ?? [];
    arr.push(t);
    visitsByCustomer.set(o.customerId, arr);
  }

  // USPS / post-office filter. The hard-coded EXCLUDED_CUSTOMER_IDS only
  // covers the two Yuma primary accounts; USPS holds additional accounts at
  // other shops with different IDs. We resolve customer names cache-first
  // with a small live-fetch cap, sorted by visit count desc so the largest
  // fleet contracts are caught first. Cap kept low (25) to stay well inside
  // the 300s function budget — Tekmetric 429s + retries can balloon each
  // lookup to several seconds. Names not yet cached and below the live-fetch
  // cap remain in the dataset until the next warm or the daily AR snapshot
  // (which writes the same name cache) catches them. Wrapped in try/catch so
  // a name-resolution failure never breaks the underlying warm.
  const idsByVisitsDesc = Array.from(visitsByCustomer.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id]) => id);
  const droppedIds: number[] = [];
  try {
    const names = await resolveCustomerNames(idsByVisitsDesc, 25);
    for (const id of idsByVisitsDesc) {
      const name = names.get(id);
      if (name && isPostOfficeName(name)) {
        droppedIds.push(id);
        visitsByCustomer.delete(id);
      }
    }
    if (droppedIds.length > 0) {
      console.log(`[return-customers] shop ${shop.num} dropped ${droppedIds.length} USPS/post-office accounts: ${droppedIds.join(', ')}`);
    }
  } catch (e: any) {
    console.warn(`[return-customers] shop ${shop.num} name-resolution failed (skipping USPS filter): ${e?.message || e}`);
  }

  let returns7d = 0, total7d = 0;
  let returnsWtd = 0, totalWtd = 0;
  let returns12mo = 0, total12mo = 0;
  let returningVisitSum = 0;
  let previouslyActive = 0, churned = 0;

  for (const [, times] of visitsByCustomer) {
    const visitsLast12 = times.filter(t => t >= twelveMoStartMs);
    const visitsLast12Count = visitsLast12.length;
    const inLast7 = times.some(t => t >= sevenDayStartMs);
    const inThisWeek = times.some(t => t >= weekStartMs);
    const inPrior6 = times.some(t => t >= eighteenMoStartMs && t < twelveMoStartMs);

    if (inLast7) {
      total7d++;
      if (times.some(t => t < sevenDayStartMs)) returns7d++;
    }
    if (inThisWeek) {
      totalWtd++;
      if (times.some(t => t < weekStartMs)) returnsWtd++;
    }
    if (visitsLast12Count > 0) {
      total12mo++;
      if (visitsLast12Count >= 2) {
        returns12mo++;
        returningVisitSum += visitsLast12Count;
      }
    }
    if (inPrior6) {
      previouslyActive++;
      if (visitsLast12Count === 0) churned++;
    }
  }

  const payload: ReturnCustomersShop = {
    shopNum: shop.num,
    shopName: shop.name,
    returns7d,
    total7d,
    return7dPct: total7d ? returns7d / total7d : 0,
    returnsWtd,
    totalWtd,
    returnWtdPct: totalWtd ? returnsWtd / totalWtd : 0,
    returns12mo,
    total12mo,
    return12moPct: total12mo ? returns12mo / total12mo : 0,
    avgVisitsPerYearReturning: returns12mo ? returningVisitSum / returns12mo : 0,
    previouslyActive,
    churned,
    churnPct: previouslyActive ? churned / previouslyActive : 0,
    computedAt: new Date().toISOString(),
  };
  await writeCache(RC_SHOP_KEY(shop.num), payload);
  const dropTag = droppedIds.length > 0 ? ` · usps-dropped: ${droppedIds.length}` : '';
  return `shop ${shop.num} (${shop.name}) — 7d: ${(payload.return7dPct * 100).toFixed(1)}% · wtd: ${(payload.returnWtdPct * 100).toFixed(1)}% · 12mo: ${returns12mo}/${total12mo} (${(payload.return12moPct * 100).toFixed(1)}%) · avgVisits/yr: ${payload.avgVisitsPerYearReturning.toFixed(2)} · churn: ${churned}/${previouslyActive} (${(payload.churnPct * 100).toFixed(1)}%)${dropTag}`;
}

const warmReturnCustomers: SyncJob = {
  name: 'warm-return-customers',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    const idx = (await readCache<number>(RC_IDX_KEY)) ?? 0;
    const shop = SHOPS[idx % SHOPS.length];
    await writeCache(RC_IDX_KEY, (idx + 1) % SHOPS.length);
    const msg = await warmReturnCustomersForShop(shop.num);
    return { message: `return-customers warmed ${msg}` };
  },
};

// Google Ratings — once per day, very early MT. Places API "Place Details
// (Atmosphere)" is the priciest Places SKU we touch; calling it on every
// cache miss adds up. Reviews barely move day-to-day, so a single
// snapshot per 24h is plenty.
//
// Gate: only fires in the 3 AM MT hour AND only if the existing cache is
// not from today (MT). If the 3 AM window is missed (cron outage,
// Vercel build queue, etc.), the next 3 AM tick picks it back up — the
// UI keeps serving yesterday's snapshot from KV in the meantime.
const warmGoogleRatings: SyncJob = {
  name: 'warm-google-ratings',
  isEnabled: () => !!process.env.GOOGLE_PLACES_API_KEY,
  async run() {
    const nowMtn = toZonedTime(new Date(), CHAIN_TZ);
    if (nowMtn.getHours() !== 3) {
      return { message: `skipped — only runs 3-4 AM MT (currently ${nowMtn.getHours().toString().padStart(2, '0')}:${nowMtn.getMinutes().toString().padStart(2, '0')} MT)` };
    }
    const cached = await readCache<GoogleRatingsPayload>(GOOGLE_RATINGS_CACHE_KEY);
    if (cached?.computedAt) {
      const cachedMtn = toZonedTime(new Date(cached.computedAt), CHAIN_TZ);
      if (cachedMtn.toDateString() === nowMtn.toDateString()) {
        return { message: `skipped — already warmed today (${cached.computedAt})` };
      }
    }
    const payload = await refreshGoogleRatings();
    const withRating = payload.shops.filter(s => s.rating !== null).length;
    return { message: `warmed ${payload.shops.length} shops · ${withRating} with cumulative rating` };
  },
};

// Pre-warm the parts-matrix-usage cache for the default date range (last 7
// days, mode=all). This is the range the Parts Pricing page requests on first
// load, so pre-warming it means the user hits Redis instead of waiting 15-30s
// for Tekmetric to respond across all 8 shops.
//
// Exported so an operator can trigger a specific range via the admin route:
// POST /api/cron/run-syncs?job=warm-parts-matrix[&start=YYYY-MM-DD&end=YYYY-MM-DD&mode=all]
export async function warmPartsMatrixRange(startYmd: string, endYmd: string, mode = 'all'): Promise<string> {
  const cacheKey = `parts_matrix_usage_all_${startYmd}_${endYmd}_${mode}`;
  const startISO = `${startYmd}T00:00:00Z`;
  const endISO   = `${endYmd}T23:59:59Z`;
  const CLOSED = new Set(['POSTED', 'ACCRECV', 'INVOICED', 'CLOSED']);

  const lines: any[] = [];
  await Promise.all(SHOPS.map(async (shop) => {
    try {
      let ros: any[];
      if (mode === 'posted') {
        ros = await fetchAllRepairOrders({ shopId: shop.tekmetricId, postedDateStart: startISO, postedDateEnd: endISO });
      } else if (mode === 'open') {
        const all = await fetchROsByCreatedDate(shop.tekmetricId, startISO, endISO);
        ros = all.filter((ro: any) => {
          const s = (ro.repairOrderStatus as any)?.code ?? String(ro.repairOrderStatus ?? '');
          return !CLOSED.has(s);
        });
      } else {
        ros = await fetchROsByCreatedDate(shop.tekmetricId, startISO, endISO);
      }
      for (const ro of ros) {
        const roDate = ro.postedDate ?? ro.createdDate ?? null;
        const roStatus = (ro.repairOrderStatus as any)?.code ?? String(ro.repairOrderStatus ?? 'UNKNOWN');
        for (const job of (ro.jobs ?? [])) {
          if (!job.parts?.length) continue;
          for (let partIdx = 0; partIdx < job.parts.length; partIdx++) {
            const part = job.parts[partIdx];
            const costCents   = part.cost ?? 0;
            const retailCents = part.retail ?? 0;
            const pricingType = classifyPricing(costCents, retailCents, job.cannedJobId ?? null);
            const matrixCents = matrixRetail(costCents);
            lines.push({
              id: `pm_${ro.id}_${job.id}_${partIdx}`,
              roId: ro.id, roNumber: ro.repairOrderNumber,
              shopNum: shop.num, shopName: shop.name,
              roStatus, roDate,
              jobId: job.id, jobName: job.name, cannedJobId: job.cannedJobId ?? null,
              partName: part.name, partNumber: part.partNumber ?? '',
              brand: part.brand ?? '', qty: part.quantity ?? 1,
              costCents, retailCents, matrixCents,
              varianceCents: retailCents - matrixCents,
              pricingType,
            });
          }
        }
      }
    } catch { /* skip shop on error; cron continues with remaining shops */ }
  }));

  const counts = { total: lines.length, canned: 0, matrix: 0, manual: 0, no_charge: 0 };
  let manualRevenueLostCents = 0;
  let manualRevenueGainedCents = 0;
  for (const l of lines) {
    (counts as any)[l.pricingType]++;
    if (l.pricingType === 'manual') {
      if (l.varianceCents < 0) manualRevenueLostCents += Math.abs(l.varianceCents);
      else manualRevenueGainedCents += l.varianceCents;
    }
  }
  const payload = { lines, summary: { ...counts, manualRevenueLostCents, manualRevenueGainedCents } };
  await writeCache(cacheKey, payload, { ttlSeconds: 2 * 60 * 60 });
  return `${startYmd}→${endYmd} mode=${mode}: ${lines.length} part lines`;
}

const warmPartsMatrix: SyncJob = {
  name: 'warm-parts-matrix',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    // Warm exactly the ranges the Parts Pricing page requests by default.
    // Cache key format: parts_matrix_usage_all_START_END_MODE — must match.
    // Page default: 'this_week' (Monday of current week → today).
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const end = fmt(now);
    // Monday of current week (JS getDay: 0=Sun, 6=Sat)
    const dow = now.getDay() || 7;
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1 - dow);
    const start = fmt(mon);
    // Warm both posted (default on page, served from rosForShop cache) and all
    const msgPosted = await warmPartsMatrixRange(start, end, 'posted');
    const msgAll = await warmPartsMatrixRange(start, end, 'all');
    return { message: `parts-matrix warmed: ${msgPosted} | ${msgAll}` };
  },
};

// updateGoldenMango runs FIRST so the Friday 6 PM crowning lands within
// seconds of the boundary instead of waiting 3-5 min behind the slow
// refresh-booked-rate-strict (Claude classification) job. It reads cached
// FBR/missed-callbacks data from prior ticks — staleness up to one cron
// interval (15 min) is fine for a weekly summary, and the comment above
// updateGoldenMango about "must run AFTER warmFbr each tick" was overly
// strict given the cached-only data path it actually uses.
export const JOBS: SyncJob[] = [
  updateGoldenMango,
  warmTekmetric,
  refreshTechNames,
  warmFbr,
  warmProjectionAppts,
  warmPartsMatrix,
  warmReturnCustomers,
  refreshBookedRate,
  warmMissedCallbacks,
  warmDeclinedJobs,
  warmGoogleRatings,
  snapshotAR,
  snapshotWeeklyMetrics,
  reconcileWeekly,
];

export interface JobResult {
  name: string;
  status: 'ok' | 'skipped' | 'error';
  durationMs: number;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export async function runAllSyncs(opts: { only?: string[]; skip?: string[] } = {}): Promise<JobResult[]> {
  const results: JobResult[] = [];
  // Filter the job list so the sweep can be split across cron schedules.
  // `only` wins if provided (run exactly these); otherwise `skip` removes
  // the named jobs; otherwise run everything (default behaviour).
  const jobs = JOBS.filter(j => {
    if (opts.only && opts.only.length) return opts.only.includes(j.name);
    if (opts.skip && opts.skip.length) return !opts.skip.includes(j.name);
    return true;
  });
  for (const job of jobs) {
    const t0 = Date.now();
    if (!job.isEnabled()) {
      results.push({ name: job.name, status: 'skipped', durationMs: 0, message: 'disabled (env or feature gate)' });
      continue;
    }
    try {
      const r = await job.run();
      results.push({ name: job.name, status: 'ok', durationMs: Date.now() - t0, message: r.message, details: r.details });
    } catch (e: any) {
      results.push({ name: job.name, status: 'error', durationMs: Date.now() - t0, error: e?.message || String(e) });
    }
  }
  return results;
}
