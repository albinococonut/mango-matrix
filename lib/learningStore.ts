// Projection learning store.
//
// One durable record per (week, shop, checkpoint). Captures EXACTLY what the
// model saw at projection time, the projection it produced, and (filled in
// after week-close) the actual final revenue + error. This is the dataset the
// next refit reads from. Writes are gated by PROJECTION_LOG_WRITE — by design
// the writer runs even when MODEL_V2 serving is OFF, so v2 has live data
// before any cutover.

import { readCache, writeCache, cacheUpdatedAt } from './cache';
import type { CheckpointKey } from './forecast/engineV2';

export const LOG_KEY = (week: string, shop: string, cp: CheckpointKey) => `proj_log_${week}_${shop}_${cp}`;
const LOG_INDEX = 'proj_log_index'; // string[] of `<week>|<shop>|<cp>`

export function logWriteEnabled(): boolean {
  const v = (process.env.PROJECTION_LOG_WRITE || 'on').toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false' || v === 'no');
}

export function modelV2Enabled(): boolean {
  const v = (process.env.PROJECTION_MODEL_V2 || 'off').toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}

export interface ProjectionLog {
  week: string;          // YYYY-MM-DD Monday
  shop: string;
  checkpoint: CheckpointKey;
  capturedAt: string;    // ISO
  features: {
    revSoFar: number;
    approvedUnbilled: number;
    bookedAppts: number | null;          // null = appointment cache missing/expired (request path is cache-only)
    apptsFreshness?: 'fresh' | 'stale' | 'missing'; // diagnostics so the offline refit can audit cold-cache rows
    // Note: WhatConverts call counts intentionally NOT logged — backtest
    // showed calls add ≤0.66pp MAPE at any checkpoint and the v2 model
    // weights them at 0. Not wiring an input we don't use.
    carsSoFar: number;
    gpSoFarPct: number;
    aroSoFar: number;
    elapsedBizFrac: number;
    shopBaselineMedian: number;
    shopBaselineTrailing4: number;
  };
  projection: {
    modelVersion: string;
    point: number; low: number; high: number; confidence: number;
    isRamping: boolean;
    contributions: { label: string; amount: number }[];
  };
  // Filled in by the Sunday-night backfill once the week is closed.
  actualFinalRevenue: number | null;
  errorAbs: number | null;
  errorPct: number | null;
}

export async function writeProjectionLog(rec: ProjectionLog): Promise<void> {
  if (!logWriteEnabled()) return;
  const k = LOG_KEY(rec.week, rec.shop, rec.checkpoint);
  await writeCache(k, rec);
  const idx = (await readCache<string[]>(LOG_INDEX)) || [];
  const tag = `${rec.week}|${rec.shop}|${rec.checkpoint}`;
  if (!idx.includes(tag)) { idx.push(tag); await writeCache(LOG_INDEX, idx); }
}

export async function readProjectionLogs(weekStart?: string): Promise<ProjectionLog[]> {
  const idx = (await readCache<string[]>(LOG_INDEX)) || [];
  const out: ProjectionLog[] = [];
  for (const tag of idx) {
    const [w, s, c] = tag.split('|');
    if (weekStart && w !== weekStart) continue;
    const rec = await readCache<ProjectionLog>(LOG_KEY(w, s, c as CheckpointKey));
    if (rec) out.push(rec);
  }
  return out.sort((a, b) => `${a.week}|${a.shop}|${a.checkpoint}`.localeCompare(`${b.week}|${b.shop}|${b.checkpoint}`));
}

/** Sunday-night backfill: for each projection log of `weekStart`, fill in the
 *  actual final revenue + error. Idempotent: skips rows already backfilled. */
export async function backfillWeeklyActuals(
  weekStart: string,
  perShopFinalRevenue: Record<string, number>,
): Promise<{ updated: number; skipped: number }> {
  const logs = await readProjectionLogs(weekStart);
  let updated = 0, skipped = 0;
  for (const rec of logs) {
    if (rec.actualFinalRevenue != null) { skipped++; continue; }
    const actual = perShopFinalRevenue[rec.shop];
    if (actual == null) continue;
    rec.actualFinalRevenue = Math.round(actual);
    rec.errorAbs = Math.round(rec.projection.point - actual);
    rec.errorPct = actual > 0 ? rec.errorAbs / actual : null;
    await writeCache(LOG_KEY(rec.week, rec.shop, rec.checkpoint), rec);
    updated++;
  }
  return { updated, skipped };
}

export async function logLastWrite(): Promise<number | null> {
  return cacheUpdatedAt(LOG_INDEX);
}
