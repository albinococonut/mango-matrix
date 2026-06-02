#!/usr/bin/env python3
"""Walk-forward calibration of v2 confidence at each weekday checkpoint.

For each of the last 12 completed weeks × 8 shops, replay the v2 engine
USING ONLY data available at that checkpoint (no peek-ahead), compute the
projection low/high range, and compare to the final settled weekly revenue.

Outputs per checkpoint:
  - MAPE (mean absolute % error) — chain-wide + per shop
  - In-range hit rate — what fraction of weeks the actual landed inside the
    model's stated low/high
  - Whether the stated confidence is calibrated: stated "X% confident" should
    mean the actual lands in-range ~X% of the time.

CAVEAT: the harness rows hold approved_unbilled summed without the
per-job 80th-pct cap (the cap is applied only by the live engine, not the
historical reconstruction). The cap only matters for outlier shop-weeks with
a monster approved job, so calibration directionally still holds.
"""
import json, statistics
from collections import defaultdict

WEIGHTS = {
    # SURGICAL REFIT: Tue/Thu/Fri-mid from LOO-CV (see scripts/refine_v2.py).
    'mon_am':    {'baseline': 1.00, 'pace': 0.000, 'approved': 0.550, 'perAppt': 220, 'conf': 0.66, 'intercept': 0,    'ratioCoef': 0},
    'mon_close': {'baseline': 0.50, 'pace': 0.300, 'approved': 0.650, 'perAppt': 200, 'conf': 0.73, 'intercept': 0,    'ratioCoef': 0},
    'tue_close': {'baseline': 0.00, 'pace': 0.297, 'approved': 0.842, 'perAppt': 302, 'conf': 0.79, 'intercept': 3232, 'ratioCoef': -0.172, 'band': 0.20},
    'wed_close': {'baseline': 0.00, 'pace': 0.700, 'approved': 0.700, 'perAppt':  60, 'conf': 0.81, 'intercept': 0,    'ratioCoef': 0,       'band': 0.19},
    'thu_close': {'baseline': 0.00, 'pace': 0.282, 'approved': 0.994, 'perAppt':   0, 'conf': 0.81, 'intercept': 665,  'ratioCoef': 0,       'band': 0.07},
    'fri_mid':   {'baseline': 0.00, 'pace': 0.000, 'approved': 0.999, 'perAppt':   0, 'conf': 0.86, 'intercept': 961,  'ratioCoef': 0,       'band': 0.04},
    'fri_close': {'baseline': 0.00, 'pace': 0.000, 'approved': 1.160, 'perAppt':   0, 'conf': 0.85, 'intercept': 0,    'ratioCoef': 0,       'band': 0.15},
}
ORDER = ['mon_close','tue_close','wed_close','thu_close','fri_mid','fri_close','mon_am']

def project(row, baseline_t12):
    w = WEIGHTS[row['checkpoint']]
    rev = row['rev_so_far']; appr = row['approved_unbilled']; appts = row['booked_appts']
    elapsed = row['elapsed_biz_frac']
    point = rev
    if w['pace'] > 0 and elapsed > 0.05:
        point += (rev / elapsed - rev) * w['pace']
    point += appr * w['approved']
    if w['perAppt'] > 0 and appts > 0:
        point += appts * w['perAppt']
    if w['baseline'] > 0 and baseline_t12 > 0:
        point += max(0, baseline_t12 - rev) * w['baseline']
    if w.get('ratioCoef', 0) and elapsed > 0.05 and baseline_t12 > 0:
        ratio = (rev / elapsed) / baseline_t12 - 1.0
        point += w['ratioCoef'] * ratio * baseline_t12
    point += w.get('intercept', 0)
    point = max(0, point)
    err_band = w.get('band', 1 - w['conf'])  # explicit band when present
    return point, point * (1 - err_band), point * (1 + err_band), w['conf']

def main():
    data = [r for r in json.load(open('data/backtest_2026.json')) if r['week'] >= '2026-01-05']
    weeks = sorted(set(r['week'] for r in data))
    last_12 = set(weeks[-12:])
    print(f"# Calibration on last 12 completed weeks: {sorted(last_12)[0]} → {sorted(last_12)[-1]}")
    print(f"# 8 shops × 12 weeks = up to 96 walk-forward replays per checkpoint")
    print(f"# Stated confidence is calibrated when in-range % ≈ stated conf %.\n")

    y_by_sw = {(r['week'], r['shop']): r['y_final'] for r in data}
    shop_hist = defaultdict(list)
    for (w, s), y in y_by_sw.items(): shop_hist[s].append((w, y))
    for s in shop_hist: shop_hist[s].sort()

    print(f"{'checkpoint':<12} {'n':>4} {'MAPE':>7} {'in-range':>9} {'stated':>8}  {'calibrated?':>14}")
    print("-" * 70)
    per_shop_collect = defaultdict(lambda: defaultdict(list))  # cp -> shop -> errs

    for cp in ORDER:
        errors = []; in_range = 0; rows = 0; in_range_by_shop = defaultdict(lambda: [0, 0])
        for r in data:
            if r['week'] not in last_12 or r['checkpoint'] != cp: continue
            s = r['shop']
            prior = [y for (w, y) in shop_hist[s] if w < r['week']]
            if len(prior) < 4: continue
            t12 = statistics.median(prior[-12:])
            point, low, high, conf = project(r, t12)
            y = r['y_final']
            if y <= 0: continue
            rows += 1
            errors.append(abs(point - y) / y)
            per_shop_collect[cp][s].append(abs(point - y) / y)
            in_r = low <= y <= high
            in_range += 1 if in_r else 0
            in_range_by_shop[s][0] += 1 if in_r else 0
            in_range_by_shop[s][1] += 1
        if not errors: print(f"{cp:<12} (no data)"); continue
        mape = statistics.mean(errors) * 100
        hit = in_range / rows * 100
        stated = WEIGHTS[cp]['conf'] * 100
        # Calibrated if hit-rate within ±10pp of stated confidence.
        diff = hit - stated
        if abs(diff) <= 10: verdict = 'calibrated'
        elif diff > 10:     verdict = 'over-conservative'
        else:               verdict = f'OVERCONFIDENT ({diff:+.0f}pp)'
        print(f"{cp:<12} {rows:>4} {mape:>6.1f}% {hit:>7.0f}% {stated:>7.0f}%   {verdict:>14}")

    # Per-shop drill for the user's specific question.
    for cp in ['mon_close','tue_close','wed_close','thu_close']:
        print(f"\n--- per-shop MAPE at {cp} (last 12 weeks) ---")
        for s in sorted(per_shop_collect[cp]):
            errs = per_shop_collect[cp][s]
            print(f"  shop {s}: MAPE {statistics.mean(errs)*100:5.1f}%   n={len(errs)}")

    # Suggested recalibration: empirical confidence = 1 - mean MAPE, clipped.
    print("\n--- suggested confidence (empirical, from this 12wk test) ---")
    print(f"{'checkpoint':<12} {'stated':>8} {'empirical':>10} {'suggested band ±%':>20}")
    for cp in ORDER:
        rows_cp = [r for r in data if r['week'] in last_12 and r['checkpoint'] == cp]
        if not rows_cp: continue
        cp_errs = []
        for r in rows_cp:
            s = r['shop']
            prior = [y for (w, y) in shop_hist[s] if w < r['week']]
            if len(prior) < 4: continue
            t12 = statistics.median(prior[-12:])
            p, _, _, _ = project(r, t12)
            # Use |y - point| / point so it matches the in-range check:
            # low/high = point × (1 ± band). p80 of THIS metric is the band
            # that delivers ~80% coverage.
            if p > 0 and r['y_final'] > 0: cp_errs.append(abs(p - r['y_final']) / p)
        if not cp_errs: continue
        cp_errs.sort()
        p80 = cp_errs[int(len(cp_errs) * 0.80)] if len(cp_errs) >= 5 else max(cp_errs)
        stated = WEIGHTS[cp]['conf']
        empirical = 1 - statistics.mean(cp_errs)
        print(f"  {cp:<12} {stated*100:>6.0f}% {empirical*100:>9.1f}%   band ±{p80*100:>5.1f}%  conf-for-80% ≈ {(1-p80)*100:>5.0f}%")

if __name__ == '__main__':
    main()
