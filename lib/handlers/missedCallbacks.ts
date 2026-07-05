// Missed Conversion Callbacks endpoint.
//
// Cache-only read (the AI scoring is too expensive to run on demand).
// Per-shop cache `missed_callbacks_<num>` is populated by refreshBookedRate
// every cron tick — same lead fetch, just adds salvageability scoring for
// non-booked eligible calls.
//
// On the read side we merge each per-call score with the manager's
// resolution state from `callback_resolution_<lead_id>` so an "resolved"
// stamp survives rescoring and cache rebuilds.

import { NextResponse } from 'next/server';
import { readCache } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';
import { readResolutions, type CallbackResolution } from '@/lib/callbackStore';
import { lookupTekmetricCustomerIdsByPhone } from '@/lib/ar';
import { tryWarmInBackground } from '@/lib/warmOnDemand';
import { warmMissedCallbacksForShop } from '@/lib/syncJobs';

export const MISSED_CALLBACKS_KEY = (num: string) => `missed_callbacks_${num}`;

// Per-call snapshot that the warm job writes. Kept narrow to limit per-shop
// payload size — we already have detailed transcripts in WhatConverts; the
// UI fetches the full transcript on demand if needed.
export interface MissedCallbackCall {
  leadId: number;
  dateCreated: string;
  callerName: string;
  callerPhone: string;
  callerCity?: string;
  callerState?: string;
  callDurationSeconds: number;
  recording?: string;             // direct audio URL — proxied server-side with WhatConverts auth
  playRecording?: string;         // WhatConverts player page (fallback when no direct URL)
  transcriptPreview: string;      // first 1200 chars; full transcript fetched on expand
  salesAgent?: string;            // WhatConverts lead_analysis 'Sales Agent'
  sentimentDetection?: string;
  intentDetection?: string;
  customerType?: string;
  wcSummary?: string;             // WhatConverts 'Lead Summary' — useful context

  // Claude scoring output
  probability: number;            // 0..1 salvageability
  reason: string;                 // why the call didn't convert
  angle: string;                  // suggested callback angle

  // Resolved at read time by handle() — Tekmetric customerId iff this
  // caller's phone matches an existing Tekmetric customer for the shop.
  // Absent for first-time callers and for entries whose lookup hasn't
  // completed yet (the per-request cap leaves some misses for next time).
  tekmetricCustomerId?: number;
}

export interface MissedCallbacksShopCache {
  shopNum: string;
  shopName: string;
  computedAt: string;
  windowStart: string;
  windowEnd: string;
  shopAro?: number;              // last-7d ARO at warm time, used to size missed revenue
  calls: MissedCallbackCall[];
}

// Response shape: per-shop array (with resolution state merged in) +
// chain-wide rollup metrics for the top stripe.
export interface MissedCallbacksResponse {
  shops: Array<{
    shopNum: string;
    shopName: string;
    computedAt: string | null;
    windowStart: string | null;
    windowEnd: string | null;
    calls: Array<MissedCallbackCall & { resolution: CallbackResolution | null; estimatedMissedRevenue: number }>;
    pending?: true;
  }>;
  chain: {
    totalSalvageable: number;
    estimatedMissedRevenue: number;
    resolvedCount: number;
    revenueRecovered: number;     // resolved × shop ARO; rough proxy until we attribute real ROs
    avgResponseTimeHours: number | null;
  };
  // Per-shop ARO used to convert probability → $ (read from /api/metrics cache).
  aroByShop: Record<string, number>;
}

const SALVAGEABLE_THRESHOLD = 0.3;

export async function handle() {
  // Per-shop ARO comes from the warm job (computed alongside the salvageability
  // scoring + persisted onto the per-shop cache). Previous attempt to read a
  // free-standing `metrics:last_7_days` cache key always returned null because
  // /api/metrics computes fresh per request and never writes that key — every
  // call ended up with estimatedMissedRevenue=0 → "—" in the UI.
  const aroByShop: Record<string, number> = {};

  const shopRows: MissedCallbacksResponse['shops'] = [];
  let chainTotalSalvageable = 0;
  let chainMissedRevenue = 0;
  let chainResolved = 0;
  let chainRevenueRecovered = 0;
  const responseTimes: number[] = [];          // hours from call → resolved

  for (const shop of SHOPS) {
    const cached = await readCache<MissedCallbacksShopCache>(MISSED_CALLBACKS_KEY(shop.num));
    if (!cached) {
      // Cache was evicted (or never warmed). Kick off a background warm
      // so the next poll gets fresh data — handler doesn't await it.
      void tryWarmInBackground('missed-callbacks', shop.num,
        () => warmMissedCallbacksForShop(shop.num));
      shopRows.push({
        shopNum: shop.num,
        shopName: shop.name,
        computedAt: null,
        windowStart: null,
        windowEnd: null,
        calls: [],
        pending: true,
      });
      continue;
    }
    const aro = cached.shopAro || 0;
    if (aro > 0) aroByShop[shop.num] = aro;
    // Filter to genuinely salvageable AND attach resolution + $ estimate.
    const salvageableCalls = cached.calls.filter(c => c.probability >= SALVAGEABLE_THRESHOLD);
    const resolutions = await readResolutions(salvageableCalls.map(c => c.leadId));
    const merged = salvageableCalls.map(c => {
      const r = resolutions.get(c.leadId) ?? null;
      // Expected-value $ — probability-weighted ARO. Conservative estimate.
      const estimatedMissedRevenue = aro > 0 ? aro * c.probability : 0;
      if (r?.status === 'resolved') {
        chainResolved++;
        chainRevenueRecovered += estimatedMissedRevenue;
        if (r.resolvedAt && c.dateCreated) {
          const hours = (new Date(r.resolvedAt).getTime() - new Date(c.dateCreated).getTime()) / 3_600_000;
          if (hours >= 0 && hours < 24 * 14) responseTimes.push(hours);
        }
      } else if (!r || r.status === 'open') {
        chainTotalSalvageable++;
        chainMissedRevenue += estimatedMissedRevenue;
      }
      // not_salvageable rows still show in queue (greyed) but don't roll up.
      return { ...c, resolution: r, estimatedMissedRevenue };
    });

    // Sort: open + high probability first; resolved/dismissed sink.
    merged.sort((a, b) => {
      const statusRank = (r: CallbackResolution | null) => r?.status === 'open' || !r ? 0 : r.status === 'resolved' ? 2 : 3;
      const sr = statusRank(a.resolution) - statusRank(b.resolution);
      if (sr !== 0) return sr;
      return b.probability - a.probability;
    });

    // Tekmetric customer-id lookup for OPEN salvageable calls only — done
    // ones are out of view, dismissed ones rarely re-engaged. Cached in KV
    // (hits + misses both) so repeat page loads stay fast. Per-request cap
    // inside the helper bounds live API load when a shop has many fresh
    // unresolved phones; unresolved ones get filled on the next request.
    if (shop.tekmetricId) {
      const openCalls = merged.filter(m => !m.resolution || m.resolution.status === 'open');
      const phoneList: string[] = [];
      const phoneByCallIdx = new Map<number, string>();
      openCalls.forEach((m, i) => {
        const raw = String(m.callerPhone || '');
        const digits = raw.replace(/\D/g, '');
        const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
        if (ten.length >= 10) {
          phoneList.push(ten);
          phoneByCallIdx.set(i, ten);
        }
      });
      const lookups = await lookupTekmetricCustomerIdsByPhone(shop.tekmetricId, phoneList);
      openCalls.forEach((m, i) => {
        const p = phoneByCallIdx.get(i);
        if (!p) return;
        const cid = lookups.get(p);
        if (cid) m.tekmetricCustomerId = cid;
      });
    }

    shopRows.push({
      shopNum: shop.num,
      shopName: shop.name,
      computedAt: cached.computedAt,
      windowStart: cached.windowStart,
      windowEnd: cached.windowEnd,
      calls: merged,
    });
  }

  const avgResponseTimeHours = responseTimes.length
    ? responseTimes.reduce((s, x) => s + x, 0) / responseTimes.length
    : null;

  const response: MissedCallbacksResponse = {
    shops: shopRows,
    chain: {
      totalSalvageable: chainTotalSalvageable,
      estimatedMissedRevenue: chainMissedRevenue,
      resolvedCount: chainResolved,
      revenueRecovered: chainRevenueRecovered,
      avgResponseTimeHours,
    },
    aroByShop,
  };
  return NextResponse.json(response);
}
