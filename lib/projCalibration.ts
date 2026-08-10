// V2 checkpoint band calibration — tracks how often the low/high confidence
// interval actually contains the final revenue, per checkpoint.
//
// After each weekend reconcile we log whether the settled actual fell inside
// the v2 [low, high] band for each week+shop. If a checkpoint's coverage rate
// drifts far from the nominal 80% target (i.e. the bands are systematically
// too tight or too wide), we store a multiplier to widen/narrow them.
//
// This is NOT a weights refit — it's a band-width calibration only. A full
// weights refit needs many months of settled data and is handled offline.
//
// Called by syncJobs reconcileWeekly after computeAndStoreBias.

import { readCache, writeCache } from './cache';
import { readProjectionLogs } from './learningStore';
import { readSettledWeeks } from './reconcile';
import type { CheckpointKey } from './forecast/engineV2';

const CAL_KEY = (cp: CheckpointKey) => `proj_cal_v2_${cp}`;
const CAL_SUMMARY_KEY = 'proj_cal_v2_summary';

// Rolling window for calibration. Smaller = adapts faster but noisier.
const WINDOW_WEEKS = 20;
// Minimum observations per checkpoint before we apply any calibration.
const MIN_OBS = 8;
// The model targets an 80% prediction interval. Drift beyond ±10pp triggers
// a band-width multiplier.
const TARGET_COVERAGE = 0.80;
const MAX_BAND_MULTIPLIER = 1.40;
const MIN_BAND_MULTIPLIER = 0.70;

export interface CheckpointCalibration {
  checkpoint: CheckpointKey;
  coverageRate: number;      // fraction of actuals inside [low, high]
  bandMultiplier: number;    // multiply (high-point) and (point-low) by this
  obsCount: number;
  updatedAt: string;
}

export interface CalibrationSummary {
  checkpoints: CheckpointCalibration[];
  computedAt: string;
  weeksScanned: number;
}

export async function computeAndStoreCalibration(): Promise<CalibrationSummary> {
  const settled = await readSettledWeeks();
  const recent = settled.slice(-WINDOW_WEEKS);

  // For each (week, shop), grab the projection log at the best checkpoint
  // (fri_close preferred). Record whether actual fell inside [low, high].
  const cpObs: Partial<Record<CheckpointKey, { inside: number; total: number }>> = {};

  for (const sw of recent) {
    const logs = await readProjectionLogs(sw.weekStart);
    // Include all checkpoints (not just fri_close) — calibration tracks coverage
    // per checkpoint independently so each one's band width is adjusted separately.
    const settledLogs = logs.filter(
      (l) => l.projection?.low != null && l.projection?.high != null && l.actualFinalRevenue != null
    );
    for (const l of settledLogs) {
      const cp = l.checkpoint as CheckpointKey;
      if (!cpObs[cp]) cpObs[cp] = { inside: 0, total: 0 };
      const actual = l.actualFinalRevenue!;
      const inside = actual >= l.projection!.low! && actual <= l.projection!.high! ? 1 : 0;
      cpObs[cp]!.inside += inside;
      cpObs[cp]!.total += 1;
    }
  }

  const checkpoints: CheckpointCalibration[] = [];
  for (const [cp, obs] of Object.entries(cpObs) as [CheckpointKey, { inside: number; total: number }][]) {
    if (obs.total < MIN_OBS) {
      const neutral: CheckpointCalibration = {
        checkpoint: cp, coverageRate: TARGET_COVERAGE,
        bandMultiplier: 1.0, obsCount: obs.total,
        updatedAt: new Date().toISOString(),
      };
      await writeCache(CAL_KEY(cp), neutral);
      checkpoints.push(neutral);
      continue;
    }
    const coverage = obs.inside / obs.total;
    // Adjust band width proportionally to the coverage shortfall/excess.
    // If coverage = 0.60 (too narrow), multiplier > 1 widens bands.
    // If coverage = 0.95 (too wide), multiplier < 1 tightens bands.
    const rawMultiplier = coverage / TARGET_COVERAGE;
    const bandMultiplier = Math.max(MIN_BAND_MULTIPLIER, Math.min(MAX_BAND_MULTIPLIER, rawMultiplier));
    const cal: CheckpointCalibration = {
      checkpoint: cp,
      coverageRate: Math.round(coverage * 10000) / 10000,
      bandMultiplier: Math.round(bandMultiplier * 10000) / 10000,
      obsCount: obs.total,
      updatedAt: new Date().toISOString(),
    };
    await writeCache(CAL_KEY(cp), cal);
    checkpoints.push(cal);
  }

  const summary: CalibrationSummary = {
    checkpoints,
    computedAt: new Date().toISOString(),
    weeksScanned: recent.length,
  };
  await writeCache(CAL_SUMMARY_KEY, summary);
  return summary;
}

/** Returns the band multiplier for a checkpoint (1.0 if no calibration data). */
export async function readBandMultiplier(cp: CheckpointKey): Promise<number> {
  const c = await readCache<CheckpointCalibration>(CAL_KEY(cp));
  if (!c || c.obsCount < MIN_OBS) return 1.0;
  return c.bandMultiplier;
}

/** Returns the full calibration summary (for the accuracy dashboard). */
export async function readCalibrationSummary(): Promise<CalibrationSummary | null> {
  return readCache<CalibrationSummary>(CAL_SUMMARY_KEY);
}
