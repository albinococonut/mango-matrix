// Parts Matrix calculation for Mango Automotive.
// Source: Tekmetric Shop Settings → Parts Markup
// The Tekmetric /parts-matrix API endpoint returns 404, so tiers are hard-coded
// from the shop settings UI. Update this file if tiers change.
//
// Main Matrix (Compound): default matrix — auto-applied to All Part Types.
// Compound method: each tier's multiplier applies only to the cost PORTION
// that falls within that tier (like tax brackets), then the results are summed.
//
// All other matrices use the simple method: the multiplier for whichever
// bracket the full cost falls into applies to the entire cost.

type Tier = { upTo: number; mult: number };

// ---- Compound calculation ----

const COMPOUND_TIERS: Tier[] = [
  { upTo: 5.00,     mult: 4.82 },
  { upTo: 10.00,    mult: 4.02 },
  { upTo: 20.00,    mult: 3.62 },
  { upTo: 30.00,    mult: 3.22 },
  { upTo: 50.00,    mult: 2.81 },
  { upTo: 100.00,   mult: 2.41 },
  { upTo: 200.00,   mult: 2.01 },
  { upTo: 300.00,   mult: 1.97 },
  { upTo: 500.00,   mult: 1.86 },
  { upTo: 1000.00,  mult: 1.73 },
  { upTo: Infinity, mult: 1.40 },
];

function compoundRetail(costCents: number): number {
  if (costCents <= 0) return 0;
  const cost = costCents / 100;
  let retail = 0;
  let prev = 0;
  for (const tier of COMPOUND_TIERS) {
    const cap = Math.min(cost, tier.upTo);
    const portion = cap - prev;
    if (portion <= 0) break;
    retail += portion * tier.mult;
    prev = cap;
    if (cost <= tier.upTo) break;
  }
  return Math.round(retail * 100);
}

// ---- Simple calculation ----

function simpleRetail(costCents: number, tiers: Tier[]): number {
  if (costCents <= 0) return 0;
  const cost = costCents / 100;
  for (const tier of tiers) {
    if (cost <= tier.upTo) return Math.round(cost * tier.mult * 100);
  }
  return Math.round(cost * tiers[tiers.length - 1].mult * 100);
}

// ---- Other matrix tier definitions (all simple method) ----

const SENSITIVE_TIERS: Tier[] = [
  { upTo: 2.75,     mult: 6.50 },
  { upTo: 6.59,     mult: 5.75 },
  { upTo: 12.09,    mult: 3.34 },
  { upTo: 17.59,    mult: 2.86 },
  { upTo: 21.99,    mult: 2.50 },
  { upTo: 28.59,    mult: 2.35 },
  { upTo: 56.09,    mult: 1.90 },
  { upTo: 83.59,    mult: 1.82 },
  { upTo: 111.09,   mult: 1.67 },
  { upTo: 276.09,   mult: 1.54 },
  { upTo: Infinity, mult: 1.33 },
];

const TIRES_TIERS:           Tier[] = [{ upTo: Infinity, mult: 1.26 }];
const NAPA_OIL_FILTER_TIERS: Tier[] = [{ upTo: Infinity, mult: 2.00 }];
const NAPA_AIR_FILTER_TIERS: Tier[] = [
  { upTo: 5.00,     mult: 5.00 },
  { upTo: 8.00,     mult: 3.50 },
  { upTo: 10.50,    mult: 2.75 },
  { upTo: 12.50,    mult: 2.25 },
  { upTo: 15.00,    mult: 2.00 },
  { upTo: Infinity, mult: 1.75 },
];
const BATTERY_TIERS:     Tier[] = [{ upTo: Infinity, mult: 1.65 }];
const SPARK_PLUG_TIERS:  Tier[] = [{ upTo: Infinity, mult: 1.75 }];
const WIPER_BLADE_TIERS: Tier[] = [{ upTo: Infinity, mult: 2.00 }];

const ALL_SIMPLE_MATRICES: Tier[][] = [
  SENSITIVE_TIERS,
  TIRES_TIERS,
  NAPA_OIL_FILTER_TIERS,
  NAPA_AIR_FILTER_TIERS,
  BATTERY_TIERS,
  SPARK_PLUG_TIERS,
  WIPER_BLADE_TIERS,
];

// ---- Public API ----

export type PricingType = 'canned' | 'matrix' | 'manual' | 'no_charge';

// Returns true if the retail price matches any known Tekmetric pricing matrix
// within a ±10¢ rounding tolerance.
function matchesAnyMatrix(costCents: number, retailCents: number): boolean {
  const tol = 10;
  if (Math.abs(retailCents - compoundRetail(costCents)) <= tol) return true;
  for (const tiers of ALL_SIMPLE_MATRICES) {
    if (Math.abs(retailCents - simpleRetail(costCents, tiers)) <= tol) return true;
  }
  return false;
}

// Returns the expected matrix retail price in cents for a given cost.
// If the actual retail matches a specific matrix, returns that matrix's price
// (so variance shows $0 for correctly-priced parts). Falls back to compound
// for manual parts — compound is the target benchmark for lost-revenue display.
export function matrixRetail(costCents: number, actualRetailCents?: number): number {
  if (actualRetailCents !== undefined) {
    const tol = 10;
    if (Math.abs(actualRetailCents - compoundRetail(costCents)) <= tol) return compoundRetail(costCents);
    for (const tiers of ALL_SIMPLE_MATRICES) {
      const expected = simpleRetail(costCents, tiers);
      if (Math.abs(actualRetailCents - expected) <= tol) return expected;
    }
  }
  return compoundRetail(costCents);
}

// Classify a single part's pricing against all known matrices.
// - canned:    job is a canned-job template (price was set in the template, not by a tech)
// - matrix:    price matches a matrix, job was built manually
// - manual:    NOT in a canned job AND price deviates from all known matrices
// - no_charge: both cost and retail are $0
//
// Canned-job parts are always 'canned' regardless of matrix match — the price
// was intentionally set in the template, so it is never a manual override.
//
// partTypeCode: Tekmetric's partType.code ('INVENTORY', 'PART', etc.)
// INVENTORY parts are auto-priced from the shop's inventory catalog and are
// treated as system-priced regardless of whether their price matches a matrix.
export function classifyPricing(
  costCents: number,
  retailCents: number,
  cannedJobId: number | null,
  partTypeCode?: string,
): PricingType {
  if (costCents === 0 && retailCents === 0) return 'no_charge';
  if (costCents <= 0) return 'manual';
  if (cannedJobId !== null) return 'canned';
  if (partTypeCode === 'INVENTORY') return 'matrix';
  if (matchesAnyMatrix(costCents, retailCents)) return 'matrix';
  return 'manual';
}
