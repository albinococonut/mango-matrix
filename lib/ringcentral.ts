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
  }
  return null;
}

// Mango's RC extension numbering convention: NNNxx where N is the shop digit.
// 111xx → shop 001, 222xx → shop 002, ..., 777xx → shop 007, 999xx → shop 009.
function shopFromExtensionNumber(extNum: string | null | undefined): ShopNum | null {
  if (!extNum || extNum.length < 3) return null;
  const prefix = extNum.slice(0, 3);
  // All three leading digits must be the same (111, 222, …, 999)
  if (prefix[0] !== prefix[1] || prefix[1] !== prefix[2]) return null;
  const digit = parseInt(prefix[0], 10);
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
  // Priority 1: explicit env var override
  const envOverride = process.env.RINGCENTRAL_PHONE_MAP;
  if (envOverride) {
    try {
      const obj = JSON.parse(envOverride) as Record<string, string>;
      const map = new Map<string, ShopNum>();
      for (const [shopNum, nums] of Object.entries(obj)) {
        for (const ph of String(nums).split(',').map(s => s.trim())) {
          const ten = normalizePhone(ph);
          if (ten) map.set(ten, shopNum as ShopNum);
        }
      }
      if (map.size > 0) return map;
    } catch {
      console.warn('[rc] RINGCENTRAL_PHONE_MAP is set but could not be parsed as JSON — ignoring');
    }
  }

  // Priority 2: Redis cache
  const cached = await readCache<Record<string, string>>(RC_PHONE_MAP_KEY);
  if (cached) {
    const map = new Map<string, ShopNum>();
    for (const [ten, num] of Object.entries(cached)) map.set(ten, num as ShopNum);
    if (map.size > 0) return map;
  }

  // Priority 3: fetch from RC API and cache for 24h
  return await fetchAndCachePhoneMap();
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

  const data = await resp.json() as { records?: Array<{ phoneNumber?: string; site?: { name?: string }; extension?: { extensionNumber?: string; name?: string } }> };
  const map = new Map<string, ShopNum>();
  const toCache: Record<string, string> = {};
  const unmatched: string[] = [];

  for (const rec of data.records ?? []) {
    const siteName = (rec.site?.name ?? rec.extension?.name ?? '').trim();
    const shopNum = matchSiteToShop(siteName)
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
// Returns all inbound voice calls for the given date range, paginated.

async function fetchRCCallLog(startDate: string, endDate: string, direction: 'Inbound' | 'Outbound' = 'Inbound'): Promise<RCCallRecord[]> {
  const token = await getRCToken();
  const out: RCCallRecord[] = [];
  let nextUrl: string | null = `${RC_BASE}/restapi/v1.0/account/~/call-log`
    + `?direction=${direction}&type=Voice&view=Detailed&perPage=250`
    + `&dateFrom=${encodeURIComponent(startDate + 'T00:00:00.000Z')}`
    + `&dateTo=${encodeURIComponent(endDate + 'T23:59:59.999Z')}`;

  while (nextUrl) {
    let resp = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    // RC CMN-301: rate limit — wait 45s and retry once
    if (resp.status === 429) {
      console.warn('[rc] call-log rate limited (429), waiting 45s before retry');
      await new Promise(r => setTimeout(r, 45_000));
      resp = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
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
    const audioResp = await fetch(contentUri, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
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
    if ((rec.duration ?? 0) < 30) continue;

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

// --- Admin: force-refresh the phone map ---
// Call this if shop numbers get reassigned or new numbers are added to RC.
// Clears the Redis cache so the next fetchAllLeads re-discovers from RC.

export async function refreshPhoneMap(): Promise<Map<string, ShopNum>> {
  await writeCache(RC_PHONE_MAP_KEY, {}, { ttlSeconds: 1 }); // expire immediately
  _cachedToken = null; // also re-auth for good measure
  return await fetchAndCachePhoneMap();
}
