// Parts Matrix calculation for Mango Automotive.
// Source: Tekmetric Shop Settings → Parts Markup → Main Matrix (Compound)
// The Tekmetric /parts-matrix API endpoint returns 404, so tiers are hard-coded
// from the shop settings UI. Update this file if tiers change.
//
// Compound method: each tier's multiplier applies only to the cost PORTION that
// falls within that tier (like tax brackets), then the results are summed.

const COMPOUND_TIERS: { upTo: number; mult: number }[] = [
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

// Returns the expected retail price in CENTS for a given cost in CENTS.
export function matrixRetail(costCents: number): number {
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

export type PricingType = 'canned' | 'matrix' | 'manual' | 'no_charge';

// Classify a single part's pricing against the matrix.
// - canned:    price matches matrix AND the job is a canned-job template
// - matrix:    price matches matrix, job was built manually
// - manual:    price deviates from matrix — always flagged, even inside canned jobs
//              (so manual overrides within templates are visible, not hidden)
// - no_charge: both cost and retail are $0
//
// partTypeCode: Tekmetric's partType.code ('INVENTORY', 'PART', etc.)
// 'INVENTORY' parts are auto-priced by Tekmetric's inventory pricing system,
// not by a technician. They're treated as system-priced (matrix-equivalent)
// even if the stored inventory price doesn't exactly match our compound matrix.
export function classifyPricing(
  costCents: number,
  retailCents: number,
  cannedJobId: number | null,
  partTypeCode?: string,
): PricingType {
  if (costCents === 0 && retailCents === 0) return 'no_charge';
  if (costCents <= 0) return 'manual';
  if (partTypeCode === 'INVENTORY') {
    return cannedJobId !== null ? 'canned' : 'matrix';
  }
  const expected = matrixRetail(costCents);
  if (Math.abs(retailCents - expected) <= 10) {
    return cannedJobId !== null ? 'canned' : 'matrix';
  }
  return 'manual';
}
