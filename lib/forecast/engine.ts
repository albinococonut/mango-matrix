// Per-shop revenue forecasting engine. Each shop is modelled INDEPENDENTLY:
// its own recency-weighted baseline, its own strongest predictors, its own
// volatility/confidence. District and portfolio numbers are pure roll-ups of
// the independent shop projections — never a blended company number divided
// out. Everything here is a deterministic pure function so it can be
// backtested against history (see backtestShop).

import type { WeekPoint } from './history';

// ---- small stats helpers --------------------------------------------------

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
/** Newest-weighted mean. decay 0.85 → last week ~1, 8 weeks ago ~0.27. */
function recencyMean(xs: number[], decay = 0.85): number {
  if (!xs.length) return 0;
  let num = 0, den = 0;
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(decay, n - 1 - i); // i=n-1 (newest) → w=1
    num += w * xs[i];
    den += w;
  }
  return den ? num / den : 0;
}
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}
function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}
function median(xs: number[]): number {
  return percentile(xs, 50);
}
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

// ---- types ----------------------------------------------------------------

export interface PeriodSpec {
  key: string;
  label: string;
  workingDaysTotal: number;   // working days in the full period
  workingDaysElapsed: number; // working days already elapsed (0 if future)
  isFuture: boolean;          // period entirely in the future (no actuals)
  // Optional day-of-week-aware elapsed REVENUE fraction (0..1): the share of a
  // typical period's revenue that historically lands by now, learned per shop
  // (e.g. Mon ≈ 14%, by Fri ≈ 75% because Fridays are heavy). When present it
  // replaces flat working-day proration so a Monday doesn't look catastrophic
  // and a post-Friday reading isn't overstated.
  revenueElapsedFraction?: number;
  // Optional EMPIRICAL holiday-week multiplier (this period ≈ N normal-weeks of
  // volume), learned per shop from prior same-holiday weeks in the archive. When
  // present it REPLACES the flat working-day proration (workingDays/5): a
  // Memorial-Day week is scaled by how that shop actually performed on past
  // Memorial weeks, not a mechanical 4/5. Falls back to working-day proration
  // when no prior holiday data exists yet.
  holidayFactor?: number;
  holidayNote?: string;       // surfaced as a confidence/explanation reason
}

export interface ShopActuals {
  revenue: number;   // realized so far in the period
  cars: number;
  gpDollars: number;
  billedHours: number;
}

export interface Driver {
  metric: string;       // human label
  r: number;            // signed correlation with weekly revenue
  strength: 'strong' | 'moderate' | 'weak';
  direction: 'positive' | 'negative';
  note: string;         // operational, shop-specific sentence
}

export interface Lever {
  lever: string;
  detail: string;       // plain-language, realistic action
  dollarImpact: number; // bounded by the remaining gap
  ease: 'easy' | 'moderate' | 'hard'; // how reachable vs this shop's own swings
  easeWhy: string;      // one phrase explaining the ease rating
}

export interface ShopProjection {
  shopNum: string;
  shopName: string;
  district: string;
  // headline projections for the selected period
  projectedRevenue: number;
  expected: number;
  bestCase: number;
  worstCase: number;
  projectedCars: number;
  projectedGpDollars: number;
  projectedAro: number;
  projectedGpPct: number;
  // goal context
  goalRevenue: number | null;
  pctToGoal: number | null;     // expected / goal
  onTrack: boolean | null;
  // pacing vs this shop's own normal
  baselineForPeriod: number;    // what a normal period looks like for THIS shop
  pacingVsNormalPct: number;    // (expected - baseline)/baseline * 100
  // explainability
  confidence: number;           // 0..100
  confidenceLabel: 'High' | 'Moderate' | 'Low' | 'Very Low';
  confidenceReasons: string[];  // WHY confidence is reduced (specific)
  drivers: Driver[];            // top predictors for THIS shop
  driftNote: string | null;     // predictor that strengthened/weakened recently
  levers: Lever[];              // realistic ways to close the gap (or tailwinds)
  headline: string;             // one-line operational summary
  changeSinceYesterday: number | null; // Δ expected vs yesterday's snapshot
  weeksOfHistory: number;
}

// ---- core projection ------------------------------------------------------

const TREND_CAP = 0.04;        // ±4% from short-term trend
const PREDICTOR_CAP = 0.08;    // ±8% nudge from the strongest predictor's momentum
const TYPICAL_WEEK_WORKDAYS = 5;

interface ProjectInput {
  shopNum: string;
  shopName: string;
  district: string;
  history: (WeekPoint | null)[]; // oldest → newest, completed weeks
  period: PeriodSpec;
  actuals: ShopActuals;          // zero if future period
  goalRevenue: number | null;
  isRamping: boolean;
  prevExpected?: number | null;  // yesterday's expected for this shop+period
}

function fmtUsd(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

const PREDICTORS: { key: keyof WeekPoint; label: string; lowerBetter?: boolean }[] = [
  { key: 'cars', label: 'Car count' },
  { key: 'aro', label: 'ARO' },
  { key: 'closeRate', label: 'Close rate' },
  { key: 'billedHours', label: 'Tech hours produced' },
  { key: 'conversion', label: 'Call conversion' },
  { key: 'rebook', label: 'Re-book rate' },
  { key: 'comebacks', label: 'Comebacks', lowerBetter: true },
];

export function projectShop(inp: ProjectInput): ShopProjection {
  const pts = inp.history.filter((p): p is WeekPoint => !!p);
  const n = pts.length;
  const rev = pts.map((p) => p.revenue);
  // "How many normal-weeks of volume is this period worth." Default = working
  // days / 5. For a holiday short week we instead use the EMPIRICAL multiplier
  // learned from prior same-holiday weeks (e.g. ~0.74 for Memorial Day at this
  // shop), so the whole projection (revenue, cars, band) scales to the real
  // holiday level rather than a flat 4/5. Everything downstream uses this.
  const naturalWeeks = Math.max(0.2, inp.period.workingDaysTotal / TYPICAL_WEEK_WORKDAYS);
  const periodWeeks = inp.period.holidayFactor != null && inp.period.holidayFactor > 0
    ? Math.max(0.05, inp.period.holidayFactor)
    : naturalWeeks;

  // --- baseline (recency-weighted, last up to 12 completed weeks) ---
  const recent = pts.slice(-12);
  const recentRev = recent.map((p) => p.revenue);
  const weeklyStd = std(recentRev.slice(-10));
  // Robust baseline: blend the recency-weighted mean with the trailing median.
  // The median resists single-week spikes (a $60k blowout week shouldn't drag
  // next week's forecast up), which is what hurt the volatile/new shops most.
  const recMean = recencyMean(recentRev);
  const med = median(recentRev.slice(-8));
  const stableBaseline = med > 0 ? 0.55 * recMean + 0.45 * med : recMean;
  const cvProbe = stableBaseline > 0 ? weeklyStd / stableBaseline : 1;
  // Young or highly-volatile shops are often non-stationary (a level shift, not
  // noise). An 8-week median lags a downshift and systematically overshoots, so
  // for those shops track the recent level fast (decay-weighted last 4 weeks)
  // instead of a lagging median.
  const fastBaseline = recencyMean(recentRev.slice(-4), 0.7);
  const adaptive = inp.isRamping || cvProbe > 0.35;
  const baselineWeekly = adaptive && fastBaseline > 0 ? fastBaseline : stableBaseline;
  const cv = baselineWeekly > 0 ? weeklyStd / baselineWeekly : 1;

  // Short-term linear trend (capped). Skipped for thin/volatile history where
  // a fitted slope is mostly noise and amplifies error.
  let trendAdj = 0;
  if (n >= 6 && cv < 0.35) {
    const w = rev.slice(-8);
    const xs = w.map((_, i) => i);
    const mx = mean(xs), my = mean(w);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < w.length; i++) { sxy += (xs[i] - mx) * (w[i] - my); sxx += (xs[i] - mx) ** 2; }
    const slope = sxx ? sxy / sxx : 0;
    trendAdj = clamp(my > 0 ? (slope * 2) / my : 0, -TREND_CAP, TREND_CAP); // ~2 wks of trend
  }

  // --- per-shop predictor analysis ---
  const drivers: Driver[] = [];
  let topPredictor: { key: keyof WeekPoint; label: string; r: number; lowerBetter?: boolean } | null = null;
  for (const pr of PREDICTORS) {
    const pairs = pts
      .map((p) => [p[pr.key] as number | null, p.revenue] as const)
      .filter(([v]) => v != null) as [number, number][];
    if (pairs.length < 6) continue;
    const r = pearson(pairs.map((x) => x[0]), pairs.map((x) => x[1]));
    if (Math.abs(r) < 0.3) continue;
    const direction: 'positive' | 'negative' = r >= 0 ? 'positive' : 'negative';
    const strength = Math.abs(r) >= 0.6 ? 'strong' : Math.abs(r) >= 0.45 ? 'moderate' : 'weak';
    drivers.push({
      metric: pr.label, r: Math.round(r * 100) / 100, strength, direction,
      note: `${pr.label} ${strength === 'strong' ? 'strongly' : strength === 'moderate' ? 'clearly' : 'somewhat'} tracks this shop's weekly revenue (r=${r.toFixed(2)}).`,
    });
    if (!topPredictor || Math.abs(r) > Math.abs(topPredictor.r)) topPredictor = { key: pr.key, label: pr.label, r, lowerBetter: pr.lowerBetter };
  }
  drivers.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const topDrivers = drivers.slice(0, 3);

  // predictor-momentum nudge: if the strongest predictor's latest completed
  // week is meaningfully off its own trailing norm, lean the forecast that way
  // (bounded — no wild swings).
  let predictorAdj = 0;
  let momentumNote: string | null = null;
  // Momentum only when there's enough stable history for it to be signal, not
  // noise — thin or volatile shops were over-reacting to a single off week.
  if (topPredictor && Math.abs(topPredictor.r) >= 0.5 && n >= 12 && cv < 0.28) {
    const series = pts.map((p) => p[topPredictor!.key] as number | null);
    const valid = series.map((v, i) => [v, i] as const).filter(([v]) => v != null) as [number, number][];
    if (valid.length >= 6) {
      const vals = valid.map((x) => x[0]);
      const last = vals[vals.length - 1];
      const norm = mean(vals.slice(-6, -1)); // prior 5 valid weeks
      if (norm > 0) {
        const rawDev = (last - norm) / norm;                 // how far last week ran off its norm
        const effDev = topPredictor.lowerBetter ? -rawDev : rawDev; // good-direction deviation
        // Move the forecast in the predictor's correlated direction, scaled by
        // |r| and bounded so a single noisy week can't swing it wildly.
        predictorAdj = clamp(Math.sign(topPredictor.r) * Math.abs(topPredictor.r) * effDev, -PREDICTOR_CAP, PREDICTOR_CAP);
        if (Math.abs(predictorAdj) >= 0.02) {
          momentumNote = `${topPredictor.label} ran ${effDev >= 0 ? 'above' : 'below'} its recent norm last week — nudging the forecast ${predictorAdj >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(predictorAdj * 100))}%.`;
        }
      }
    }
  }

  // predictor drift: did the top predictor strengthen/weaken recently?
  let driftNote: string | null = null;
  if (topPredictor && n >= 12) {
    const half = Math.floor(n / 2);
    const older = pts.slice(0, half);
    const newer = pts.slice(half);
    const rOf = (arr: WeekPoint[]) => {
      const pp = arr.map((p) => [p[topPredictor!.key] as number | null, p.revenue] as const).filter(([v]) => v != null) as [number, number][];
      return pp.length >= 4 ? pearson(pp.map((x) => x[0]), pp.map((x) => x[1])) : null;
    };
    const ro = rOf(older), rn = rOf(newer);
    if (ro != null && rn != null) {
      if (Math.abs(rn) - Math.abs(ro) >= 0.15) driftNote = `${topPredictor.label} has become a stronger predictor over the last ${newer.length} weeks (r ${ro.toFixed(2)} → ${rn.toFixed(2)}).`;
      else if (Math.abs(ro) - Math.abs(rn) >= 0.15) driftNote = `${topPredictor.label} is converting below its historical norm — it predicts revenue less reliably than it used to (r ${ro.toFixed(2)} → ${rn.toFixed(2)}).`;
    }
  }

  // --- projection ---
  const baselineForPeriod = baselineWeekly * periodWeeks;
  const factor = (1 + trendAdj) * (1 + predictorAdj);
  let expected: number;
  // Prefer the day-of-week-aware revenue fraction (learned per shop) over flat
  // working-day proration: revenue isn't earned evenly Mon→Fri.
  const elapsedFrac = inp.period.revenueElapsedFraction != null
    ? clamp(inp.period.revenueElapsedFraction, 0, 1)
    : inp.period.workingDaysTotal > 0
      ? clamp(inp.period.workingDaysElapsed / inp.period.workingDaysTotal, 0, 1)
      : 0;

  // Only trust live pacing once enough of the period has actually happened.
  // CRITICAL: on a Monday a weekly period has ~1 of 5 days in — extrapolating
  // that is meaningless and was dragging the forecast + denting confidence.
  // Multi-day periods need ≥2 working days AND ≥35% elapsed before pace gets
  // any weight; intraday ('today') just needs a third of the day.
  const multiDay = inp.period.workingDaysTotal > 1.5;
  const hasPaceSignal =
    !inp.period.isFuture && inp.actuals.revenue > 0 &&
    (multiDay
      ? inp.period.workingDaysElapsed >= 2 && elapsedFrac >= 0.35
      : elapsedFrac >= 0.30);

  if (!hasPaceSignal) {
    // Too early (e.g. Monday of the week) → this IS the full-period forecast
    // from this shop's history. Not "we're behind", just "this is the week".
    expected = baselineForPeriod * factor;
  } else {
    // If the period is fully elapsed (≥99% of working days done) the week is
    // over — actuals ARE the final number; no predictor or blend needed.
    if (elapsedFrac >= 0.99) {
      expected = inp.actuals.revenue;
    } else {
      // blend this shop's CURRENT pacing with its own historical baseline.
      // Weight shifts toward pacing as the period fills in (compare current
      // pacing vs historical pacing — spec requirement).
      const paceProjection = inp.actuals.revenue / elapsedFrac;
      const w = Math.pow(elapsedFrac, 0.7);
      expected = (w * paceProjection + (1 - w) * baselineForPeriod) * (1 + predictorAdj);
    }
  }
  expected = Math.max(0, expected);

  // --- best / expected / worst ---
  const periodSigma = weeklyStd * Math.sqrt(Math.max(periodWeeks, 0.25));
  // Uncertainty only narrows once real pace has landed (not on Monday).
  const observedShrink = hasPaceSignal ? 1 - 0.6 * Math.pow(elapsedFrac, 0.7) : 1;
  // confidence widens the band (computed just below; placeholder then adjust)

  // --- confidence + specific reasons ---
  let confidence = 100;
  const reasons: string[] = [];
  if (n < 6) { confidence -= 45; reasons.push(`Only ${n} week${n === 1 ? '' : 's'} of history — not enough to model a stable pattern yet.`); }
  else if (n < 10) { confidence -= 20; reasons.push(`Limited history (${n} weeks) — the pattern is still firming up.`); }
  else if (n < 14) { confidence -= 8; reasons.push(`Moderate history (${n} weeks).`); }
  if (cv > 0.45) { confidence -= 30; reasons.push(`Revenue swings about ±${Math.round(cv * 100)}% week to week — an inconsistent pattern is hard to predict.`); }
  else if (cv > 0.30) { confidence -= 15; reasons.push(`Fairly volatile week-to-week revenue (±${Math.round(cv * 100)}%).`); }
  else if (cv > 0.20) { confidence -= 6; }
  if (inp.isRamping) { confidence -= 25; reasons.push(`Recently opened — limited operating history, behaviour still stabilising.`); }
  const last4 = pts.slice(-4);
  if (last4.length && last4.every((p) => p.rebook == null && p.conversion == null)) {
    confidence -= 10; reasons.push(`Missing leading indicators — call-conversion / re-book not recorded for recent weeks, so early-warning signal is weak.`);
  }
  // Only flag "pacing differently" once there's a real pace signal — never on
  // a Monday where 1 day can't represent the week.
  if (hasPaceSignal) {
    const pace = inp.actuals.revenue / elapsedFrac;
    if (baselineForPeriod > 0 && Math.abs(pace - baselineForPeriod) / baselineForPeriod > 0.40) {
      confidence -= 12; reasons.push(`This period is pacing very differently from this shop's norm — treat the projection as provisional until more days land.`);
    }
  }
  if (!topPredictor) { confidence -= 8; reasons.push(`No single operational signal predicts this shop's revenue strongly — drivers are mixed.`); }
  // Holiday short weeks carry more uncertainty (fewer comparable samples).
  if (inp.period.holidayNote) { confidence -= 6; reasons.push(inp.period.holidayNote); }
  if (inp.period.key === 'next_month' || inp.period.key === 'this_quarter') { confidence -= 10; reasons.push(`Longer horizon (${inp.period.label.toLowerCase()}) — further out is inherently less certain.`); }
  // Never claim HIGH confidence early in an in-progress multi-day period
  // (e.g. a Monday): almost none of the period's revenue has landed yet, so
  // the forecast is inherently provisional regardless of history quality.
  const multiDayPeriod = inp.period.workingDaysTotal > 1.5;
  if (!inp.period.isFuture && multiDayPeriod && elapsedFrac < 0.30) {
    if (confidence > 64) confidence = 64; // caps the label at "Moderate"
    reasons.push(`Very early in ${inp.period.label.toLowerCase()} — only ~${Math.round(elapsedFrac * 100)}% of a typical period's revenue has landed, so this is provisional.`);
  }
  confidence = Math.round(clamp(confidence, 5, 97));
  const confidenceLabel = confidence >= 80 ? 'High' : confidence >= 60 ? 'Moderate' : confidence >= 40 ? 'Low' : 'Very Low';

  // Period fully elapsed → no uncertainty remains; best/worst = actuals.
  const sigmaEff = elapsedFrac >= 0.99 ? 0 : periodSigma * observedShrink * (1 + (100 - confidence) / 120);
  const bestCase = Math.round(expected + sigmaEff);
  const worstCase = Math.round(Math.max(0, expected - sigmaEff));

  // --- coherent sub-metrics for the period ---
  const carsWeekly = recencyMean(recent.map((p) => p.cars));
  const gpPctBase = recent.length ? mean(recent.map((p) => p.gpPct)) : 0;
  const ratioVsBaseline = baselineForPeriod > 0 ? expected / baselineForPeriod : 1;
  const projectedCars = Math.max(0, Math.round(carsWeekly * periodWeeks * ratioVsBaseline));
  const projectedAro = projectedCars > 0 ? expected / projectedCars : 0;
  const projectedGpDollars = expected * gpPctBase;

  // --- goal context ---
  const goal = inp.goalRevenue && inp.goalRevenue > 0 ? inp.goalRevenue : null;
  const pctToGoal = goal ? expected / goal : null;
  const onTrack = pctToGoal == null ? null : pctToGoal >= 0.995;

  // --- realistic levers (only gains the shop has actually shown) ---
  // "Ease" = how big the required move is vs this shop's own normal week-to-
  // week swing in that metric. If a normal good week already covers it, it's
  // easy; if it needs to beat its own history, it's hard. This is what answers
  // "which is easiest?" — e.g. call conversion sitting far below its own good
  // weeks is an easy, high-yield lever, vs. a close rate already near ceiling.
  const levers: Lever[] = [];
  if (goal && expected < goal) {
    const gap = goal - expected;
    const last12 = pts.slice(-12);
    const easeOf = (lift: number, sd: number, why: string): { ease: Lever['ease']; easeWhy: string } => {
      if (sd <= 0) return { ease: 'moderate', easeWhy: why };
      const r = lift / sd;
      if (r <= 1) return { ease: 'easy', easeWhy: `${why} — within a normal good-week swing` };
      if (r <= 2) return { ease: 'moderate', easeWhy: `${why} — about two good weeks of movement` };
      return { ease: 'hard', easeWhy: `${why} — beyond this shop's recent range` };
    };

    const p75Cars = percentile(last12.map((p) => p.cars), 75);
    const p75Aro = percentile(last12.map((p) => p.aro), 75);
    const p75Close = percentile(last12.map((p) => p.closeRate), 75);
    const p75Hours = percentile(last12.map((p) => p.billedHours), 75);
    const closeBase = recencyMean(recent.map((p) => p.closeRate));
    const hoursBase = recencyMean(recent.map((p) => p.billedHours));
    const convVals = recent.map((p) => p.conversion).filter((v): v is number => v != null && v > 0);
    const convBase = convVals.length ? recencyMean(convVals) : 0;
    const convP75 = convVals.length >= 3 ? percentile(pts.slice(-12).map((p) => p.conversion).filter((v): v is number => v != null && v > 0), 75) : 0;

    const projWeeklyCars = projectedCars / periodWeeks;

    // 1) Call conversion → more cars (often the easiest: lots of room, no
    //    added capacity needed — just book more of the calls already coming in)
    if (convBase > 0 && convP75 > convBase + 1) {
      const convTarget = Math.min(convP75, convBase * 1.25); // realistic ≤ +25% relative
      const extraCars = projWeeklyCars * (convTarget / convBase - 1) * periodWeeks;
      const impact = Math.min(gap, extraCars * projectedAro);
      if (impact > gap * 0.02) {
        const e = easeOf(convTarget - convBase, std(convVals.slice(-8)), `conversion ${Math.round(convBase)}%→~${Math.round(convTarget)}% (its own good weeks)`);
        levers.push({ lever: 'Call conversion', detail: `Book more of the calls already coming in — lift conversion ${Math.round(convBase)}% → ~${Math.round(convTarget)}% (you hit that in good weeks) ≈ +${Math.round(extraCars)} cars. No extra capacity needed.`, dollarImpact: Math.round(impact), ...e });
      }
    }
    // 2) Car count (schedule capacity / show rate)
    if (p75Cars > projWeeklyCars * 1.02) {
      const extraCars = (p75Cars - projWeeklyCars) * periodWeeks;
      const impact = Math.min(gap, extraCars * projectedAro);
      if (impact > gap * 0.02) {
        const e = easeOf(p75Cars - projWeeklyCars, std(last12.map((p) => p.cars)), `~${Math.round(projWeeklyCars)}→${Math.round(p75Cars)} cars/wk`);
        levers.push({ lever: 'Car count', detail: `Fill the bays to ~${Math.round(p75Cars)} cars/week (your better weeks) from ~${Math.round(projWeeklyCars)} — schedule discipline & reduce no-shows.`, dollarImpact: Math.round(impact), ...e });
      }
    }
    // 3) ARO
    if (p75Aro > projectedAro * 1.01) {
      const aroLift = Math.min(p75Aro - projectedAro, projectedAro * 0.08); // cap +8%
      const impact = Math.min(gap, aroLift * projectedCars);
      if (impact > gap * 0.02) {
        const e = easeOf(aroLift, std(last12.map((p) => p.aro)), `ARO +${fmtUsd(aroLift)}`);
        levers.push({ lever: 'ARO', detail: `Lift ARO ~${fmtUsd(aroLift)} toward ${fmtUsd(p75Aro)} (your strong-week level) via thorough inspections & declined-work follow-up.`, dollarImpact: Math.round(impact), ...e });
      }
    }
    // 4) Close rate
    if (closeBase > 0 && p75Close > closeBase + 0.01) {
      const closeTarget = Math.min(p75Close, closeBase + 0.05); // realistic +≤5pp
      const impact = Math.min(gap, expected * (closeTarget / closeBase - 1));
      if (impact > gap * 0.02) {
        const e = easeOf(closeTarget - closeBase, std(last12.map((p) => p.closeRate)), `close ${Math.round(closeBase * 100)}%→${Math.round(closeTarget * 100)}%`);
        levers.push({ lever: 'Close rate', detail: `Raise close rate ${Math.round(closeBase * 100)}% → ~${Math.round(closeTarget * 100)}% (you've hit this) — better presentation & financing offers.`, dollarImpact: Math.round(impact), ...e });
      }
    }
    // 5) Tech hours (only if it actually predicts revenue here)
    const hoursDriver = drivers.find((d) => d.metric === 'Tech hours produced');
    if (hoursDriver && hoursBase > 0 && p75Hours > hoursBase * 1.03) {
      const impact = Math.min(gap, expected * Math.min(0.6, Math.abs(hoursDriver.r)) * ((p75Hours - hoursBase) / hoursBase));
      if (impact > gap * 0.02) {
        const e = easeOf(p75Hours - hoursBase, std(last12.map((p) => p.billedHours)), `tech hours →~${Math.round(p75Hours)}/wk`);
        levers.push({ lever: 'Tech hours', detail: `Recover tech hours toward ~${Math.round(p75Hours)}/week (your productive weeks) — this shop's revenue tracks billed hours.`, dollarImpact: Math.round(impact), ...e });
      }
    }
    levers.sort((a, b) => b.dollarImpact - a.dollarImpact);
  }
  // The single most useful lever: prefer a high-impact one that's also easy
  // (don't recommend an unreachable close-rate jump over an easy conversion
  // win). Pick the easy/moderate lever with the most dollars; fall back to the
  // biggest overall.
  const easeRank = { easy: 0, moderate: 1, hard: 2 } as const;
  const bestLever =
    [...levers].sort((a, b) =>
      easeRank[a.ease] - easeRank[b.ease] || b.dollarImpact - a.dollarImpact,
    )[0] || null;

  // --- pacing vs this shop's own normal ---
  const pacingVsNormalPct = baselineForPeriod > 0 ? ((expected - baselineForPeriod) / baselineForPeriod) * 100 : 0;

  // --- headline ---
  let headline: string;
  if (goal) {
    if (onTrack) {
      const tail = topDrivers[0] ? ` Strongest driver: ${topDrivers[0].metric.toLowerCase()}.` : '';
      headline = `On pace — ${fmtUsd(expected)} projected, ~${Math.round((pctToGoal as number) * 100)}% of the ${fmtUsd(goal)} goal.${tail}`;
    } else {
      const short = fmtUsd(goal - expected);
      const biggest = levers[0];
      if (!biggest) {
        headline = `Projected to finish ~${short} under the ${fmtUsd(goal)} goal; no single lever closes it — needs broad lift.`;
      } else if (bestLever && bestLever.lever !== biggest.lever) {
        headline = `Projected ~${short} under goal. Easiest win: ${bestLever.lever.toLowerCase()} (${bestLever.ease}, ≈${fmtUsd(bestLever.dollarImpact)}). Biggest: ${biggest.lever.toLowerCase()} (≈${fmtUsd(biggest.dollarImpact)}).`;
      } else {
        headline = `Projected ~${short} under goal. Best lever: ${biggest.lever.toLowerCase()} (${biggest.ease}, ≈${fmtUsd(biggest.dollarImpact)} of the gap).`;
      }
    }
  } else {
    headline = `${fmtUsd(expected)} projected for ${inp.period.label.toLowerCase()} (${pacingVsNormalPct >= 0 ? '+' : ''}${Math.round(pacingVsNormalPct)}% vs this shop's normal).`;
  }

  const changeSinceYesterday = inp.prevExpected != null ? Math.round(expected - inp.prevExpected) : null;

  return {
    shopNum: inp.shopNum, shopName: inp.shopName, district: inp.district,
    projectedRevenue: Math.round(expected),
    expected: Math.round(expected),
    bestCase, worstCase,
    projectedCars,
    projectedGpDollars: Math.round(projectedGpDollars),
    projectedAro: Math.round(projectedAro),
    projectedGpPct: Math.round(gpPctBase * 1000) / 10,
    goalRevenue: goal,
    pctToGoal: pctToGoal == null ? null : Math.round(pctToGoal * 1000) / 10,
    onTrack,
    baselineForPeriod: Math.round(baselineForPeriod),
    pacingVsNormalPct: Math.round(pacingVsNormalPct * 10) / 10,
    confidence, confidenceLabel,
    confidenceReasons: reasons,
    drivers: topDrivers,
    driftNote: driftNote || momentumNote,
    levers: levers.slice(0, 3),
    headline,
    changeSinceYesterday,
    weeksOfHistory: n,
  };
}

// ---- roll-up (shop → district → portfolio) --------------------------------

export interface RollUp {
  label: string;
  projectedRevenue: number;
  expected: number;
  bestCase: number;
  worstCase: number;
  projectedCars: number;
  projectedGpDollars: number;
  projectedAro: number;
  goalRevenue: number | null;
  pctToGoal: number | null;
  onTrack: boolean | null;
  confidence: number;            // revenue-weighted avg of member shops
  confidenceLabel: 'High' | 'Moderate' | 'Low' | 'Very Low';
  shopNums: string[];
  topDrivers: { metric: string; shops: number }[]; // which signals matter across members
  ahead: { shopNum: string; shopName: string; pct: number }[];
  behind: { shopNum: string; shopName: string; pct: number }[];
  changeSinceYesterday: number | null;
}

export function rollUp(label: string, shops: ShopProjection[]): RollUp {
  const expected = shops.reduce((s, x) => s + x.expected, 0);
  const goalVals = shops.map((s) => s.goalRevenue).filter((g): g is number => g != null);
  const goal = goalVals.length === shops.length && shops.length ? goalVals.reduce((s, g) => s + g, 0) : null;
  const wConf = expected > 0 ? shops.reduce((s, x) => s + x.confidence * x.expected, 0) / expected : mean(shops.map((s) => s.confidence));
  const confidence = Math.round(wConf);
  const driverCount = new Map<string, number>();
  for (const s of shops) for (const d of s.drivers) driverCount.set(d.metric, (driverCount.get(d.metric) ?? 0) + 1);
  const projCars = shops.reduce((s, x) => s + x.projectedCars, 0);
  const pctToGoal = goal ? expected / goal : null;
  const ranked = shops
    .filter((s) => s.goalRevenue)
    .map((s) => ({ shopNum: s.shopNum, shopName: s.shopName, pct: s.pctToGoal ?? 0 }))
    .sort((a, b) => b.pct - a.pct);
  const changes = shops.map((s) => s.changeSinceYesterday).filter((c): c is number => c != null);
  return {
    label,
    projectedRevenue: Math.round(expected),
    expected: Math.round(expected),
    bestCase: shops.reduce((s, x) => s + x.bestCase, 0),
    worstCase: shops.reduce((s, x) => s + x.worstCase, 0),
    projectedCars: projCars,
    projectedGpDollars: shops.reduce((s, x) => s + x.projectedGpDollars, 0),
    projectedAro: projCars > 0 ? Math.round(expected / projCars) : 0,
    goalRevenue: goal,
    pctToGoal: pctToGoal == null ? null : Math.round(pctToGoal * 1000) / 10,
    onTrack: pctToGoal == null ? null : pctToGoal >= 0.995,
    confidence,
    confidenceLabel: confidence >= 80 ? 'High' : confidence >= 60 ? 'Moderate' : confidence >= 40 ? 'Low' : 'Very Low',
    shopNums: shops.map((s) => s.shopNum),
    topDrivers: [...driverCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([metric, n]) => ({ metric, shops: n })),
    ahead: ranked.slice(0, 3),
    behind: ranked.slice(-3).reverse(),
    changeSinceYesterday: changes.length ? Math.round(changes.reduce((s, c) => s + c, 0)) : null,
  };
}

// ---- backtest (predict past weeks, compare to actuals) --------------------

export interface BacktestResult {
  weeksTested: number;
  mape: number;            // mean absolute % error (whole-week revenue)
  withinPctText: string;   // "accurate within X% over the last N weeks"
  recentTrend: string | null;
}

/**
 * Walk-forward backtest: for each of the last `maxTests` completed weeks, train
 * ONLY on the weeks before it and project that week's full revenue (no pacing,
 * exactly how a fresh forecast would behave), then compare to the actual. This
 * is the honest accuracy number we surface per shop.
 */
export function backtestShop(
  shopNum: string, shopName: string, district: string,
  history: (WeekPoint | null)[],
  isRamping: boolean,
  maxTests = 8,
): BacktestResult {
  const pts = history.filter((p): p is WeekPoint => !!p);
  const n = pts.length;
  const usable = Math.max(0, Math.min(maxTests, n - 6)); // need ≥6 weeks to train
  if (usable < 2) return { weeksTested: 0, mape: 0, withinPctText: 'Not enough history to measure accuracy yet.', recentTrend: null };
  const apes: number[] = [];
  for (let k = usable; k >= 1; k--) {
    const cut = n - k;                 // predict pts[cut] using pts[0..cut-1]
    const train = pts.slice(0, cut);
    const actual = pts[cut].revenue;
    if (actual <= 0) continue;
    const proj = projectShop({
      shopNum, shopName, district,
      history: train,
      period: { key: 'this_week', label: 'This week', workingDaysTotal: TYPICAL_WEEK_WORKDAYS, workingDaysElapsed: 0, isFuture: true },
      actuals: { revenue: 0, cars: 0, gpDollars: 0, billedHours: 0 },
      goalRevenue: null,
      isRamping,
    });
    apes.push(Math.abs(proj.expected - actual) / actual);
  }
  if (!apes.length) return { weeksTested: 0, mape: 0, withinPctText: 'Not enough clean weeks to measure accuracy.', recentTrend: null };
  const mape = mean(apes) * 100;
  let recentTrend: string | null = null;
  if (apes.length >= 4) {
    const half = Math.floor(apes.length / 2);
    const older = mean(apes.slice(0, half)) * 100;
    const newer = mean(apes.slice(half)) * 100;
    if (newer + 1.5 < older) recentTrend = `Accuracy improving — recent error ${newer.toFixed(1)}% vs ${older.toFixed(1)}% earlier.`;
    else if (newer > older + 1.5) recentTrend = `Accuracy slipping — recent error ${newer.toFixed(1)}% vs ${older.toFixed(1)}% earlier.`;
  }
  return {
    weeksTested: apes.length,
    mape: Math.round(mape * 10) / 10,
    withinPctText: `Weekly forecasts for this shop have been accurate within ${(Math.round(mape * 10) / 10).toFixed(1)}% over the last ${apes.length} weeks.`,
    recentTrend,
  };
}
