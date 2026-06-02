// Weekly metric snapshots — durable per-week capture of the metrics that
// CANNOT be reconstructed from Tekmetric repair orders after the fact:
//   - rebook %      (depends on appointment createdDate state at the time)
//   - conversion %  (depends on Claude call classification at the time)
//   - google rating (cumulative rating is point-in-time; history is lost)
//
// Everything else the Shop Performance heatmap shows (revenue, GP, cars,
// comebacks, billed hours) is recomputed per-week directly from ROs on every
// load, so it needs no snapshot.
//
// Capture strategy: the snapshot job overwrites the CURRENT week's row on
// every run by copying the latest week-to-date caches. The row therefore
// accumulates through the week and finalizes once the week ends — robust to
// missed runs, and cheap (KV reads only, no recompute, no Claude cost). Only
// accumulates going FORWARD from the day the job is enabled; weeks before
// that stay served by the static data/heatmapExtras.json backfill.

import { readCache, writeCache } from './cache';

// One row per ISO-Monday week. `Record<shopNum, value>` for each metric.
export interface WeeklyMetricSnapshot {
  weekStart: string;            // ISO date of the Monday (chain tz)
  capturedAt: string;           // ISO timestamp of last write
  rebook: Record<string, number>;      // FBR % (0-100)
  conversion: Record<string, number>;  // booked-rate % (0-100)
  rating: Record<string, number>;      // cumulative google rating (e.g. 4.7)
}

const SNAP_KEY = (weekStart: string) => `metric_snapshot_${weekStart}`;
const SNAP_INDEX = 'metric_snapshot_index';

export async function readMetricSnapshot(weekStart: string): Promise<WeeklyMetricSnapshot | null> {
  return await readCache<WeeklyMetricSnapshot>(SNAP_KEY(weekStart));
}

export async function readAllMetricSnapshots(): Promise<WeeklyMetricSnapshot[]> {
  const idx = (await readCache<string[]>(SNAP_INDEX)) || [];
  const out: WeeklyMetricSnapshot[] = [];
  for (const w of idx) {
    const s = await readMetricSnapshot(w);
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export async function writeMetricSnapshot(s: WeeklyMetricSnapshot): Promise<void> {
  await writeCache(SNAP_KEY(s.weekStart), s);
  const idx = (await readCache<string[]>(SNAP_INDEX)) || [];
  if (!idx.includes(s.weekStart)) {
    idx.push(s.weekStart);
    idx.sort();
    await writeCache(SNAP_INDEX, idx);
  }
}

/**
 * Build a {weekStart -> snapshot} map for fast lookup when assembling the
 * heatmap. Cheap: one index read + one read per stored week.
 */
export async function metricSnapshotMap(): Promise<Map<string, WeeklyMetricSnapshot>> {
  const all = await readAllMetricSnapshots();
  return new Map(all.map((s) => [s.weekStart, s]));
}
