#!/usr/bin/env python3
"""Signal-quality research per weekday checkpoint.

For each checkpoint:
  1. Walk-forward replay current v2 → residual (y_final − point).
  2. Correlate residual with every available feature; rank features by how
     much they'd EXPLAIN the leftover error if added to the model.
  3. Per-shop: where do errors cluster (chronic over- vs under-projection)?
  4. Greedy: which SINGLE-feature addition tightens p80(|err|/point) most?
  5. Test the user's blended Thu formula (rev_so_far + approved×k + pace×k')
     — find the (k, k') that minimizes Thu p80.
"""
import json, statistics, math
from collections import defaultdict

WEIGHTS = {
    'mon_am':    {'baseline':1.00,'pace':0.00,'approved':0.55,'perAppt':220,'conf':0.66},
    'mon_close': {'baseline':0.50,'pace':0.30,'approved':0.65,'perAppt':200,'conf':0.73},
    'tue_close': {'baseline':0.00,'pace':0.70,'approved':0.70,'perAppt':180,'conf':0.72},
    'wed_close': {'baseline':0.00,'pace':0.70,'approved':0.70,'perAppt': 60,'conf':0.81},
    'thu_close': {'baseline':0.00,'pace':0.00,'approved':0.65,'perAppt':  0,'conf':0.75},
    'fri_mid':   {'baseline':0.00,'pace':0.00,'approved':0.65,'perAppt':  0,'conf':0.85},
    'fri_close': {'baseline':0.00,'pace':0.00,'approved':1.16,'perAppt':  0,'conf':0.85},
}
# Features as captured by the backtest harness.
FEATS = ['rev_so_far','approved_unbilled','booked_appts','calls_so_far',
         'calls_booked_so_far','cars_so_far','gp_so_far_pct','aro_so_far','elapsed_biz_frac']
ORDER = ['mon_am','mon_close','tue_close','wed_close','thu_close','fri_mid','fri_close']

def project(row, t12):
    w = WEIGHTS[row['checkpoint']]
    rev = row['rev_so_far']; appr = row['approved_unbilled']; appts = row['booked_appts']
    elapsed = row['elapsed_biz_frac']
    point = rev
    if w['pace'] > 0 and elapsed > 0.05:
        point += (rev / elapsed - rev) * w['pace']
    point += appr * w['approved']
    if w['perAppt'] > 0 and appts > 0:
        point += appts * w['perAppt']
    if w['baseline'] > 0 and t12 > 0:
        point += max(0, t12 - rev) * w['baseline']
    return max(0, point)

def pearson(xs, ys):
    n = len(xs)
    if n < 3: return 0.0
    mx, my = sum(xs)/n, sum(ys)/n
    num = sum((xs[i]-mx)*(ys[i]-my) for i in range(n))
    dx = math.sqrt(sum((x-mx)**2 for x in xs))
    dy = math.sqrt(sum((y-my)**2 for y in ys))
    return 0.0 if dx*dy == 0 else num/(dx*dy)

def p80(xs):
    if not xs: return 0
    s = sorted(xs)
    return s[min(len(s)-1, int(len(s)*0.80))]

def load_walkforward(data, last_n_weeks=12):
    weeks = sorted(set(r['week'] for r in data))
    last = set(weeks[-last_n_weeks:])
    y_by_sw = {(r['week'], r['shop']): r['y_final'] for r in data}
    hist = defaultdict(list)
    for (w,s), y in y_by_sw.items(): hist[s].append((w, y))
    for s in hist: hist[s].sort()
    out = defaultdict(list)  # cp -> [(row, t12, point, y_final, residual, residual_pct)]
    for r in data:
        if r['week'] not in last: continue
        s = r['shop']
        prior = [y for (w,y) in hist[s] if w < r['week']]
        if len(prior) < 4: continue
        t12 = statistics.median(prior[-12:])
        p = project(r, t12)
        y = r['y_final']
        if y <= 0 or p <= 0: continue
        resid = y - p
        out[r['checkpoint']].append({
            **r, 'shop_t12_median': t12, 'point': p, 'residual': resid,
            'residual_pct': resid / p,  # signed: + = under-projection
        })
    return out

def fit_one_feature_addition(rows_cp, feature):
    """Fit y_final = point + b · feature, find b that minimizes p80 of new error."""
    # Adjust each row's point by adding b·feat; choose b to minimize p80.
    # Try a small grid and pick the best. (Continuous optimum is the
    # least-squares one; the grid is robust enough for ranking.)
    xs = [r[feature] for r in rows_cp]
    resids = [r['residual'] for r in rows_cp]
    if not xs or all(x == 0 for x in xs): return None
    # OLS coefficient: b = cov(x, resid) / var(x)
    mx = sum(xs)/len(xs); mr = sum(resids)/len(resids)
    num = sum((x-mx)*(r-mr) for x,r in zip(xs,resids))
    den = sum((x-mx)**2 for x in xs)
    if den == 0: return None
    b = num/den
    new_errs = []
    for r in rows_cp:
        p_new = r['point'] + b * r[feature]
        if p_new <= 0: continue
        new_errs.append(abs(r['y_final'] - p_new) / p_new)
    new_p80 = p80(new_errs)
    return b, new_p80

def main():
    data = [r for r in json.load(open('data/backtest_2026.json')) if r['week'] >= '2026-01-05']
    bycp = load_walkforward(data, last_n_weeks=12)

    print("# Signal-quality research per checkpoint")
    print("# Each row uses ONLY data available at that checkpoint (walk-forward).")
    print(f"# n per checkpoint: up to 8 shops × 12 weeks = 96 replays\n")

    for cp in ORDER:
        rows = bycp.get(cp, [])
        if len(rows) < 10: continue
        # Baseline current-model p80
        cur_errs = [abs(r['residual']) / r['point'] for r in rows]
        cur_p80 = p80(cur_errs)
        cur_band_pct = cur_p80 * 100
        print(f"## {cp}  (current band ±{cur_band_pct:.1f}% to hit 80% coverage)")

        # 1. Residual correlations — what's the current model NOT capturing?
        rs = [r['residual'] for r in rows]
        rs_pct = [r['residual_pct'] for r in rows]
        print(f"   residual sign:  median {statistics.median(rs):+,.0f}   mean {sum(rs)/len(rs):+,.0f}   (+ = under-projection)")
        print(f"   residual$ correlations with features:")
        corrs = []
        for f in FEATS:
            xs = [r[f] for r in rows]
            c = pearson(xs, rs)
            corrs.append((c, f))
        corrs.sort(key=lambda x: -abs(x[0]))
        for c, f in corrs[:5]:
            print(f"      {f:<22} r = {c:+.3f}")

        # 2. Greedy single-feature addition
        print(f"   single-feature addition that most tightens p80 band:")
        candidates = []
        for f in FEATS:
            r = fit_one_feature_addition(rows, f)
            if r is None: continue
            b, new_p80 = r
            candidates.append((new_p80, f, b))
        candidates.sort()
        # Plus a couple of engineered features
        # 'rev_pace_ratio' = (rev_so_far/elapsed) / shop_t12_median — flags under/over-pacing
        def add_engineered(name, fn):
            try:
                xs = [fn(r) for r in rows]
                resids = [r['residual'] for r in rows]
                mx = sum(xs)/len(xs); mr = sum(resids)/len(resids)
                num = sum((x-mx)*(r-mr) for x,r in zip(xs,resids))
                den = sum((x-mx)**2 for x in xs)
                if den == 0: return
                b = num/den
                new_errs = []
                for x, r in zip(xs, rows):
                    p_new = r['point'] + b*x
                    if p_new > 0: new_errs.append(abs(r['y_final']-p_new)/p_new)
                np80 = p80(new_errs)
                candidates.append((np80, 'ENG:'+name, b))
            except Exception: pass
        add_engineered('pace_ratio_vs_t12',  lambda r: (r['rev_so_far']/max(r['elapsed_biz_frac'],0.01))/max(r['shop_t12_median'],1) - 1)
        add_engineered('approved_per_car',   lambda r: r['approved_unbilled']/max(r['cars_so_far'],1))
        add_engineered('booked_per_car',     lambda r: r['booked_appts']/max(r['cars_so_far'],1))
        add_engineered('shop_t12_median',    lambda r: r['shop_t12_median'])
        candidates.sort()
        for new_p80, f, b in candidates[:6]:
            improve = cur_p80 - new_p80
            print(f"      add {f:<28} coef {b:+.3f}  →  p80 ±{new_p80*100:5.1f}%  (Δ {-improve*100:+5.1f}pp)")

        # 3. Per-shop residual cluster
        per_shop_resid = defaultdict(list)
        for r in rows: per_shop_resid[r['shop']].append(r['residual_pct'])
        print(f"   per-shop systematic over/under-projection (mean residual%):")
        for s in sorted(per_shop_resid):
            mr = statistics.mean(per_shop_resid[s])
            print(f"      shop {s}: {mr*100:+5.1f}%  (n={len(per_shop_resid[s])})")
        print()

    # 4. Why Wed > Thu? Test blended Thu formula
    print("\n## Why Wed > Thu — test blended Thu formula")
    thu = bycp.get('thu_close', [])
    if thu:
        # Try: point = rev + approved×k + (rev/elapsed - rev)×k2 for grids
        best = None
        for k in [0.5, 0.65, 0.8, 0.9, 1.0]:
            for k2 in [0.0, 0.1, 0.2, 0.3, 0.4]:
                errs = []
                for r in thu:
                    p = r['rev_so_far'] + r['approved_unbilled']*k
                    if r['elapsed_biz_frac'] > 0.05:
                        p += (r['rev_so_far']/r['elapsed_biz_frac'] - r['rev_so_far']) * k2
                    if p > 0:
                        errs.append(abs(r['y_final'] - p)/p)
                if not errs: continue
                p_80 = p80(errs); mean = sum(errs)/len(errs)
                if best is None or p_80 < best[0]:
                    best = (p_80, mean, k, k2)
        cur = p80([abs(r['residual'])/r['point'] for r in thu])
        bp80, bmean, bk, bk2 = best
        print(f"   current Thu p80 ±{cur*100:5.1f}%  | best grid: approved×{bk}  +  pace×{bk2}  →  p80 ±{bp80*100:5.1f}%  mean {bmean*100:5.1f}%")

if __name__ == '__main__':
    main()
