// RingCentral API client — replaces lib/whatconverts.ts as the source of
// call transcripts and recordings for all 8 shops.
//
// PHONE → SHOP MAPPING (no env vars needed):
// Phone numbers are auto-discovered from RingCentral's own /account/~/phone-number
// endpoint and matched to shops by the RC site name (case-insensitive substring
// match against shop names). The result is cached in Redis for 24 hours.
//
// If your RC site names don't match the shop names at all, you can override
// with a single env var:
//   RINGCENTRAL_PHONE_MAP={"001":"5055551234","002":"5058881234,5058885678"}
// (10-digit or E.164 numbers, comma-separated per shop)
//
// Required auth env vars:
//   RINGCENTRAL_CLIENT_ID
//   RINGCENTRAL_CLIENT_SECRET
//   RINGCENTRAL_JWT
//   RINGCENTRAL_SERVER  (optional; defaults to https://platform.ringcentral.com)

import type { Lead } from './whatconverts';
import { ShopNum, SHOP_BY_NUM, SHOPS } from './shops';
import { readCache, writeCache } from './cache';

const RC_BASE = process.env.RINGCENTRAL_SERVER ?? 'https://platform.ringcentral.com';

// --- JWT Bearer auth ---
// Token cached in-memory for the serverless function lifetime (~1 cron tick).

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

export async function getRCToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiresAt - 30_000) return _cachedToken;
  const clientId = process.env.RINGCENTRAL_CLIENT_ID;
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET;
  const jwt = process.env.RINGCENTRAL_JWT;
  if (!clientId || !clientSecret || !jwt) {
    throw new Error('RingCentral credentials not configured (need RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_JWT)');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(`${RC_BASE}/restapi/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
    cache: 'no-store',
  });
  if (!resp.ok) {
    throw new Error(`RC token request failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  _cachedToken = data.access_token;
  _tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return _cachedToken!;
}

// --- Helpers ---

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length >= 7 ? ten : null;
}

function matchSiteToShop(siteName: string): ShopNum | null {
  if (!siteName) return null;
  const lower = siteName.toLowerCase().trim();
  for (const shop of SHOPS) {
    const shopLower = shop.name.toLowerCase();
    if (lower === shopLower || lower.includes(shopLower) || shopLower.includes(lower)) {
      return shop.num;
    }
    if (shop.city && lower.includes(shop.city.toLowerCase())) {
      return shop.num;
    }
    // Word-level: any significant word (4+ chars) from the shop name appears in
    // the site name. Catches cases like "Heights Mia" → "The Heights" (shop 002).
    const shopWords = shopLower.split(/\s+/).filter(w => w.length >= 4);
    if (shopWords.length > 0 && shopWords.some(w => lower.includes(w))) {
      return shop.num;
    }
  }
  return null;
}

// Mango's RC extension numbering convention: the first TWO digits identify the shop.
// 11xxx → shop 001, 22xxx → shop 002, …, 77xxx → shop 007, 99xxx → shop 009.
// (Originally assumed 3 identical leading digits, but some lines use patterns like
// 44005 or 66007 where only the first two digits are the same.)
function shopFromExtensionNumber(extNum: string | null | undefined): ShopNum | null {
  if (!extNum || extNum.length < 2) return null;
  const d1 = extNum[0], d2 = extNum[1];
  if (d1 !== d2) return null;
  const digit = parseInt(d1, 10);
  if (isNaN(digit) || digit === 0 || digit === 8) return null;
  const shopNum = digit === 9 ? '009' : `00${digit}` as ShopNum;
  return SHOP_BY_NUM[shopNum] ? shopNum : null;
}

// --- Phone → shop map ---
// Priority 1: RINGCENTRAL_PHONE_MAP env var (explicit override)
// Priority 2: Redis-cached auto-discovered map (24h TTL)
// Priority 3: Live fetch from RC /account/~/phone-number

const RC_PHONE_MAP_KEY = 'rc_phone_shop_map';

async function buildPhoneShopMap(): Promise<Map<string, ShopNum>> {
  // Parse the explicit env var override (entries here take priority over auto-discovery,
  // but the env var is treated as a supplement — shops NOT covered by the env var still
  // get auto-discovered from RC. This fixes shops added after the env var was last updated).
  const envMap = new Map<string, ShopNum>();
  const envOverride = process.env.RINGCENTRAL_PHONE_MAP;
  if (envOverride) {
    try {
      const obj = JSON.parse(envOverride) as Record<string, string>;
      for (const [shopNum, nums] of Object.entries(obj)) {
        for (const ph of String(nums).split(',').map(s => s.trim())) {
          const ten = normalizePhone(ph);
          if (ten) envMap.set(ten, shopNum as ShopNum);
        }
      }
    } catch {
      console.warn('[rc] RINGCENTRAL_PHONE_MAP is set but could not be parsed as JSON — ignoring');
    }
  }

  // Always supplement the env var with RC auto-discovery — the env var may have
  // stale or incomplete numbers for some shops, and RC is the authoritative source.
  // The env var wins on any phone it explicitly lists; RC fills in everything else.
  const envCoveredShops = new Set(envMap.values());

  let discovered = new Map<string, ShopNum>();
  const cached = await readCache<Record<string, string>>(RC_PHONE_MAP_KEY);
  if (cached && Object.keys(cached).length > 0) {
    for (const [ten, num] of Object.entries(cached)) discovered.set(ten, num as ShopNum);
  } else {
    discovered = await fetchAndCachePhoneMap();
  }

  // Merge: env var entries win; discovered fills in anything not explicitly mapped.
  for (const [ten, shopNum] of discovered) {
    if (!envMap.has(ten)) envMap.set(ten, shopNum);
  }
  const coveredAfterMerge = new Set(envMap.values()).size;
  console.log(`[rc] phone map: ${envMap.size} numbers across ${coveredAfterMerge} shops (${envCoveredShops.size} explicit, ${coveredAfterMerge - envCoveredShops.size} auto-discovered)`);
  return envMap;
}

async function fetchAndCachePhoneMap(): Promise<Map<string, ShopNum>> {
  let token: string;
  try {
    token = await getRCToken();
  } catch (e: any) {
    console.error('[rc] cannot fetch phone map — token failed:', e?.message);
    return new Map();
  }

  const resp = await fetch(`${RC_BASE}/restapi/v1.0/account/~/phone-number?perPage=1000`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!resp.ok) {
    // Common cause: missing ReadAccounts scope on the RC app.
    // Callers will get empty attribution until the scope is added or
    // RINGCENTRAL_PHONE_MAP is set.
    console.error(`[rc] /phone-number failed (${resp.status}) — add ReadAccounts scope to your RC app, or set RINGCENTRAL_PHONE_MAP env var`);
    return new Map();
  }

  type RCPhoneRec = { phoneNumber?: string; label?: string; site?: { name?: string }; extension?: { extensionNumber?: string; name?: string; id?: number } };
  const data = await resp.json() as { records?: RCPhoneRec[] };
  const records = data.records ?? [];

  // For records that can't be matched via extension number or label, fetch the
  // RC extension detail which often has a descriptive name (e.g. "Heights Mia").
  const needsDetail = records.filter(rec => {
    const siteName = (rec.site?.name ?? rec.extension?.name ?? rec.label ?? '').trim();
    return !matchSiteToShop(siteName) && !shopFromExtensionNumber(rec.extension?.extensionNumber ?? null) && rec.extension?.id;
  });
  const extDetailMap = new Map<number, string>();
  await Promise.all(needsDetail.map(async rec => {
    const extId = rec.extension?.id;
    if (!extId) return;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10_000);
      const r = await fetch(`${RC_BASE}/restapi/v1.0/account/~/extension/${extId}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: ctrl.signal,
      }).finally(() => clearTimeout(tid));
      if (!r.ok) return;
      const d = await r.json() as { name?: string; site?: { name?: string } };
      const name = d.site?.name ?? d.name ?? '';
      if (name) extDetailMap.set(extId, name);
    } catch { /* best-effort */ }
  }));

  const map = new Map<string, ShopNum>();
  const toCache: Record<string, string> = {};
  const unmatched: string[] = [];

  for (const rec of records) {
    const extId = rec.extension?.id;
    const extDetailName = extId ? (extDetailMap.get(extId) ?? '') : '';
    const siteName = (rec.site?.name ?? rec.extension?.name ?? rec.label ?? extDetailName).trim();
    const shopNum = matchSiteToShop(siteName)
      ?? matchSiteToShop(extDetailName)
      ?? shopFromExtensionNumber(rec.extension?.extensionNumber ?? null);
    const ten = normalizePhone(rec.phoneNumber ?? '');
    if (!ten) continue;
    if (shopNum) {
      map.set(ten, shopNum);
      toCache[ten] = shopNum;
    } else if (siteName) {
      unmatched.push(`${ten} (site: "${siteName}")`);
    }
  }

  if (unmatched.length > 0) {
    console.warn(`[rc] ${unmatched.length} phone numbers could not be matched to a shop: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? '…' : ''}`);
  }
  console.log(`[rc] phone map: ${map.size} numbers matched across ${new Set(map.values()).size} shops`);

  if (map.size > 0) {
    await writeCache(RC_PHONE_MAP_KEY, toCache, { ttlSeconds: 24 * 60 * 60 });
  }
  return map;
}

// --- Phone map cache bust (call after fixing shopFromExtensionNumber) ---
export async function bustPhoneMapCache(): Promise<void> {
  // Writing an empty object invalidates the cache: buildPhoneShopMap skips
  // empty cached maps and falls through to a fresh live fetch.
  await writeCache(RC_PHONE_MAP_KEY, {}, { ttlSeconds: 1 });
}

// --- Diagnostic: expose raw RC phone number list for debugging shop matching ---
export async function debugPhoneMap(): Promise<{ records: Array<{ phone: string; site: string; extension: string; extensionName: string; extensionType: string; usageType: string; matchedShop: string | null; raw?: unknown }> }> {
  let token: string;
  try { token = await getRCToken(); } catch (e: any) {
    return { records: [{ phone: '', site: 'TOKEN ERROR: ' + e?.message, extension: '', extensionName: '', extensionType: '', usageType: '', matchedShop: null }] };
  }
  const resp = await fetch(`${RC_BASE}/restapi/v1.0/account/~/phone-number?perPage=1000`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  if (!resp.ok) {
    return { records: [{ phone: '', site: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`, extension: '', extensionName: '', extensionType: '', usageType: '', matchedShop: null }] };
  }
  const data = await resp.json() as { records?: Array<Record<string, unknown>> };

  // For unmatched numbers that have an extension ID, fetch the extension detail
  // to get the name/type which may reveal which shop they belong to.
  const unmatched = (data.records ?? []).filter(rec => {
    const ext = rec.extension as { extensionNumber?: string; name?: string; id?: number; uri?: string } | undefined;
    const extNum = ext?.extensionNumber ?? '';
    const siteName = ((rec.site as { name?: string } | undefined)?.name ?? (rec.label as string | undefined) ?? '').trim();
    const shop = matchSiteToShop(siteName) ?? shopFromExtensionNumber(extNum);
    return !shop && ext?.id;
  });
  const extDetailMap = new Map<number, { name: string; type: string; site?: string }>();
  await Promise.all(unmatched.map(async rec => {
    const ext = rec.extension as { id?: number; uri?: string } | undefined;
    if (!ext?.id) return;
    try {
      const r = await fetch(`${RC_BASE}/restapi/v1.0/account/~/extension/${ext.id}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      });
      if (!r.ok) return;
      const d = await r.json() as { name?: string; type?: string; site?: { name?: string } };
      extDetailMap.set(ext.id, { name: d.name ?? '', type: d.type ?? '', site: d.site?.name });
    } catch { /* best-effort */ }
  }));

  return {
    records: (data.records ?? []).map(rec => {
      const site = rec.site as { name?: string } | undefined;
      const ext = rec.extension as { extensionNumber?: string; name?: string; id?: number } | undefined;
      const label = rec.label as string | undefined;
      const extDetail = ext?.id ? extDetailMap.get(ext.id) : undefined;
      const siteName = (site?.name ?? ext?.name ?? extDetail?.site ?? label ?? '').trim();
      const extNum = ext?.extensionNumber ?? '';
      const shop = matchSiteToShop(siteName) ?? matchSiteToShop(extDetail?.name ?? '') ?? shopFromExtensionNumber(extNum);
      const result: { phone: string; site: string; extension: string; extensionName: string; extensionType: string; usageType: string; matchedShop: string | null; raw?: unknown } = {
        phone: String(rec.phoneNumber ?? ''),
        site: siteName || extDetail?.site || '',
        extension: extNum,
        extensionName: extDetail?.name ?? ext?.name ?? '',
        extensionType: extDetail?.type ?? '',
        usageType: String(rec.usageType ?? ''),
        matchedShop: shop,
      };
      if (!shop) result.raw = rec;
      return result;
    }),
  };
}

// --- Stable numeric lead_id from RC string call ID ---
// RC IDs are typically numeric strings. Falls back to djb2 hash for safety.

function numericId(rcId: string): number {
  const n = parseInt(rcId, 10);
  if (!isNaN(n) && String(n) === rcId) return n;
  let h = 5381;
  for (let i = 0; i < rcId.length; i++) h = ((h << 5) + h) ^ rcId.charCodeAt(i);
  return h >>> 0;
}

// --- Raw RC call-log record shape ---

interface RCCallRecord {
  id: string;
  startTime?: string;
  duration?: number;
  result?: string;
  from?: { phoneNumber?: string; name?: string; extensionNumber?: string };
  to?: { phoneNumber?: string; name?: string; extensionNumber?: string };
  recording?: { contentUri?: string; transcript?: string };
}

// --- Fetch the company call log from RC ---
// Results are cached in Redis for 15 minutes so multiple per-shop warm calls
// within the same cron window all share a single RC API fetch — avoids
// hammering the CMN-301 rate limit (10 req/min) with redundant full-account
// call-log pagination.

const callLogCacheKey = (direction: string, startDate: string, endDate: string) =>
  `rc_call_log:${direction}:${startDate}:${endDate}`;

async function fetchRCCallLog(startDate: string, endDate: string, direction: 'Inbound' | 'Outbound' = 'Inbound'): Promise<RCCallRecord[]> {
  const cacheKey = callLogCacheKey(direction, startDate, endDate);
  const cached = await readCache<RCCallRecord[]>(cacheKey);
  if (cached) {
    console.log(`[rc] call-log cache hit (${cached.length} records, direction=${direction})`);
    return cached;
  }

  const token = await getRCToken();
  const out: RCCallRecord[] = [];
  let nextUrl: string | null = `${RC_BASE}/restapi/v1.0/account/~/call-log`
    + `?direction=${direction}&type=Voice&view=Detailed&perPage=1000`
    + `&dateFrom=${encodeURIComponent(startDate + 'T00:00:00.000Z')}`
    + `&dateTo=${encodeURIComponent(endDate + 'T23:59:59.999Z')}`;

  while (nextUrl) {
    // 25-second timeout per fetch — prevents the function from hanging if RC
    // drops the connection without closing it.
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 25_000);
    let resp = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    }).finally(() => clearTimeout(tid));
    // RC CMN-301: rate limit — retry up to 2× with 3s waits
    for (let attempt = 1; resp.status === 429 && attempt <= 2; attempt++) {
      console.warn(`[rc] call-log rate limited (429), waiting 3s (attempt ${attempt}/2)`);
      await new Promise(r => setTimeout(r, 3_000));
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), 25_000);
      resp = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: c2.signal,
      }).finally(() => clearTimeout(t2));
    }
    if (!resp.ok) {
      throw new Error(`RC call-log fetch failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
    }
    const data = await resp.json() as {
      records?: RCCallRecord[];
      navigation?: { nextPage?: { uri?: string } };
    };
    out.push(...(data.records ?? []));
    nextUrl = data.navigation?.nextPage?.uri ?? null;
    if (out.length > 10_000) break; // safety cap
  }

  // 15-minute TTL — long enough that the 5-min cron gets multiple cache hits
  // between real RC fetches, reducing the number of paginated API calls by ~2×
  // and cutting the frequency we hit RC rate limits.
  await writeCache(cacheKey, out, { ttlSeconds: 15 * 60 });
  return out;
}

// --- Whisper transcription ---
// Transcripts are cached in Redis for 30 days so each call is only sent to
// Whisper once. At most TRANSCRIPT_CAP new calls are transcribed per
// fetchAllLeads invocation to stay within function timeout budgets.

const TRANSCRIPT_CAP = 15;
const transcriptKey = (rcId: string) => `rc_transcript:${rcId}`;

async function fetchWhisperTranscript(rcCallId: string, contentUri: string): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return '';
  try {
    const token = await getRCToken();
    let audioResp = await fetch(contentUri, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    // RC rate-limits audio downloads with 429 — wait 5s and retry once.
    if (audioResp.status === 429) {
      await new Promise(r => setTimeout(r, 5_000));
      audioResp = await fetch(contentUri, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    }
    if (!audioResp.ok) {
      console.warn(`[rc] audio download failed ${rcCallId}: ${audioResp.status}`);
      return '';
    }
    const audioBuffer = await audioResp.arrayBuffer();
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'recording.mp3');
    form.append('model', 'whisper-1');
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
      cache: 'no-store',
    });
    if (!resp.ok) {
      console.warn(`[rc] whisper failed ${rcCallId}: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      return '';
    }
    const data = await resp.json();
    const transcript: string = data.text ?? '';
    await writeCache(transcriptKey(rcCallId), transcript, { ttlSeconds: 30 * 24 * 60 * 60 });
    return transcript;
  } catch (e: any) {
    console.error(`[rc] whisper error ${rcCallId}:`, e?.message);
    return '';
  }
}

async function fillTranscripts(leads: Lead[], recordById: Map<number, RCCallRecord>): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;
  const eligible = leads.filter(l => l.call_duration_seconds >= 30 && recordById.has(l.lead_id));
  if (eligible.length === 0) return;

  // Load all cached transcripts in one pass
  const cached = await Promise.all(
    eligible.map(l => readCache<string>(transcriptKey(recordById.get(l.lead_id)!.id)))
  );

  const toFetch: Lead[] = [];
  for (let i = 0; i < eligible.length; i++) {
    if (cached[i] != null) {
      eligible[i].call_transcription = cached[i]!;
    } else {
      toFetch.push(eligible[i]);
    }
  }

  const batch = toFetch.slice(0, TRANSCRIPT_CAP);
  if (batch.length > 0) {
    console.log(`[rc] transcribing ${batch.length} new calls via Whisper (${toFetch.length - batch.length} deferred to next tick)`);
  }

  // Transcribe in groups of 5 to respect Whisper rate limits
  for (let i = 0; i < batch.length; i += 5) {
    await Promise.allSettled(
      batch.slice(i, i + 5).map(async (lead) => {
        const rec = recordById.get(lead.lead_id)!;
        lead.call_transcription = await fetchWhisperTranscript(rec.id, rec.recording!.contentUri!);
      })
    );
  }
}

// --- Public: fetchAllLeads ---
// Drop-in replacement for WhatConverts' fetchAllLeads.
// Returns Lead-compatible objects for the requested shop's calls only.

export interface LeadFilter {
  shop: ShopNum;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export async function fetchAllLeads(f: LeadFilter): Promise<Lead[]> {
  const [phoneMap, records] = await Promise.all([
    buildPhoneShopMap(),
    fetchRCCallLog(f.startDate, f.endDate),
  ]);

  const out: Lead[] = [];
  const recordById = new Map<number, RCCallRecord>();

  for (const rec of records) {
    const rawTo = (rec.to?.phoneNumber ?? '').replace(/\D/g, '');
    const toTen = rawTo.length === 11 && rawTo.startsWith('1') ? rawTo.slice(1) : rawTo;
    if (phoneMap.get(toTen) !== f.shop) continue;

    const id = numericId(rec.id);
    out.push({
      account_id: 0,
      profile_id: 0,
      profile: '',
      lead_id: id,
      lead_type: 'phone_call',
      lead_status: rec.result ?? '',
      date_created: rec.startTime ?? new Date().toISOString(),
      lead_state: '',
      contact_name: rec.from?.name ?? '',
      contact_phone_number: rec.from?.phoneNumber ?? '',
      spam: false,
      duplicate: false,
      call_duration_seconds: rec.duration ?? 0,
      call_status: rec.result ?? '',
      caller_name: rec.from?.name ?? '',
      caller_city: '',
      caller_state: '',
      call_transcription: '',
      recording: rec.recording?.contentUri ?? undefined,
      play_recording: rec.recording?.contentUri ?? undefined,
      lead_analysis: undefined,
    });
    if (rec.recording?.contentUri) recordById.set(id, rec);
  }

  await fillTranscripts(out, recordById);
  return out;
}

// --- isEligibleCall ---
// Replaces WhatConverts' version. Without WC's spam/outcome flags we use
// duration and transcript length as proxies for "real conversation."

export function isEligibleCall(lead: Lead): boolean {
  if (!lead.call_transcription || lead.call_transcription.length < 30) return false;
  if (lead.call_duration_seconds > 0 && lead.call_duration_seconds < 15) return false;
  return true;
}

// --- Outbound calls (inspection result / sales calls) ---
// The advisor calls the customer after the inspection is done. The shop is
// identified via from.extensionNumber using the same NNNxx convention.

export interface OutboundCall {
  id: string;
  startTime: string;
  durationSeconds: number;
  customerPhone: string; // normalized 10 digits
  extensionNumber: string;
  transcript: string;
  contentUri?: string;
}

async function fillOutboundTranscripts(calls: OutboundCall[], recordById: Map<string, RCCallRecord>): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;
  const eligible = calls.filter(c => c.durationSeconds >= 30 && recordById.has(c.id));
  if (eligible.length === 0) return;

  const cached = await Promise.all(
    eligible.map(c => readCache<string>(transcriptKey(c.id)))
  );

  const toFetch: OutboundCall[] = [];
  for (let i = 0; i < eligible.length; i++) {
    if (cached[i] != null) {
      eligible[i].transcript = cached[i]!;
    } else {
      toFetch.push(eligible[i]);
    }
  }

  const batch = toFetch.slice(0, TRANSCRIPT_CAP);
  if (batch.length > 0) {
    console.log(`[rc] transcribing ${batch.length} outbound calls via Whisper`);
  }

  for (let i = 0; i < batch.length; i += 5) {
    await Promise.allSettled(
      batch.slice(i, i + 5).map(async (call) => {
        const rec = recordById.get(call.id)!;
        call.transcript = await fetchWhisperTranscript(call.id, rec.recording!.contentUri!);
      })
    );
  }
}

export async function fetchOutboundCalls(f: LeadFilter): Promise<OutboundCall[]> {
  const [records, phoneMap] = await Promise.all([
    fetchRCCallLog(f.startDate, f.endDate, 'Outbound'),
    buildPhoneShopMap(),
  ]);
  const out: OutboundCall[] = [];
  const recordById = new Map<string, RCCallRecord>();

  for (const rec of records) {
    if ((rec.duration ?? 0) < 90) continue;

    // RC account-level call log never includes extensionNumber on outbound records.
    // Use fromPhone → phone map (same map used for inbound routing) to identify shop.
    const fromPhone = normalizePhone(rec.from?.phoneNumber ?? '');
    const shopNum = fromPhone ? phoneMap.get(fromPhone) ?? null : null;
    if (shopNum !== f.shop) continue;

    const custPhone = normalizePhone(rec.to?.phoneNumber ?? '') ?? '';
    out.push({
      id: rec.id,
      startTime: rec.startTime ?? '',
      durationSeconds: rec.duration ?? 0,
      customerPhone: custPhone,
      extensionNumber: rec.from?.extensionNumber ?? rec.from?.phoneNumber ?? '',
      transcript: '',
      contentUri: rec.recording?.contentUri,
    });
    if (rec.recording?.contentUri) recordById.set(rec.id, rec);
  }

  await fillOutboundTranscripts(out, recordById);
  return out;
}

// --- Call Recordings: unified inbound+outbound snapshot for a shop ---
// Used by the Call Recordings section in the employee view. Returns all
// calls (inbound + outbound) for a shop in the given date range, in
// reverse-chronological order. Transcripts are read from cache here;
// fillCallRecordingTranscripts() (called from warmCallRecordingsForShop)
// handles the actual Whisper invocations for both inbound and outbound.

// Whisper-transcribe entries that have a recording but no cached transcript.
// Call this after fetchCallRecordingsForShop to populate transcripts before
// they are stored in the shop snapshot. Cap limits Whisper calls per shop/run.
export async function fillCallRecordingTranscripts(
  entries: CallRecordingEntryWithUri[],
  cap = TRANSCRIPT_CAP,
): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;
  const needsTranscript = entries.filter(
    e => e.hasRecording && e.contentUri && !e.transcript && e.durationSeconds >= 30
  );
  const batch = needsTranscript.slice(0, cap);
  if (batch.length > 0) {
    console.log(`[rc] transcribing ${batch.length} call recording(s) via Whisper`);
  }
  for (let i = 0; i < batch.length; i += 5) {
    await Promise.allSettled(
      batch.slice(i, i + 5).map(async (entry) => {
        try {
          entry.transcript = await fetchWhisperTranscript(entry.callId, entry.contentUri!);
        } catch { /* non-fatal — transcript stays empty */ }
      })
    );
  }
}

export interface CallRecordingEntry {
  callId: string;
  direction: 'Inbound' | 'Outbound';
  startTime: string;
  durationSeconds: number;
  customerPhone: string;
  customerName: string;
  extensionNumber?: string;  // outbound only
  hasRecording: boolean;
  transcript: string;
}

export interface CallRecordingEntryWithUri extends CallRecordingEntry {
  contentUri?: string;  // stored server-side only; not sent to client
}

export async function fetchCallRecordingsForShop(
  shopNum: ShopNum,
  startDate: string,
  endDate: string,
): Promise<CallRecordingEntryWithUri[]> {
  const [inboundRecords, outboundRecords, phoneMap] = await Promise.all([
    fetchRCCallLog(startDate, endDate, 'Inbound'),
    fetchRCCallLog(startDate, endDate, 'Outbound'),
    buildPhoneShopMap(),
  ]);

  const out: CallRecordingEntryWithUri[] = [];

  // Inbound — match by to.phoneNumber → shop
  for (const rec of inboundRecords) {
    const toPhone = normalizePhone(rec.to?.phoneNumber ?? '') ?? '';
    if (phoneMap.get(toPhone) !== shopNum) continue;
    if ((rec.duration ?? 0) < 5) continue;
    const transcript = rec.recording?.contentUri
      ? ((await readCache<string>(transcriptKey(rec.id))) ?? '')
      : '';
    out.push({
      callId: rec.id,
      direction: 'Inbound',
      startTime: rec.startTime ?? '',
      durationSeconds: rec.duration ?? 0,
      customerPhone: normalizePhone(rec.from?.phoneNumber ?? '') ?? rec.from?.phoneNumber ?? '',
      customerName: rec.from?.name ?? '',
      hasRecording: !!rec.recording?.contentUri,
      contentUri: rec.recording?.contentUri,
      transcript,
    });
  }

  // Outbound — match by from.phoneNumber → shop or by extension NNNxx convention
  for (const rec of outboundRecords) {
    const fromPhone = normalizePhone(rec.from?.phoneNumber ?? '') ?? '';
    const shopFromPhone = phoneMap.get(fromPhone);
    const shopFromExt = shopFromExtensionNumber(rec.from?.extensionNumber);
    if (shopFromPhone !== shopNum && shopFromExt !== shopNum) continue;
    if ((rec.duration ?? 0) < 10) continue;
    const transcript = rec.recording?.contentUri
      ? ((await readCache<string>(transcriptKey(rec.id))) ?? '')
      : '';
    out.push({
      callId: rec.id,
      direction: 'Outbound',
      startTime: rec.startTime ?? '',
      durationSeconds: rec.duration ?? 0,
      customerPhone: normalizePhone(rec.to?.phoneNumber ?? '') ?? rec.to?.phoneNumber ?? '',
      customerName: rec.to?.name ?? rec.to?.phoneNumber ?? '',
      extensionNumber: rec.from?.extensionNumber ?? rec.from?.phoneNumber ?? '',
      hasRecording: !!rec.recording?.contentUri,
      contentUri: rec.recording?.contentUri,
      transcript,
    });
  }

  out.sort((a, b) => b.startTime.localeCompare(a.startTime));
  return out;
}

// --- Pre-fetch call log cache (call once before parallel shop processing) ---
// Warms both the inbound and outbound 7-day call log cache so that all shops
// hit a cache hit when they process concurrently instead of thundering-herding RC.
export async function prefetchRCCallLog(): Promise<void> {
  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  const start = new Date(now); start.setDate(start.getDate() - 7);
  const startDate = start.toISOString().slice(0, 10);
  // Use allSettled so a rate-limit or RC error on any one fetch doesn't abort
  // the others. Each shop's fetchCallRecordingsForShop will still attempt its
  // own fetch if the cache is cold — these are best-effort pre-warms only.
  const results = await Promise.allSettled([
    fetchRCCallLog(startDate, endDate, 'Inbound'),
    fetchRCCallLog(startDate, endDate, 'Outbound'),
    buildPhoneShopMap(),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.warn('[rc] prefetch partial failure (non-fatal):', r.reason?.message ?? r.reason);
  }
}

// --- Admin: force-refresh the phone map ---
// Call this if shop numbers get reassigned or new numbers are added to RC.
// Clears the Redis cache so the next fetchAllLeads re-discovers from RC.

export async function refreshPhoneMap(): Promise<Map<string, ShopNum>> {
  await writeCache(RC_PHONE_MAP_KEY, {}, { ttlSeconds: 1 }); // expire immediately
  _cachedToken = null; // also re-auth for good measure
  return await fetchAndCachePhoneMap();
}
