// THE one heatmap color system for the entire dashboard. A single warm amber
// tonal scale — good performance is visually subtle, problems naturally stand
// out. No rainbow, no per-metric palettes, no per-shop colors. Charcoal text
// throughout. 5 tiers max.

// Colors resolve through CSS design tokens (app/globals.css :root). Defaults
// === the original warm amber scale, so the live heatmap is unchanged; under
// .theme-luxury these tokens become the luminous blue→coral spectrum. Returned
// as `rgb(var(--token))` strings used directly in inline `style` backgrounds.
export const HEAT = [
  'rgb(var(--mg-heat-1))', 'rgb(var(--mg-heat-2))', 'rgb(var(--mg-heat-3))',
  'rgb(var(--mg-heat-4))', 'rgb(var(--mg-heat-5))',
] as const;
export const HEAT_FG = 'rgb(var(--mg-heat-fg))';   // charcoal — readable on every tier
export const HEAT_EMPTY = 'rgb(var(--mg-heat-empty))'; // no-data cell (near-background)

export type Tier = 1 | 2 | 3 | 4 | 5; // 1 = best/subtle, 5 = worst/darkest

// Generic 5-tier legend (compact pill legend, upper-right of each heatmap).
export const LEGEND: { tier: Tier; label: string }[] = [
  { tier: 1, label: 'Excellent' },
  { tier: 2, label: 'Healthy' },
  { tier: 3, label: 'Watch' },
  { tier: 4, label: 'Problem' },
  { tier: 5, label: 'Critical' },
];

export function tierColor(tier: Tier | null): { bg: string; fg: string } {
  if (tier == null) return { bg: HEAT_EMPTY, fg: 'rgb(var(--mg-faint))' };
  return { bg: HEAT[tier - 1], fg: HEAT_FG };
}

/** Percent-to-goal metrics (revenue, cars, ARO). v = actual/goal ratio. */
export function pctTier(ratio: number | null): Tier | null {
  if (ratio == null || !isFinite(ratio)) return null;
  if (ratio >= 1.0) return 1;
  if (ratio >= 0.95) return 2;
  if (ratio >= 0.85) return 3;
  if (ratio >= 0.75) return 4;
  return 5;
}

/** GP% (absolute, 0..1). 58%+ Excellent → <50% Problem. */
export function gpTier(v: number | null): Tier | null {
  if (v == null) return null;
  if (v >= 0.58) return 1;
  if (v >= 0.55) return 2;
  if (v >= 0.52) return 3;
  if (v >= 0.50) return 4;
  return 5;
}

/** Close rate (absolute, 0..1). 85%+ Excellent → <55% Critical. */
export function closeTier(v: number | null): Tier | null {
  if (v == null) return null;
  if (v >= 0.85) return 1;
  if (v >= 0.75) return 2;
  if (v >= 0.65) return 3;
  if (v >= 0.55) return 4;
  return 5;
}

/** Google cumulative rating (0..5 stars). Per owner spec:
 *  4.9-5.0 awesome · 4.8 · 4.7 · 4.6 · 4.5-and-below really bad. */
export function ratingTier(v: number | null): Tier | null {
  if (v == null) return null;
  if (v >= 4.9) return 1;
  if (v >= 4.8) return 2;
  if (v >= 4.7) return 3;
  if (v >= 4.6) return 4;
  return 5; // 4.5 or below
}

/** Call conversion (0..100). Anchored at the 60% company target = Excellent,
 *  then a real-world spread so shops actually differentiate (the old 80%+
 *  Excellent scale painted nearly everything red). */
export function convTier(v: number | null): Tier | null {
  if (v == null) return null;
  if (v >= 60) return 1;
  if (v >= 45) return 2;
  if (v >= 35) return 3;
  if (v >= 25) return 4;
  return 5;
}

/** Comebacks — inverted (lower is better). 0 = excellent; scale vs the
 *  worst cell in view so differences stay calm, not alarming. */
export function comebackTier(v: number | null, max: number): Tier | null {
  if (v == null) return null;
  if (v <= 0) return 1;
  if (max <= 0) return 1;
  const r = v / max;
  if (r <= 0.15) return 2;
  if (r <= 0.35) return 3;
  if (r <= 0.60) return 4;
  return 5;
}

/** Reviews — higher better, but LOW visual aggression (never below tier 3). */
export function reviewTier(v: number | null): Tier | null {
  if (v == null) return null;
  if (v >= 3) return 1;
  if (v >= 1) return 2;
  return 3;
}

/** Re-books (0..100). Absolute, anchored at the 60% target = Excellent, with
 *  a full 5-tier spread. (Was relative-to-best-shop and capped at tier 3, so
 *  it never showed a problem/critical color — that's what looked "broken".) */
export function rebookTier(v: number | null): Tier | null {
  if (v == null) return null;
  if (v >= 60) return 1;
  if (v >= 45) return 2;
  if (v >= 30) return 3;
  if (v >= 15) return 4;
  return 5;
}
