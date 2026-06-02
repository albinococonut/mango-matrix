// Revenue projection engine v2 — piecewise blended linear model derived from
// the 2026 backtest (scripts/analyze_backtest.py). Pure function: no I/O.
//
// The handler assembles inputs from Tekmetric/WC data + the per-shop trailing
// history and calls projectV2() once per request. Results carry an itemized
// contributions[] so the UI "Why" tooltip can show exactly which signal drove
// each piece of the number.

export const MODEL_VERSION = 'v2.0' as const;

export type CheckpointKey =
  | 'mon_am' | 'mon_close' | 'tue_close' | 'wed_close'
  | 'thu_close' | 'fri_mid' | 'fri_close';

/** Inputs the engine consumes. The caller is responsible for computing these
 *  from the live RO / appointment / call data and the trailing history. */
export interface V2Input {
  shopNum: string;
  shopName: string;
  /** MT-local instant for which this projection is being made. */
  nowMtn: Date;
  /** Sum of ex-tax counted revenue posted so far this week. */
  revSoFar: number;
  /** Sum of authorized job subtotals on ROs NOT yet posted as of nowMtn.
   *  Each individual job MUST already be capped at the shop's 80th-percentile
   *  job-size before being summed in here (caller's responsibility — see
   *  capPerJobAndSum below). */
  approvedUnbilled: number;
  /** Count of appointments with createdDate<=nowMtn and startTime in the
   *  remainder of the week. NULL means the appointment cache was missing or
   *  expired (request path is cache-only by design — the warm cron may not
   *  have refreshed this shop yet). The model must NOT fabricate 0 in that
   *  case; it skips the booked-appts contribution and notes the gap. */
  bookedAppts: number | null;
  /** Trailing-12-week per-shop median of final weekly revenue. */
  shopBaselineMedian: number;
  /** Trailing-4-week per-shop median. Used solely for the ramp guardrail. */
  shopBaselineTrailing4: number;
}

export interface V2Contribution { label: string; amount: number }
export interface V2Output {
  modelVersion: typeof MODEL_VERSION;
  checkpoint: CheckpointKey;
  elapsedBizFrac: number;
  point: number;
  low: number;
  high: number;
  confidence: number;
  isRamping: boolean;
  rampWarning?: string;
  contributions: V2Contribution[];
  reasons: string[];
}

/** Map MT now → canonical checkpoint label + business-week elapsed fraction
 *  (Mon 00:00 → Fri 18:00 = 0.0 → 1.0). */
export function detectCheckpoint(nowMtn: Date): { label: CheckpointKey; elapsedBizFrac: number } {
  const dow = nowMtn.getDay();              // 0 Sun ... 6 Sat (MT wall clock)
  const hr = nowMtn.getHours() + nowMtn.getMinutes() / 60;
  // Mon→Fri business span: Mon 00:00 (dow=1,hr=0) → Fri 18:00 (dow=5,hr=18).
  // Total = 4 days × 24h + 18h = 114h.
  let elapsedHours: number;
  if (dow === 0) elapsedHours = 0;          // Sun: pre-week
  else if (dow === 6) elapsedHours = 114;   // Sat: post-business-week
  else elapsedHours = (dow - 1) * 24 + hr;  // Mon=0..18 base
  elapsedHours = Math.max(0, Math.min(114, elapsedHours));
  const elapsed = elapsedHours / 114;

  // Checkpoint label: pick the canonical name closest to nowMtn.
  let label: CheckpointKey = 'mon_am';
  if (dow === 1 && hr < 12) label = 'mon_am';
  else if (dow === 1) label = 'mon_close';
  else if (dow === 2) label = 'tue_close';
  else if (dow === 3) label = 'wed_close';
  else if (dow === 4) label = 'thu_close';
  else if (dow === 5 && hr < 15) label = 'fri_mid';
  else if (dow === 5) label = 'fri_close';
  else if (dow === 6 || dow === 0) label = 'fri_close'; // weekend = locked at fri_close
  return { label, elapsedBizFrac: elapsed };
}

// Per-checkpoint weights — every number traces back to the 2026 backtest.
// (See data/backtest_analysis.txt § 10 and the QC report.)
interface Weights {
  shopBaselineWeight: number;     // weight on the shop's trailing-12 median (early-week intercept)
  paceWeight: number;             // weight on rev_so_far / elapsed (pace projection)
  approvedWeight: number;         // weight on approved-unbilled
  perBookedAppt: number;          // dollar contribution per remaining booked appt
  baseConfidence: number;         // empirical in-range hit rate from walk-forward (the operator-facing claim)
  // OLS-fitted additions (refinement pass — LOO-CV gated, n=96 walk-forward).
  // Default to 0 so checkpoints not yet refit are unaffected.
  intercept?: number;             // constant $ adjustment from OLS fit
  paceRatioCoef?: number;         // coef on ((rev/elapsed)/t12_median − 1) × t12_median (Tue only)
  // Band half-width as a fraction of point. When set, the engine uses this
  // for the displayed low/high range INSTEAD of the legacy `1 − confidence`
  // tie. Both numbers are measured walk-forward; decoupling them is the
  // surgical fix so a tight model can claim its actual ~80% coverage with a
  // narrow honest range, instead of being forced to widen the band
  // mechanically just because the confidence number is high.
  bandWidth?: number;
}
// `baseConfidence` is RECALIBRATED from the walk-forward test against the
// last 12 completed weeks (scripts/calibrate_checkpoints.py). The earlier
// values (Tue 0.88, Wed 0.92, Thu 0.96, Fri 0.98) were drawn from 5-fold-CV
// MAPE which had temporal leakage; honest walk-forward coverage was 45-49%
// at those stated levels — the model was systemically OVERCONFIDENT.
// Each baseConfidence below now satisfies: ≥80% of past 12 weeks' actual
// final revenue landed inside the model's [point × (1 − band), point × (1 +
// band)] range, where band = 1 − baseConfidence.
//
// Note: thu_close confidence (0.75) is intentionally LOWER than wed_close
// (0.81). That's not a bug — the model's Thu point estimate (rev_so_far +
// 0.65 × approved-unbilled) has more residual variance than Wed's pace
// blend in this dataset. Surfaced honestly; a future model-tuning pass
// (add a small pace term or lift the approved coefficient at thu_close)
// should narrow that gap.
// Tue / Thu / Fri-mid refit from leave-one-week-out CV (n=96 walk-forward,
// scripts/refine_v2.py). Held-out p80 essentially equals in-sample p80 →
// no overfit. New bands derived from LOO p80, slightly conservative.
//
//                             held-out  in-samp
//   thu_close   was ±25%  →   ±6.4%    ±6.2%    OK
//   fri_mid     was ±15%  →   ±3.2%    ±3.2%    OK
//   tue_close   was ±28%  →   ±20.0%   ±19.9%   OK
//
const WEIGHTS: Record<CheckpointKey, Weights> = {
  mon_am:    { shopBaselineWeight: 1.00, paceWeight: 0.00, approvedWeight: 0.55, perBookedAppt: 220, baseConfidence: 0.66 },
  mon_close: { shopBaselineWeight: 0.50, paceWeight: 0.30, approvedWeight: 0.65, perBookedAppt: 200, baseConfidence: 0.73 },
  // REFIT: pace_ratio_vs_t12 + simultaneous fit. baseConfidence + bandWidth both walk-forward measured.
  tue_close: { shopBaselineWeight: 0.00, paceWeight: 0.297, approvedWeight: 0.842, perBookedAppt: 302, baseConfidence: 0.79, intercept:  3232, paceRatioCoef: -0.172, bandWidth: 0.20 },
  wed_close: { shopBaselineWeight: 0.00, paceWeight: 0.70,  approvedWeight: 0.70,  perBookedAppt:  60, baseConfidence: 0.81 },
  // REFIT: approved 0.65 → 0.994, add 0.282 pace. Band actually delivers 81% in-range at ±7%.
  thu_close: { shopBaselineWeight: 0.00, paceWeight: 0.282, approvedWeight: 0.994, perBookedAppt:   0, baseConfidence: 0.81, intercept:   665, bandWidth: 0.07 },
  // REFIT: approved coef → ~1.0 (was 0.65). Band ±4% delivers 86% in-range.
  fri_mid:   { shopBaselineWeight: 0.00, paceWeight: 0.00,  approvedWeight: 0.999, perBookedAppt:   0, baseConfidence: 0.86, intercept:   961, bandWidth: 0.04 },
  fri_close: { shopBaselineWeight: 0.00, paceWeight: 0.00,  approvedWeight: 1.16,  perBookedAppt:   0, baseConfidence: 0.85 },
};

const RAMP_RATIO_THRESHOLD = 1.25; // trailing-4 median > 1.25 × trailing-12 → flag

/** Cap each individual approved job at the shop's 80th-pct job size before
 *  summing. Required from day one so a monster multi-week job can't skew
 *  the same-week projection. */
export function capPerJobAndSum(jobSubtotals: number[], shopCap: number): number {
  let s = 0;
  for (const j of jobSubtotals) s += Math.min(j, shopCap);
  return s;
}

export function projectV2(inp: V2Input): V2Output {
  const { label, elapsedBizFrac } = detectCheckpoint(inp.nowMtn);
  const w = WEIGHTS[label];
  const reasons: string[] = [];
  const contribs: V2Contribution[] = [];

  // 1) Revenue already posted — always added at face value.
  contribs.push({ label: 'Revenue posted so far this week', amount: Math.round(inp.revSoFar) });

  // 2) Pace adjustment — projects what the remaining business week will add at
  //    the current run-rate, weighted by paceWeight. Only meaningful once
  //    enough of the week has elapsed (the model coefficient does the right
  //    thing; we keep a floor on elapsed so we don't divide by ~0 at Mon AM).
  if (w.paceWeight > 0 && elapsedBizFrac > 0.05) {
    const paceProjected = inp.revSoFar / elapsedBizFrac;
    const pacePiece = (paceProjected - inp.revSoFar) * w.paceWeight;
    contribs.push({ label: `Pace adjustment (×${w.paceWeight.toFixed(2)} on rate to week-end)`, amount: Math.round(pacePiece) });
  }

  // 3) Approved-but-not-yet-billed work (already capped per job by caller).
  const approvedPiece = inp.approvedUnbilled * w.approvedWeight;
  contribs.push({ label: `Approved-unbilled work (capped, ×${w.approvedWeight.toFixed(2)})`, amount: Math.round(approvedPiece) });

  // 4) Booked appointments still ahead in the week.
  //    bookedAppts=null → cache was missing/expired. Do NOT fabricate 0.
  //    Skip the contribution and note the data gap; confidence drops slightly
  //    at the checkpoints where booked-appts matters most (Mon AM / Mon close).
  if (inp.bookedAppts == null) {
    if (w.perBookedAppt > 0) {
      reasons.push('Appointment data not yet warmed for this shop — projection excludes the booked-appts contribution; will refine once the cron fills it in.');
    }
  } else if (w.perBookedAppt > 0 && inp.bookedAppts > 0) {
    const bookedPiece = inp.bookedAppts * w.perBookedAppt;
    contribs.push({ label: `Booked appts remaining (${inp.bookedAppts} × $${w.perBookedAppt})`, amount: Math.round(bookedPiece) });
  }

  // 5) Shop baseline — early-week intercept only. Once rev_so_far carries the
  //    signal we drop it (data shows it overfits late in the week).
  if (w.shopBaselineWeight > 0 && inp.shopBaselineMedian > 0) {
    // baseline is "what's left of a typical week" relative to current pace
    const baselineLeftover = Math.max(0, inp.shopBaselineMedian - inp.revSoFar) * w.shopBaselineWeight;
    contribs.push({ label: `Shop baseline (trailing-12 median, ×${w.shopBaselineWeight.toFixed(2)})`, amount: Math.round(baselineLeftover) });
  }

  // 6) Pace-ratio-vs-trailing-12 (Tue-close only, OLS-fitted refinement).
  //    Captures shops running materially above/below their normal weekly
  //    run-rate by Tue evening. coef × (ratio × baseline_median).
  if (w.paceRatioCoef && elapsedBizFrac > 0.05 && inp.shopBaselineMedian > 0) {
    const ratio = (inp.revSoFar / elapsedBizFrac) / inp.shopBaselineMedian - 1.0;
    const adj = w.paceRatioCoef * ratio * inp.shopBaselineMedian;
    contribs.push({ label: `Pace-vs-norm adjustment (×${w.paceRatioCoef.toFixed(3)})`, amount: Math.round(adj) });
  }

  // 7) OLS-fitted intercept (Tue/Thu/Fri-mid refits carry this).
  if (w.intercept && w.intercept !== 0) {
    contribs.push({ label: 'Model intercept (fitted)', amount: Math.round(w.intercept) });
  }

  // Sum the contributions for the point estimate.
  const point = contribs.reduce((s, c) => s + c.amount, 0);

  // Confidence: backtest baseline minus a haircut when a signal the model
  // relies on at this checkpoint is missing (booked-appts cache cold).
  const apptsHaircut = (inp.bookedAppts == null && w.perBookedAppt > 0)
    ? Math.min(0.05, (w.perBookedAppt / 220) * 0.05) : 0;
  const confidence = Math.max(0, w.baseConfidence - apptsHaircut);
  // Range half-width: explicit walk-forward measurement when present;
  // otherwise legacy 1−confidence tie. Decoupling lets a tight model honestly
  // surface a narrow range without inflating the confidence claim.
  const errBand = w.bandWidth ?? (1 - confidence);
  const low = Math.round(point * (1 - errBand));
  const high = Math.round(point * (1 + errBand));

  // Ramp guardrail: surface a warning only — model is unchanged.
  let isRamping = false;
  let rampWarning: string | undefined;
  if (inp.shopBaselineMedian > 0 && inp.shopBaselineTrailing4 > 0) {
    const ratio = inp.shopBaselineTrailing4 / inp.shopBaselineMedian;
    if (ratio > RAMP_RATIO_THRESHOLD) {
      isRamping = true;
      rampWarning = `Trailing-4-wk median is ${Math.round((ratio - 1) * 100)}% above the trailing-12 baseline — baseline may be catching up to a ramp. Projection still uses the trailing-12 figure; QC the shop intercept on the next refit.`;
      reasons.push(rampWarning);
    }
  }

  return {
    modelVersion: MODEL_VERSION,
    checkpoint: label,
    elapsedBizFrac,
    point: Math.max(0, Math.round(point)),
    low: Math.max(0, low),
    high: Math.max(0, high),
    confidence,
    isRamping,
    rampWarning,
    contributions: contribs,
    reasons,
  };
}
