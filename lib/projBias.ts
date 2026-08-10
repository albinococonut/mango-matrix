// Per-shop rolling projection bias correction.
//
// After each weekend reconcile, we read the last WINDOW_WEEKS of settled
// projection logs and compute, per shop, the mean signed error (projected
// minus actual as a fraction of actual). A persistently positive error means
// the model over-predicts for that shop; we apply a multiplicative correction
// to bring future projections closer to reality.
//
// The correction is deliberately conservative:
//   - Requires at least MIN_WEEKS of settled data before applying anything.
//   - Capped at ±15% so a bad run of weeks can't wildly distort projections.
//   - Uses only the final-checkpoint (fri_close) log for each week so the
//     error signal reflects the model's "best guess at week-end", not its
//     noisier early-week estimates.
//
// Called by syncJobs reconcileWeekly immediately after backfillWeeklyActuals.
// Read by the projection handler to apply before returning results to the UI.

import { readCache, writeCache } from './cache';
import { readProjectionLogs } from './learningStore';
import { readSettledWeeks } from './reconcile';
import type { CheckpointKey } from './forecast/engineV2';

const BIAS_KEY = (shop: string) => `proj_bias_v2_${shop}`;
const BIAS_SUMMARY_KEY = 'proj_bias_v2_summary';

const MIN_WEEKS = 6;    // below this, apply no correction (too little data)
const WINDOW_WEEKS = 12; // rolling window of settled weeks to include
const MAX_CORRECTION = 0.15; // cap adjustment at ±15%

// Checkpoints ordered latest-first for picking the "best available" per week
const CHECKPOINT_PRIORITY: CheckpointKey[] = [
  'fri_close', 'fri_mid', 'thu_close', 'wed_close', 'tue_close', 'mon_close', 'mon_am',
];

export interface ShopBias {
  shopNum: string;
  meanErrorPct: number;    // positive = model over-predicts; negative = under-predicts
  correction: number;      // multiply projected point by this (e.g. 0.94 corrects +6% over-pred)
  weeksUsed: number;
  checkpointUsed: string;  // which checkpoint drove each week's signal
  updatedAt: string;
}

export interface BiasResult {
  shops: ShopBias[];
  computedAt: string;
  settledWeeksScanned: number;
}

export async function computeAndStoreBias(): Promise<BiasResult> {
  const settled = await readSettledWeeks();
  const recent = settled.slice(-WINDOW_WEEKS);

  // Group error observations by shop. For each settled week, pick the
  // latest-available checkpoint log (fri_close preferred).
  const errsByShop: Record<string, number[]> = {};

  for (const sw of recent) {
    const logs = await readProjectionLogs(sw.weekStart);
    const shopsSeen = new Set(logs.map((l) => l.shop));
    for (const shop of shopsSeen) {
      const shopLogs = logs.filter((l) => l.shop === shop && l.errorPct != null);
      if (!shopLogs.length) continue;
      // Pick the latest-in-week checkpoint available for this shop
      for (const cp of CHECKPOINT_PRIORITY) {
        const match = shopLogs.find((l) => l.checkpoint === cp);
        if (match?.errorPct != null) {
          if (!errsByShop[shop]) errsByShop[shop] = [];
          errsByShop[shop].push(match.errorPct);
          break;
        }
      }
    }
  }

  const shops: ShopBias[] = [];
  for (const [shopNum, errs] of Object.entries(errsByShop)) {
    if (errs.length < MIN_WEEKS) {
      // Not enough data — store a neutral entry so the handler knows we tried
      const neutral: ShopBias = {
        shopNum, meanErrorPct: 0, correction: 1.0,
        weeksUsed: errs.length, checkpointUsed: 'insufficient',
        updatedAt: new Date().toISOString(),
      };
      await writeCache(BIAS_KEY(shopNum), neutral);
      shops.push(neutral);
      continue;
    }
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    // correction = 1 / (1 + meanError), capped at ±MAX_CORRECTION
    const rawCorrection = 1 / (1 + mean);
    const correction = Math.max(1 - MAX_CORRECTION, Math.min(1 + MAX_CORRECTION, rawCorrection));
    const bias: ShopBias = {
      shopNum,
      meanErrorPct: Math.round(mean * 10000) / 10000,
      correction: Math.round(correction * 10000) / 10000,
      weeksUsed: errs.length,
      checkpointUsed: 'fri_close (preferred)',
      updatedAt: new Date().toISOString(),
    };
    await writeCache(BIAS_KEY(shopNum), bias);
    shops.push(bias);
  }

  const summary: BiasResult = {
    shops,
    computedAt: new Date().toISOString(),
    settledWeeksScanned: recent.length,
  };
  await writeCache(BIAS_SUMMARY_KEY, summary);
  return summary;
}

/** Returns the correction multiplier for a shop (1.0 = no correction). */
export async function readBiasCorrection(shopNum: string): Promise<number> {
  const b = await readCache<ShopBias>(BIAS_KEY(shopNum));
  if (!b || b.weeksUsed < MIN_WEEKS) return 1.0;
  return b.correction;
}

/** Returns the full bias summary for the accuracy dashboard card. */
export async function readBiasSummary(): Promise<BiasResult | null> {
  return readCache<BiasResult>(BIAS_SUMMARY_KEY);
}
