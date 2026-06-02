#!/usr/bin/env python3
"""Surgical v2 refinement: Thu / Tue / Fri-mid only.
Pure stdlib. Leave-one-week-out CV gates overfit. No new data, no new features
beyond pace_ratio_vs_t12 at Tue.
"""
import json, math, statistics
from collections import defaultdict

# Existing v2 weights (post-calibration).
CUR = {
    'mon_am':    {'baseline':1.00,'pace':0.00,'approved':0.55,'perAppt':220,'conf':0.66},
    'mon_close': {'baseline':0.50,'pace':0.30,'approved':0.65,'perAppt':200,'conf':0.73},
    'tue_close': {'baseline':0.00,'pace':0.70,'approved':0.70,'perAppt':180,'conf':0.72},
    'wed_close': {'baseline':0.00,'pace':0.70,'approved':0.70,'perAppt': 60,'conf':0.81},
    'thu_close': {'baseline':0.00,'pace':0.00,'approved':0.65,'perAppt':  0,'conf':0.75},
    'fri_mid':   {'baseline':0.00,'pace':0.00,'approved':0.65,'perAppt':  0,'conf':0.85},
    'fri_close': {'baseline':0.00,'pace':0.00,'approved':1.16,'perAppt':  0,'conf':0.85},
}
ORDER = ['mon_am','mon_close','tue_close','wed_close','thu_close','fri_mid','fri_close']

def current_point(row, t12):
    w = CUR[row['checkpoint']]
    rev = row['rev_so_far']; appr = row['approved_unbilled']; appts = row['booked_appts']
    elapsed = row['elapsed_biz_frac']
    p = rev
    if w['pace'] > 0 and elapsed > 0.05:
        p += (rev / elapsed - rev) * w['pace']
    p += appr * w['approved']
    if w['perAppt'] > 0 and appts > 0:
        p += appts * w['perAppt']
    if w['baseline'] > 0 and t12 > 0:
        p += max(0, t12 - rev) * w['baseline']
    return max(0, p)

def p80(xs):
    if not xs: return 0
    s = sorted(xs)
    return s[min(len(s)-1, int(len(s)*0.80))]

# --- minimal OLS for 1/2-coefficient fits ----------------------------------
def fit_thu(rows):
    """Solve OLS: y_final = rev + k1·approved + k2·(rev/elapsed − rev) + b.
    Returns (k1, k2, b)."""
    # Effective features = [approved_unbilled, pace_addition], target = y_final − rev_so_far
    X = []
    y = []
    for r in rows:
        rev = r['rev_so_far']; e = r['elapsed_biz_frac']
        if e <= 0.05: continue
        pace_add = rev/e - rev
        X.append([1.0, r['approved_unbilled'], pace_add])
        y.append(r['y_final'] - rev)
    n = len(X);
    if n < 4: return None
    # Normal equations
    K = 3
    XtX = [[sum(X[i][a]*X[i][b] for i in range(n)) for b in range(K)] for a in range(K)]
    Xty = [sum(X[i][a]*y[i] for i in range(n)) for a in range(K)]
    inv = mat_inv(XtX)
    if inv is None: return None
    b_coef = [sum(inv[a][c]*Xty[c] for c in range(K)) for a in range(K)]
    return b_coef[1], b_coef[2], b_coef[0]  # (k_approved, k_pace, intercept)

def fit_fri_mid(rows):
    """y_final = rev + k1·approved + b."""
    X = [[1.0, r['approved_unbilled']] for r in rows]
    y = [r['y_final'] - r['rev_so_far'] for r in rows]
    n = len(X)
    if n < 3: return None
    K = 2
    XtX = [[sum(X[i][a]*X[i][b] for i in range(n)) for b in range(K)] for a in range(K)]
    Xty = [sum(X[i][a]*y[i] for i in range(n)) for a in range(K)]
    inv = mat_inv(XtX)
    if inv is None: return None
    b = [sum(inv[a][c]*Xty[c] for c in range(K)) for a in range(K)]
    return b[1], b[0]  # (k_approved, intercept)

def fit_tue(rows):
    """Add pace_ratio_vs_t12 to current Tue formula.
    Refits the existing terms simultaneously for stability."""
    X = []
    y = []
    for r in rows:
        rev = r['rev_so_far']; e = r['elapsed_biz_frac']
        if e <= 0.05 or r['shop_t12_median'] <= 0: continue
        pace = rev/e - rev
        ratio = (rev/e) / r['shop_t12_median'] - 1.0
        appts = r['booked_appts']
        X.append([1.0, pace, r['approved_unbilled'], appts, ratio * r['shop_t12_median']])  # last term: ratio scaled
        y.append(r['y_final'] - rev)
    n = len(X)
    if n < 6: return None
    K = 5
    XtX = [[sum(X[i][a]*X[i][b] for i in range(n)) for b in range(K)] for a in range(K)]
    Xty = [sum(X[i][a]*y[i] for i in range(n)) for a in range(K)]
    inv = mat_inv(XtX)
    if inv is None: return None
    b = [sum(inv[a][c]*Xty[c] for c in range(K)) for a in range(K)]
    return b  # [intercept, pace_coef, appr_coef, appt_coef, ratio_coef]

def mat_inv(M):
    n = len(M)
    A = [row[:] + [1.0 if i==j else 0.0 for j in range(n)] for i,row in enumerate(M)]
    for col in range(n):
        pr = max(range(col,n), key=lambda r: abs(A[r][col]))
        A[col], A[pr] = A[pr], A[col]
        piv = A[col][col]
        if abs(piv) < 1e-12: return None
        for j in range(2*n): A[col][j] /= piv
        for r in range(n):
            if r == col: continue
            f = A[r][col]
            if f == 0: continue
            for j in range(2*n): A[r][j] -= f*A[col][j]
    return [row[n:] for row in A]

def thu_point_with_coefs(r, k_approved, k_pace, intercept):
    rev = r['rev_so_far']; e = r['elapsed_biz_frac']
    p = rev + intercept + k_approved * r['approved_unbilled']
    if e > 0.05:
        p += k_pace * (rev/e - rev)
    return max(0, p)

def fri_mid_point_with_coefs(r, k_approved, intercept):
    return max(0, r['rev_so_far'] + intercept + k_approved * r['approved_unbilled'])

def tue_point_with_coefs(r, coefs):
    intercept, k_pace, k_appr, k_appt, k_ratio = coefs
    rev = r['rev_so_far']; e = r['elapsed_biz_frac']
    if e <= 0.05 or r['shop_t12_median'] <= 0: return current_point(r, r['shop_t12_median'])
    ratio_scaled = ((rev/e)/r['shop_t12_median'] - 1.0) * r['shop_t12_median']
    p = rev + intercept + k_pace*(rev/e-rev) + k_appr*r['approved_unbilled'] + k_appt*r['booked_appts'] + k_ratio*ratio_scaled
    return max(0, p)

def walk_forward(data, last_n=12):
    weeks = sorted(set(r['week'] for r in data))
    last = set(weeks[-last_n:])
    y_by = {(r['week'], r['shop']): r['y_final'] for r in data}
    hist = defaultdict(list)
    for (w,s), y in y_by.items(): hist[s].append((w,y))
    for s in hist: hist[s].sort()
    out = defaultdict(list)
    for r in data:
        if r['week'] not in last: continue
        prior = [y for (w,y) in hist[r['shop']] if w < r['week']]
        if len(prior) < 4: continue
        t12 = statistics.median(prior[-12:])
        out[r['checkpoint']].append({**r, 'shop_t12_median': t12})
    return out

def loo_eval(rows_cp, fit_fn, point_fn):
    """Leave-one-WEEK-out: hold all rows of one week out, fit on others,
    eval held-out. Returns (held_out_p80, held_out_mean, in_sample_p80_final)."""
    weeks_present = sorted(set(r['week'] for r in rows_cp))
    held_errs = []
    for w_out in weeks_present:
        train = [r for r in rows_cp if r['week'] != w_out]
        test  = [r for r in rows_cp if r['week'] == w_out]
        coefs = fit_fn(train)
        if coefs is None: continue
        for r in test:
            p = point_fn(r, coefs)
            if p > 0 and r['y_final'] > 0:
                held_errs.append(abs(r['y_final'] - p) / p)
    final = fit_fn(rows_cp)
    in_errs = []
    if final is not None:
        for r in rows_cp:
            p = point_fn(r, final)
            if p > 0: in_errs.append(abs(r['y_final'] - p) / p)
    return p80(held_errs), statistics.mean(held_errs) if held_errs else 0, p80(in_errs), final

# --- Half-split stability test --------------------------------------------
def split_half_stability(rows_cp, fit_fn):
    weeks = sorted(set(r['week'] for r in rows_cp))
    mid = len(weeks) // 2
    e_weeks = set(weeks[:mid]); l_weeks = set(weeks[mid:])
    e_rows = [r for r in rows_cp if r['week'] in e_weeks]
    l_rows = [r for r in rows_cp if r['week'] in l_weeks]
    return fit_fn(e_rows), fit_fn(l_rows)

def main():
    data = [r for r in json.load(open('data/backtest_2026.json')) if r['week'] >= '2026-01-05']
    bycp = walk_forward(data, last_n=12)

    # Wrap thu_point with 3-tuple coefs unpacking
    thu_pt = lambda r, c: thu_point_with_coefs(r, c[0], c[1], c[2])
    fri_pt = lambda r, c: fri_mid_point_with_coefs(r, c[0], c[1])
    tue_pt = tue_point_with_coefs

    # Current baseline p80 per checkpoint
    def current_p80(cp):
        errs = []
        for r in bycp.get(cp, []):
            p = current_point(r, r['shop_t12_median'])
            if p > 0: errs.append(abs(r['y_final'] - p) / p)
        return p80(errs), statistics.mean(errs) if errs else 0, errs

    out = {}
    print("# v2 surgical refinement — LOO-CV gated, no new features beyond pace_ratio_vs_t12 at Tue\n")
    print(f"{'cp':<11} {'before p80':>11} {'LOO p80':>9} {'in-samp p80':>13} {'overfit?':>10}  coefs (held-out fit)")
    print("-" * 100)

    cur_thu_p80, cur_thu_mean, _ = current_p80('thu_close')
    loo, mean_h, ins, final = loo_eval(bycp['thu_close'], fit_thu, thu_pt)
    overfit = 'OK' if loo - ins <= 0.04 else f'⚠ {(loo-ins)*100:.1f}pp gap'
    print(f"{'thu_close':<11} {cur_thu_p80*100:>10.1f}% {loo*100:>8.1f}% {ins*100:>12.1f}% {overfit:>10}  k_approved={final[0]:.3f}  k_pace={final[1]:.3f}  b={final[2]:+,.0f}")
    out['thu_close'] = (cur_thu_p80, loo, ins, final, mean_h)

    cur_fri_p80, cur_fri_mean, _ = current_p80('fri_mid')
    loo, mean_h, ins, final = loo_eval(bycp['fri_mid'], fit_fri_mid, fri_pt)
    overfit = 'OK' if loo - ins <= 0.04 else f'⚠ {(loo-ins)*100:.1f}pp gap'
    print(f"{'fri_mid':<11} {cur_fri_p80*100:>10.1f}% {loo*100:>8.1f}% {ins*100:>12.1f}% {overfit:>10}  k_approved={final[0]:.3f}  b={final[1]:+,.0f}")
    out['fri_mid'] = (cur_fri_p80, loo, ins, final, mean_h)

    cur_tue_p80, cur_tue_mean, _ = current_p80('tue_close')
    loo, mean_h, ins, final = loo_eval(bycp['tue_close'], fit_tue, tue_pt)
    overfit = 'OK' if loo - ins <= 0.04 else f'⚠ {(loo-ins)*100:.1f}pp gap'
    print(f"{'tue_close':<11} {cur_tue_p80*100:>10.1f}% {loo*100:>8.1f}% {ins*100:>12.1f}% {overfit:>10}  b={final[0]:+,.0f}  k_pace={final[1]:.3f}  k_appr={final[2]:.3f}  k_appt={final[3]:+.1f}  k_ratio={final[4]:.3f}")
    out['tue_close'] = (cur_tue_p80, loo, ins, final, mean_h)

    # Half-split stability for top 3 refits
    print("\n# Half-split stability check (early-6wks vs late-6wks fits — coefs should be similar)")
    for cp, fit_fn, names in [
        ('thu_close', fit_thu, ['k_appr','k_pace','b']),
        ('fri_mid', fit_fri_mid, ['k_appr','b']),
        ('tue_close', fit_tue, ['b','k_pace','k_appr','k_appt','k_ratio'])]:
        e, l = split_half_stability(bycp[cp], fit_fn)
        if e is None or l is None: continue
        print(f"  {cp}:")
        for i, n in enumerate(names):
            ev = e[i]; lv = l[i]
            drift = abs(ev - lv)
            tag = '' if drift < abs(ev) * 0.5 or abs(ev) < 0.01 else '  ⚠ drift'
            print(f"     {n:<10}  early {ev:+10.3f}    late {lv:+10.3f}{tag}")

    # Build new WEIGHTS dict (only updated checkpoints) and confidence bands
    print("\n# Recommended new bands (band = held-out LOO p80, slightly conservative)")
    print(f"{'cp':<11} {'old conf':>9} {'new conf':>9} {'band':>8}")
    new_conf = {}
    for cp in ORDER:
        if cp in out:
            _, loo, _, _, _ = out[cp]
            # Slightly conservative: use ceil to nearest 1pp
            band = math.ceil(loo * 100) / 100
            conf = 1 - band
        else:
            conf = CUR[cp]['conf']
        old = CUR[cp]['conf']
        new_conf[cp] = conf
        print(f"  {cp:<11} {old*100:>7.0f}%  {conf*100:>7.0f}%  ±{(1-conf)*100:>5.1f}%")

    # Per-shop residual summary on the refined models
    print("\n# Per-shop residual at Tue/Thu/Fri-mid AFTER refit (held-out LOO residual%)")
    for cp, point_fn in [('tue_close', tue_pt), ('thu_close', thu_pt), ('fri_mid', fri_pt)]:
        if cp not in out: continue
        per_shop = defaultdict(list)
        weeks_present = sorted(set(r['week'] for r in bycp[cp]))
        # LOO again, capturing per-shop held-out residuals
        for w_out in weeks_present:
            train = [r for r in bycp[cp] if r['week'] != w_out]
            test  = [r for r in bycp[cp] if r['week'] == w_out]
            coefs = (fit_thu if cp=='thu_close' else (fit_fri_mid if cp=='fri_mid' else fit_tue))(train)
            if coefs is None: continue
            for r in test:
                p = point_fn(r, coefs)
                if p > 0: per_shop[r['shop']].append((r['y_final']-p)/p)
        print(f"  {cp}: ")
        for s in sorted(per_shop):
            arr = per_shop[s]
            m = statistics.mean(arr) if arr else 0
            print(f"     shop {s}: mean residual {m*100:+5.1f}%  n={len(arr)}")

if __name__ == '__main__':
    main()
