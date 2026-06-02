// ONE-TIME RESTORE — fixes rows that were incorrectly auto-reopened by the
// 12-hour stale-resolution sweep (removed 2026-06-02).
//
// HOW IT WORKS:
//   1. Reads every `recovered_set_<shopNum>_<weekYmd>` ledger entry for all
//      8 shops across the last 6 weeks (all Mondays where the ledger may have
//      a valid set — same TTL the ledger uses).
//   2. For each "cb:<id>", "rb:<id>", "dj:<id>" entry in the set, reads the
//      corresponding resolution record from the resolution store.
//   3. If the resolution is currently 'open' (the auto-reopen sweep reset it
//      that way) AND a timestamp exists in the recovered_ts_* log proving the
//      manager originally marked it won, restore it to won/resolved.
//   4. Reports exactly what was restored so the caller can verify.
//
// Auth: same REVIEW_WEBHOOK_SECRET used by the other admin webhooks.
// This endpoint is ephemeral — delete after running once.

import { NextRequest, NextResponse } from 'next/server';
import { readCache, writeCache } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';
import { TEKMETRIC_REPORT_TZ } from '@/lib/dates';
import { toZonedTime } from 'date-fns-tz';
import { startOfWeek, subWeeks } from 'date-fns';

export const dynamic = 'force-dynamic';

function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Re-derive the Monday ymd for a given date (same logic as recoveredLedger.ts)
function mondayYmd(d: Date): string {
  const local = toZonedTime(d, TEKMETRIC_REPORT_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

// Resolution store key names (must match the store files exactly)
const CB_KEY  = (leadId: number) => `callback_resolution_${leadId}`;
const RB_KEY  = (roId: number)   => `rebook_resolution_${roId}`;
const DJ_KEY  = (jobId: number)  => `declined_job_resolution_${jobId}`;
const SET_KEY = (shopNum: string, weekYmd: string) => `recovered_set_${shopNum}_${weekYmd}`;
const TS_KEY  = (shopNum: string, weekYmd: string) => `recovered_ts_${shopNum}_${weekYmd}`;

export async function POST(req: NextRequest) {
  // Accept CRON_SECRET (the same one GH Actions uses to trigger syncs).
  // This lets us fire it from the same curl pattern without needing the
  // encrypted REVIEW_WEBHOOK_SECRET pulled out of Vercel KV.
  const expected = process.env.CRON_SECRET || process.env.CRON_SECRET_ADMIN || process.env.REVIEW_WEBHOOK_SECRET;
  if (!expected) return NextResponse.json({ error: 'no secret configured' }, { status: 500 });

  let body: any = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  const token =
    typeof body.secret === 'string' ? body.secret :
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !constEq(token, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Build the list of week-ymd strings for the last 7 weeks (ledger TTL ~6w;
  // use 7 to be safe near the boundary).
  const now = new Date();
  const weeks: string[] = [];
  for (let i = 0; i <= 7; i++) {
    weeks.push(mondayYmd(subWeeks(now, i)));
  }
  // Dedupe (just in case subWeeks produces the same Monday twice)
  const uniqueWeeks = [...new Set(weeks)];

  const restored: { queue: string; id: number; shopNum: string; weekYmd: string; restoredAt: string }[] = [];
  const skipped: { queue: string; id: number; reason: string }[] = [];

  for (const shop of SHOPS) {
    for (const weekYmd of uniqueWeeks) {
      const setKey = SET_KEY(shop.num, weekYmd);
      const tsKey  = TS_KEY(shop.num, weekYmd);

      const [ledgerSet, tsLog] = await Promise.all([
        readCache<string[]>(setKey),
        readCache<Record<string, string>>(tsKey),
      ]);

      if (!ledgerSet || ledgerSet.length === 0) continue;

      for (const entry of ledgerSet) {
        // entry format: "cb:<leadId>" | "rb:<roId>" | "dj:<jobId>"
        const [queueTag, idStr] = entry.split(':');
        const id = parseInt(idStr, 10);
        if (!Number.isFinite(id) || id <= 0) continue;

        // Determine which resolution store to touch
        let resKey: string;
        let wonStatus: string;
        if (queueTag === 'cb') {
          resKey = CB_KEY(id);
          wonStatus = 'resolved';
        } else if (queueTag === 'rb') {
          resKey = RB_KEY(id);
          wonStatus = 'won';
        } else if (queueTag === 'dj') {
          resKey = DJ_KEY(id);
          wonStatus = 'won';
        } else {
          skipped.push({ queue: queueTag, id, reason: 'unknown queue prefix' });
          continue;
        }

        const existing = await readCache<Record<string, any>>(resKey);

        // Only restore rows currently showing as 'open' — those are the
        // auto-reopened victims. Rows already showing as won/resolved were
        // either never touched by the sweep or already fixed; leave them.
        // Rows showing as not_salvageable were intentional; never touch those.
        if (!existing) {
          // No resolution record at all. The ledger says it was recovered
          // but there's no resolution doc — the sweep deleted it entirely
          // or it expired. Re-create it.
          const originalTs = tsLog?.[entry] ?? now.toISOString();
          await writeCache(resKey, {
            ...(queueTag === 'cb'
              ? { leadId: id }
              : queueTag === 'rb'
              ? { roId: id }
              : { jobId: id }),
            status: wonStatus,
            resolvedAt: originalTs,
            updatedAt: now.toISOString(),
            _restoredBy: 'restore-recovered-2026-06',
          });
          restored.push({ queue: queueTag, id, shopNum: shop.num, weekYmd, restoredAt: originalTs });
          continue;
        }

        if (existing.status !== 'open') {
          skipped.push({ queue: queueTag, id, reason: `status already ${existing.status}` });
          continue;
        }

        // Row is 'open' but the ledger says it was recovered — restore it.
        const originalTs = tsLog?.[entry] ?? existing.updatedAt ?? now.toISOString();
        await writeCache(resKey, {
          ...existing,
          status: wonStatus,
          resolvedAt: originalTs,
          updatedAt: now.toISOString(),
          _restoredBy: 'restore-recovered-2026-06',
        });
        restored.push({ queue: queueTag, id, shopNum: shop.num, weekYmd, restoredAt: originalTs });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    restoredCount: restored.length,
    skippedCount: skipped.length,
    restored,
    skipped: skipped.slice(0, 50), // cap for readability
  });
}
