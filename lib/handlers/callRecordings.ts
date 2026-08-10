import { NextRequest, NextResponse } from 'next/server';
import { verifyRoleCookie, COOKIE_NAME } from '@/lib/auth';
import { cookies } from 'next/headers';
import { readCache, writeCache } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';
import type { ShopNum } from '@/lib/shops';
import type { CallRecordingEntryWithUri } from '@/lib/ringcentral';

// Cache keys
export const CR_SHOP_CACHE_KEY = (shopNum: string) => `call_rec_shop:${shopNum}`;
// Separate map of callId → contentUri, stored server-side only for the recording proxy
export const CR_URIS_KEY = (shopNum: string) => `call_rec_uris:${shopNum}`;
export const CR_WARM_IDX_KEY = 'call_rec_warm_idx';
const CR_HANDLED_KEY = (shopNum: string) => `call_rec_handled:${shopNum}`;
const CR_NOTES_KEY = (shopNum: string) => `call_rec_notes:${shopNum}`;

// --- Client-safe type (no contentUri) ---
export interface CallRecordingEntry {
  callId: string;
  direction: 'Inbound' | 'Outbound';
  startTime: string;
  durationSeconds: number;
  customerPhone: string;
  customerName: string;
  extensionNumber?: string;
  hasRecording: boolean;
  transcript: string;
}

export interface CallRecordingsShopCache {
  shopNum: string;
  shopName: string;
  computedAt: string;
  windowStart: string;
  windowEnd: string;
  entries: CallRecordingEntry[];
}

// --- Handled + notes helpers ---

export async function markCallHandled(shopNum: string, callId: string): Promise<void> {
  const key = CR_HANDLED_KEY(shopNum);
  const existing = await readCache<Record<string, number>>(key) ?? {};
  existing[callId] = Date.now();
  await writeCache(key, existing, { ttlSeconds: 14 * 24 * 60 * 60 });
}

export async function getCallHandled(shopNum: string): Promise<Set<string>> {
  const existing = await readCache<Record<string, number>>(CR_HANDLED_KEY(shopNum)) ?? {};
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return new Set(Object.entries(existing).filter(([, t]) => t > cutoff).map(([id]) => id));
}

export async function saveCallNote(shopNum: string, callId: string, note: string): Promise<void> {
  const key = CR_NOTES_KEY(shopNum);
  const existing = await readCache<Record<string, string>>(key) ?? {};
  if (note) {
    existing[callId] = note;
  } else {
    delete existing[callId];
  }
  await writeCache(key, existing, { ttlSeconds: 30 * 24 * 60 * 60 });
}

export async function getCallNotes(shopNum: string): Promise<Map<string, string>> {
  const existing = await readCache<Record<string, string>>(CR_NOTES_KEY(shopNum)) ?? {};
  return new Map(Object.entries(existing));
}

// --- Route handler ---

export async function handle(req: NextRequest) {
  const role = await verifyRoleCookie(cookies().get(COOKIE_NAME)?.value);

  if (req.method === 'POST') {
    if (!role) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const { shopNum, callId, note } = body ?? {};
    if (!shopNum || !callId) return NextResponse.json({ error: 'shopNum and callId required' }, { status: 400 });
    if (note !== undefined) {
      await saveCallNote(String(shopNum), String(callId), String(note));
    } else {
      await markCallHandled(String(shopNum), String(callId));
    }
    return NextResponse.json({ ok: true });
  }

  // GET — fetch all shops
  const results = await Promise.all(
    SHOPS.map(async (shop) => {
      const cache = await readCache<CallRecordingsShopCache>(CR_SHOP_CACHE_KEY(shop.num));
      if (!cache) {
        return {
          shopNum: shop.num,
          shopName: shop.name,
          cached: false,
          computedAt: null,
          windowStart: null,
          windowEnd: null,
          entries: [],
        };
      }

      const [handled, notes] = await Promise.all([
        getCallHandled(shop.num),
        getCallNotes(shop.num),
      ]);

      const entriesWithMeta = cache.entries.map((e: CallRecordingEntry) => ({
        ...e,
        handled: handled.has(e.callId),
        note: notes.get(e.callId) ?? '',
      }));

      return { ...cache, entries: entriesWithMeta, cached: true };
    })
  );

  return NextResponse.json({ shops: results });
}
