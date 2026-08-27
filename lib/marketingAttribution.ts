// Phase 2 Marketing Attribution — unique-caller, RO-matched revenue attribution
//
// Strategy: fetch the full WhatConverts call history for the spend period,
// deduplicate by caller phone number (N calls from same number = 1 customer),
// classify each unique caller by marketing channel, look up the caller in
// Tekmetric by phone, then find their first RO within ATTR_WINDOW_DAYS of
// the first call and record ACTUAL revenue — not an estimated ARO.
//
// Key design choices:
//   - Dedup by phone: same number calling 10 times = 1 customer
//   - Attribution window: first call date → first RO within 60 days
//   - Month bucketing: by CALL month (when marketing happened)
//   - Revenue: actual RO totalSales in cents → dollars
//   - Organic channel: WC never sees GBP/Maps calls (shop uses real phone
//     number, not a WC tracking number). Organic = residual in the dashboard:
//     totalNC (Tekmetric) − RP − DM − GA (this cache).

import { fetchAllLeads, type Lead } from './whatconverts';
import { SHOPS } from './shops';
import type { ShopNum } from './shops';
import { writeCache, readCache } from './cache';
import { fetchROsByCreatedDate, searchCustomersByPhone, c2d } from './tekmetric';
import type { RepairOrder } from './tekmetric';

const ATTR_WINDOW_DAYS = 60;

// Months of WC history to pull. 3 months keeps the phone-lookup count manageable
// (~75 unique callers/shop vs ~300 for 12 months) and avoids Tekmetric rate-limit
// storms. The marketing dashboard only compares recent spend anyway.
const MONTHS_BACK = 3;

export const ATTRIBUTION_CACHE_KEY = 'marketing_attribution_v2';

export type Channel = 'google_ads' | 'direct_mail' | 'organic' | 'other';

// One row per unique caller per shop (deduped by phone number).
export interface MatchedCaller {
  shopNum: string;
  callMonth: string;       // YYYY-MM — month the first call happened
  channel: Channel;
  customerId: number | null;
  roId: number | null;
  revenue: number;         // actual RO totalSales in dollars (0 if no RO in window)
}

export interface ChannelData {
  customers: number;
  revenue: number;
}

export interface AttributionSummaryRow {
  shopNum: string;
  month: string;           // YYYY-MM
  google_ads: ChannelData;
  direct_mail: ChannelData;
  other: ChannelData;
}

export interface AttributionCache {
  v: 2;
  callers: MatchedCaller[];
  summary: AttributionSummaryRow[];
  computedAt: string;
}

// ── channel classifier ─────────────────────────────────────────────────────

function classifyChannel(lead: Lead): Channel {
  const src  = (lead.traffic_source   ?? '').toLowerCase();
  const med  = (lead.traffic_medium   ?? '').toLowerCase();
  const camp = (lead.traffic_campaign ?? '').toLowerCase();
  const type = (lead.traffic_type     ?? '').toLowerCase();

  // Direct mail / Upswell postcards (highest specificity — check first)
  if (type.includes('direct mail') || type.includes('direct_mail') ||
      camp.includes('postcard') || camp.includes('upswell') ||
      med.includes('direct_mail') || med.includes('directmail')) {
    return 'direct_mail';
  }

  // Google source
  if (src.includes('google')) {
    if (med === 'organic') return 'organic';
    return 'google_ads';  // any non-organic google source = paid
  }

  // Explicit paid traffic_type signals
  if (type.includes('paid') || type.includes('ppc') || type.includes('cpc') ||
      type.includes('google ads') || type.includes('lsa') || type.includes('local service')) {
    return 'google_ads';
  }

  // Explicit organic signals
  if (type.includes('organic') || med === 'organic') return 'organic';

  // Default: WC at Mango tracks Google Ads call-tracking numbers exclusively.
  // Every unclassified call came through a GA tracking number.
  return 'google_ads';
}

// ── phone normalization ────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '').slice(-10);
}

// ── concurrent pool helper ─────────────────────────────────────────────────

async function batchedMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i]); } catch { /* swallow */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ── per-shop processing ────────────────────────────────────────────────────

import type { Shop } from './shops';

async function processShop(
  shop: Shop,
  startDate: string,
  endDate: string,
  now: Date,
): Promise<MatchedCaller[]> {
  const effectiveStart = startDate > shop.openedAt! ? startDate : shop.openedAt!;
  console.log(`[attr-v2] ${shop.num} — WC fetch ${effectiveStart}→${endDate}`);

  // 1. Fetch WC leads
  let leads: Lead[];
  try {
    leads = await fetchAllLeads({
      shop: shop.num as ShopNum,
      startDate: effectiveStart,
      endDate,
      leadType: 'phone_call',
    });
  } catch (e) {
    console.error(`[attr-v2] ${shop.num} WC fetch failed:`, e);
    return [];
  }

  // 2. Deduplicate by phone — keep earliest call per number.
  // Minimal filter: not spam, has a valid phone number.
  // (call_duration_seconds is not reliably returned by WC's leads list endpoint)
  const sorted = leads
    .filter(lead =>
      !lead.spam &&
      (lead.contact_phone_number ?? '').replace(/\D/g, '').length >= 7
    )
    .sort((a, b) => a.date_created.localeCompare(b.date_created));

  const byPhone = new Map<string, { lead: Lead; channel: Channel }>();
  for (const lead of sorted) {
    const phone = normalizePhone(lead.contact_phone_number ?? '');
    if (phone.length < 7) continue;
    if (!byPhone.has(phone)) {
      byPhone.set(phone, { lead, channel: classifyChannel(lead) });
    }
  }

  console.log(`[attr-v2] ${shop.num} — ${byPhone.size} unique callers (${leads.length} raw leads)`);
  if (!byPhone.size) return [];

  // 3. Bulk-fetch ROs for the period → index by customerId
  const roWindowEnd = new Date(now.getTime() + ATTR_WINDOW_DAYS * 86_400_000)
    .toISOString().slice(0, 10);
  const rosByCustomer = new Map<number, RepairOrder[]>();
  try {
    const ros = await fetchROsByCreatedDate(shop.tekmetricId, effectiveStart, roWindowEnd);
    for (const ro of ros) {
      if (!rosByCustomer.has(ro.customerId)) rosByCustomer.set(ro.customerId, []);
      rosByCustomer.get(ro.customerId)!.push(ro);
    }
    console.log(`[attr-v2] ${shop.num} — ${ros.length} ROs indexed`);
  } catch (e) {
    console.error(`[attr-v2] ${shop.num} RO fetch failed — callers recorded without revenue:`, e);
  }

  // 4. Phone lookups — 5 concurrent, 3s hard timeout each.
  // Cap at MAX_CALLERS_PER_SHOP (oldest first) so each shop call completes
  // within the 600s Vercel/curl budget. Successful shops had 645–1087 callers
  // at ~2.7s per concurrent batch of 5; 800 × 3s / 5 = 480s worst-case.
  const MAX_CALLERS = 800;
  const LOOKUP_MS = 3_000;
  const entries = Array.from(byPhone.entries()).slice(0, MAX_CALLERS);
  if (byPhone.size > MAX_CALLERS) {
    console.log(`[attr-v2] ${shop.num} — capped at ${MAX_CALLERS} of ${byPhone.size} unique callers`);
  }
  const matched = await batchedMap(entries, async ([phone, { lead, channel }]) => {
    const firstCall = new Date(lead.date_created);
    const windowEnd = new Date(firstCall.getTime() + ATTR_WINDOW_DAYS * 86_400_000);
    const callMonth = lead.date_created.slice(0, 7);

    const customerId = await Promise.race([
      searchCustomersByPhone(shop.tekmetricId, phone),
      new Promise<null>(r => setTimeout(() => r(null), LOOKUP_MS)),
    ]);
    let roId: number | null = null;
    let revenue = 0;

    if (customerId !== null) {
      const firstRO = (rosByCustomer.get(customerId) ?? [])
        .filter(ro => { const d = new Date(ro.createdDate); return d >= firstCall && d <= windowEnd; })
        .sort((a, b) => a.createdDate.localeCompare(b.createdDate))[0];
      if (firstRO) { roId = firstRO.id; revenue = Math.round(c2d(firstRO.totalSales)); }
    }

    return { shopNum: shop.num, callMonth, channel, customerId, roId, revenue } as MatchedCaller;
  }, 5);

  const callers = matched.filter((c): c is MatchedCaller => c !== null);
  console.log(`[attr-v2] ${shop.num} — ${callers.length} matched callers`);
  return callers;
}

// ── main warm function ─────────────────────────────────────────────────────

export async function computeAndCacheAttribution(): Promise<AttributionCache> {
  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  const startD  = new Date(now);
  startD.setMonth(startD.getMonth() - MONTHS_BACK);
  startD.setDate(1);
  const startDate = startD.toISOString().slice(0, 10);

  // Process shops sequentially to stay within Tekmetric rate limits.
  // No per-shop timeout — the 4s per-lookup cap and 20s WC/15s TM fetch caps
  // already bound individual calls. 8 shops × ~60-80s each = ~8 min, under 750s.
  const allCallers: MatchedCaller[] = [];
  for (const shop of SHOPS.filter(s => s.openedAt)) {
    try {
      const callers = await processShop(shop, startDate, endDate, now);
      allCallers.push(...callers);
    } catch (e) {
      console.error('[attr-v2] shop processing failed:', e);
    }
  }

  // ── 5. Build monthly summary (only callers with a matched RO) ──────────
  const summaryMap = new Map<string, AttributionSummaryRow>();
  const getRow = (shopNum: string, month: string): AttributionSummaryRow => {
    const k = `${shopNum}|${month}`;
    if (!summaryMap.has(k)) summaryMap.set(k, {
      shopNum, month,
      google_ads:  { customers: 0, revenue: 0 },
      direct_mail: { customers: 0, revenue: 0 },
      other:       { customers: 0, revenue: 0 },
    });
    return summaryMap.get(k)!;
  };

  for (const c of allCallers) {
    if (c.roId === null) continue;  // only converted callers count
    const row = getRow(c.shopNum, c.callMonth);
    const slot = c.channel === 'google_ads'  ? 'google_ads'
               : c.channel === 'direct_mail' ? 'direct_mail'
               : 'other';
    row[slot].customers++;
    row[slot].revenue += c.revenue;
  }

  const cache: AttributionCache = {
    v: 2,
    callers: allCallers,
    summary: Array.from(summaryMap.values()),
    computedAt: new Date().toISOString(),
  };
  await writeCache(ATTRIBUTION_CACHE_KEY, cache);

  console.log(`[attr-v2] done — ${allCallers.length} callers, ${cache.summary.length} shop-month rows`);
  return cache;
}

export async function readAttributionCache(): Promise<AttributionCache | null> {
  const raw = await readCache<any>(ATTRIBUTION_CACHE_KEY);
  if (!raw || raw.v !== 2) return null;  // reject old v1 format
  return raw as AttributionCache;
}

// ── per-shop partial cache ─────────────────────────────────────────────────
// Used by the per-shop workflow: each shop writes its own partial key, then
// the aggregate step merges them into ATTRIBUTION_CACHE_KEY.

const partialCacheKey = (shopNum: string) => `marketing_attribution_v2_partial_${shopNum}`;

export async function computeAndCacheAttributionForShop(shopNum: string): Promise<{ callers: number }> {
  const shop = SHOPS.find(s => s.num === shopNum);
  if (!shop || !shop.openedAt) throw new Error(`Unknown or unopened shop ${shopNum}`);

  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  const startD = new Date(now);
  startD.setMonth(startD.getMonth() - MONTHS_BACK);
  startD.setDate(1);
  const startDate = startD.toISOString().slice(0, 10);

  const callers = await processShop(shop, startDate, endDate, now);
  await writeCache(partialCacheKey(shopNum), { v: 2, callers, computedAt: now.toISOString() });
  console.log(`[attr-v2] shop ${shopNum} partial cached — ${callers.length} callers`);
  return { callers: callers.length };
}

export async function aggregateAttributionShops(): Promise<AttributionCache> {
  const allCallers: MatchedCaller[] = [];

  for (const shop of SHOPS.filter(s => s.openedAt)) {
    const partial = await readCache<{ v: number; callers: MatchedCaller[] }>(partialCacheKey(shop.num));
    if (partial?.v === 2 && Array.isArray(partial.callers)) {
      allCallers.push(...partial.callers);
    } else {
      console.warn(`[attr-v2] no partial cache for shop ${shop.num} — skipping`);
    }
  }

  const summaryMap = new Map<string, AttributionSummaryRow>();
  const getRow = (shopNum: string, month: string): AttributionSummaryRow => {
    const k = `${shopNum}|${month}`;
    if (!summaryMap.has(k)) summaryMap.set(k, {
      shopNum, month,
      google_ads:  { customers: 0, revenue: 0 },
      direct_mail: { customers: 0, revenue: 0 },
      other:       { customers: 0, revenue: 0 },
    });
    return summaryMap.get(k)!;
  };

  for (const c of allCallers) {
    if (c.roId === null) continue;
    const row = getRow(c.shopNum, c.callMonth);
    const slot = c.channel === 'google_ads'  ? 'google_ads'
               : c.channel === 'direct_mail' ? 'direct_mail'
               : 'other';
    row[slot].customers++;
    row[slot].revenue += c.revenue;
  }

  const cache: AttributionCache = {
    v: 2,
    callers: allCallers,
    summary: Array.from(summaryMap.values()),
    computedAt: new Date().toISOString(),
  };
  await writeCache(ATTRIBUTION_CACHE_KEY, cache);
  console.log(`[attr-v2] aggregate done — ${allCallers.length} callers, ${cache.summary.length} shop-month rows`);
  return cache;
}
