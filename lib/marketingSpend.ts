// Marketing spend data extracted from QuickBooks P&L monthly exports (Jan-Dec 2024)
// and PnLReview rolling files (Aug 2024 – Apr 2026).
// 2024 Jan-Jul: from individual shop "Profit and Loss by Month" xlsx files.
// 2024 Aug-Dec: from those same monthly files (more accurate than PnLReview).
// 2025-2026:    from PnLReview rolling 12-month files.
//
// GL codes:
//   6814 = Google Ads
//   6819 = Advertising & Marketing (includes postcards, direct mail, other)
//   6812 = Listing Fees

export interface MonthSpend {
  googleAds: number;   // 6814
  advertising: number; // 6819 — postcards + other
  listing: number;     // 6812
}

export interface PostcardCampaign {
  name: string;
  inHomeStart: string; // YYYY-MM-DD approximate
  inHomeEnd?: string;
  pieces: number;
}

// Monthly spend by shop. Keys are YYYY-MM.
// Shops 004 and 009 had no marketing spend in the covered periods.
// Shop 005 (Las Cruces) opened Apr 2024. Shop 007 (Montana) opened Oct 2024.
export const MONTHLY_SPEND: Record<string, Record<string, MonthSpend>> = {
  '001': {
    '2024-01': { googleAds: 4622, advertising:  6579, listing:  667 },
    '2024-02': { googleAds: 4071, advertising:  2531, listing:  667 },
    '2024-03': { googleAds: 3734, advertising:  8466, listing:  667 },
    '2024-04': { googleAds: 3788, advertising:  3989, listing:  667 },
    '2024-05': { googleAds: 3961, advertising: 10756, listing:  667 },
    '2024-06': { googleAds: 3466, advertising:  7213, listing:  667 },
    '2024-07': { googleAds: 4057, advertising:  6905, listing:  667 },
    '2024-08': { googleAds: 3959, advertising:  5889, listing:  667 },
    '2024-09': { googleAds: 3958, advertising:  6449, listing:  667 },
    '2024-10': { googleAds: 4099, advertising: 11028, listing: 1667 },
    '2024-11': { googleAds: 3201, advertising: 11127, listing: 1667 },
    '2024-12': { googleAds: 3955, advertising:  5302, listing: 1667 },
    '2025-01': { googleAds: 5109, advertising:  9115, listing:  917 },
    '2025-02': { googleAds: 4853, advertising:  5513, listing:  917 },
    '2025-03': { googleAds: 4936, advertising:  7318, listing:  917 },
    '2025-04': { googleAds: 4918, advertising:  4489, listing:  917 },
    '2025-05': { googleAds: 5618, advertising:  7301, listing:  917 },
    '2025-06': { googleAds: 4698, advertising:  4395, listing:  417 },
    '2025-07': { googleAds: 4860, advertising:  3684, listing:  417 },
    '2025-08': { googleAds: 5090, advertising:  3691, listing:  417 },
    '2025-09': { googleAds: 5781, advertising:  2447, listing:  417 },
    '2025-10': { googleAds: 9893, advertising:  1785, listing:  417 },
    '2025-11': { googleAds: 10088, advertising: 4991, listing:  417 },
    '2025-12': { googleAds: 4835, advertising:  3707, listing:  417 },
    '2026-01': { googleAds: 4955, advertising:  2588, listing:  417 },
    '2026-02': { googleAds: 4979, advertising:  3909, listing:  417 },
    '2026-03': { googleAds: 4280, advertising:  3780, listing:  417 },
    '2026-04': { googleAds: 4653, advertising:  5077, listing:  417 },
  },
  '002': {
    '2024-01': { googleAds: 3622, advertising:  6329, listing:  667 },
    '2024-02': { googleAds: 3457, advertising:  6340, listing: 1167 },
    '2024-03': { googleAds: 4599, advertising:  2467, listing:  667 },
    '2024-04': { googleAds: 3721, advertising:  3772, listing: 1167 },
    '2024-05': { googleAds: 3967, advertising: 11306, listing: 1167 },
    '2024-06': { googleAds: 3924, advertising:  4901, listing: 1167 },
    '2024-07': { googleAds: 3617, advertising:  4998, listing: 1167 },
    '2024-08': { googleAds: 3960, advertising:  4664, listing: 1167 },
    '2024-09': { googleAds: 3979, advertising:  5408, listing: 1167 },
    '2024-10': { googleAds: 4099, advertising:  9545, listing: 1167 },
    '2024-11': { googleAds: 3199, advertising:  6751, listing: 1167 },
    '2024-12': { googleAds: 4248, advertising:  4574, listing: 1167 },
    '2025-01': { googleAds: 4190, advertising:  6610, listing: 1084 },
    '2025-02': { googleAds: 4711, advertising:  7657, listing: 1084 },
    '2025-03': { googleAds: 4416, advertising:  3733, listing: 1084 },
    '2025-04': { googleAds: 4564, advertising:  1133, listing: 1084 },
    '2025-05': { googleAds: 5697, advertising:  5756, listing: 1084 },
    '2025-06': { googleAds: 5475, advertising:  2533, listing:  584 },
    '2025-07': { googleAds: 5663, advertising:  7274, listing:  584 },
    '2025-08': { googleAds: 5775, advertising:  1494, listing:  584 },
    '2025-09': { googleAds: 5049, advertising:   845, listing:  584 },
    '2025-10': { googleAds: 6105, advertising:  1391, listing:  584 },
    '2025-11': { googleAds: 5088, advertising:  5448, listing:  584 },
    '2025-12': { googleAds: 5363, advertising:  1126, listing:  584 },
    '2026-01': { googleAds: 5654, advertising:  2887, listing:  584 },
    '2026-02': { googleAds: 5684, advertising:  3142, listing:  584 },
    '2026-03': { googleAds: 5423, advertising:  4029, listing:  584 },
    '2026-04': { googleAds: 5922, advertising:  1564, listing:  584 },
  },
  '003': {
    '2024-01': { googleAds: 3599, advertising:  3138, listing: 0 },
    '2024-02': { googleAds: 3957, advertising:  7436, listing: 0 },
    '2024-03': { googleAds: 3743, advertising:  6105, listing: 0 },
    '2024-04': { googleAds: 3778, advertising:  2207, listing: 0 },
    '2024-05': { googleAds: 3966, advertising:  7429, listing: 0 },
    '2024-06': { googleAds: 3931, advertising:  4058, listing: 0 },
    '2024-07': { googleAds: 3599, advertising:  7046, listing: 0 },
    '2024-08': { googleAds: 3986, advertising:  4301, listing: 0 },
    '2024-09': { googleAds: 3872, advertising:  4316, listing: 0 },
    '2024-10': { googleAds: 4099, advertising:  9909, listing: 0 },
    '2024-11': { googleAds: 3199, advertising:  6829, listing: 0 },
    '2024-12': { googleAds: 4149, advertising:  6442, listing: 0 },
    '2025-01': { googleAds: 4467, advertising:  9801, listing: 0 },
    '2025-02': { googleAds: 4582, advertising:  4800, listing: 0 },
    '2025-03': { googleAds: 5562, advertising:  2359, listing: 0 },
    '2025-04': { googleAds: 5651, advertising:   983, listing: 0 },
    '2025-05': { googleAds: 8328, advertising:  4406, listing: 0 },
    '2025-06': { googleAds: 5373, advertising:  3940, listing: 0 },
    '2025-07': { googleAds: 5590, advertising:   909, listing: 0 },
    '2025-08': { googleAds: 5922, advertising:  1779, listing: 0 },
    '2025-09': { googleAds: 5584, advertising:  3874, listing: 0 },
    '2025-10': { googleAds: 6152, advertising:  1259, listing: 0 },
    '2025-11': { googleAds: 5214, advertising:  5837, listing: 0 },
    '2025-12': { googleAds: 5209, advertising:  2763, listing: 0 },
    '2026-01': { googleAds: 6146, advertising:   951, listing: 0 },
    '2026-02': { googleAds: 5650, advertising:  4180, listing: 0 },
    '2026-03': { googleAds: 5488, advertising:  2620, listing: 0 },
    '2026-04': { googleAds: 5828, advertising:  3409, listing: 0 },
  },
  '005': {
    // Opened Apr 2024 — Jan-Mar are zeroes
    '2024-04': { googleAds: 1110, advertising:  4732, listing: 0 },
    '2024-05': { googleAds: 1605, advertising:  4758, listing: 0 },
    '2024-06': { googleAds: 1649, advertising:  4927, listing: 0 },
    '2024-07': { googleAds: 2499, advertising:  5770, listing: 0 },
    '2024-08': { googleAds: 2199, advertising:  2831, listing: 0 },
    '2024-09': { googleAds: 1687, advertising: 15249, listing: 0 },
    '2024-10': { googleAds: 8560, advertising:  2676, listing: 0 },
    '2024-11': { googleAds: 7874, advertising:  1327, listing: 0 },
    '2024-12': { googleAds: 4905, advertising:  1293, listing: 0 },
    '2025-01': { googleAds: 2191, advertising:  4719, listing: 0 },
    '2025-02': { googleAds: 2440, advertising:  3764, listing: 0 },
    '2025-03': { googleAds: 2324, advertising:  2433, listing: 0 },
    '2025-04': { googleAds: 2419, advertising:  2464, listing: 0 },
    '2025-05': { googleAds: 2478, advertising:  4823, listing: 0 },
    '2025-06': { googleAds: 2437, advertising:  3362, listing: 0 },
    '2025-07': { googleAds: 2417, advertising:  2041, listing: 0 },
    '2025-08': { googleAds: 2383, advertising:  5417, listing: 0 },
    '2025-09': { googleAds: 2892, advertising:  5383, listing: 0 },
    '2025-10': { googleAds: 3737, advertising:  4047, listing: 0 },
    '2025-11': { googleAds: 2561, advertising:  4982, listing: 0 },
    '2025-12': { googleAds: 3026, advertising:  1771, listing: 0 },
    '2026-01': { googleAds: 2919, advertising:  3036, listing: 0 },
    '2026-02': { googleAds: 2395, advertising:  2493, listing: 0 },
    '2026-03': { googleAds: 2938, advertising:  2444, listing: 0 },
    '2026-04': { googleAds: 3419, advertising:  2483, listing: 0 },
  },
  '006': {
    '2024-01': { googleAds: 2761, advertising:  4653, listing:  667 },
    '2024-02': { googleAds: 3273, advertising:  9076, listing:  667 },
    '2024-03': { googleAds: 2136, advertising:  5320, listing:  667 },
    '2024-04': { googleAds: 2000, advertising:  5378, listing:  667 },
    '2024-05': { googleAds: 3299, advertising: 13543, listing:  667 },
    '2024-06': { googleAds: 2723, advertising:  9278, listing:  667 },
    '2024-07': { googleAds: 3499, advertising:  6423, listing:  667 },
    '2024-08': { googleAds: 3999, advertising:  4942, listing:  667 },
    '2024-09': { googleAds: 3506, advertising:  7387, listing:  667 },
    '2024-10': { googleAds: 3166, advertising: 10593, listing:  667 },
    '2024-11': { googleAds: 2892, advertising:  7220, listing: 2167 },
    '2024-12': { googleAds: 3461, advertising:  2657, listing: 2167 },
    '2025-01': { googleAds: 4596, advertising:  5501, listing:  917 },
    '2025-02': { googleAds: 3928, advertising:  4505, listing:  917 },
    '2025-03': { googleAds: 4678, advertising:  4461, listing:  917 },
    '2025-04': { googleAds: 5234, advertising:  4141, listing:  917 },
    '2025-05': { googleAds: 4850, advertising:  5522, listing:  917 },
    '2025-06': { googleAds: 4454, advertising:  2494, listing:  917 },
    '2025-07': { googleAds: 4966, advertising:  2999, listing:  917 },
    '2025-08': { googleAds: 4066, advertising:  3970, listing:  917 },
    '2025-09': { googleAds: 4783, advertising:  3844, listing:  917 },
    '2025-10': { googleAds: 4601, advertising:  3985, listing:  917 },
    '2025-11': { googleAds: 4131, advertising:  1382, listing:  917 },
    '2025-12': { googleAds: 5066, advertising:   429, listing:  917 },
    '2026-01': { googleAds: 4492, advertising:  1237, listing:  917 },
    '2026-02': { googleAds: 5438, advertising:  2120, listing:  917 },
    '2026-03': { googleAds: 6149, advertising:  1626, listing:  917 },
    '2026-04': { googleAds: 5374, advertising:   837, listing:  917 },
  },
  '007': {
    // Opened Oct 2024 — first meaningful spend in Dec 2024
    '2024-12': { googleAds: 1110, advertising:  5130, listing: 0 },
    '2025-01': { googleAds: 2641, advertising:  5127, listing: 0 },
    '2025-02': { googleAds: 3751, advertising: 11816, listing: 0 },
    '2025-03': { googleAds: 4373, advertising:  5125, listing: 0 },
    '2025-04': { googleAds: 4355, advertising:    81, listing: 0 },
    '2025-05': { googleAds: 5023, advertising:  5764, listing: 0 },
    '2025-06': { googleAds: 3038, advertising:  2531, listing: 0 },
    '2025-07': { googleAds: 3507, advertising:  2653, listing: 0 },
    '2025-08': { googleAds: 3278, advertising: 11874, listing: 0 },
    '2025-09': { googleAds: 3340, advertising:  6466, listing: 0 },
    '2025-10': { googleAds: 3128, advertising:  5209, listing: 0 },
    '2025-11': { googleAds: 2829, advertising:  1681, listing: 0 },
    '2025-12': { googleAds: 2810, advertising:     0, listing: 0 },
    '2026-01': { googleAds: 3527, advertising:   537, listing: 0 },
    '2026-02': { googleAds: 2901, advertising:   790, listing: 0 },
    '2026-03': { googleAds: 3938, advertising:  6444, listing: 0 },
    '2026-04': { googleAds: 3353, advertising:   682, listing: 0 },
  },
};

// UpSwell postcard campaigns (from full order history export, 4 pages).
// Date gaps = no campaigns were run during those periods.
export const POSTCARD_CAMPAIGNS: PostcardCampaign[] = [
  { name: 'Jan 2024 run',       inHomeStart: '2024-01-22', inHomeEnd: '2024-02-12', pieces: 27095 },
  { name: 'Feb 2024 run',       inHomeStart: '2024-03-04', inHomeEnd: '2024-03-18', pieces: 23666 },
  { name: 'Mar 2024 run',       inHomeStart: '2024-04-01', inHomeEnd: '2024-04-22', pieces: 29184 },
  { name: 'Apr/May 2024 run',   inHomeStart: '2024-05-06', inHomeEnd: '2024-05-27', pieces: 37661 },
  { name: 'May 2024 run',       inHomeStart: '2024-06-03', inHomeEnd: '2024-06-17', pieces: 23693 },
  // Jun–Sep 2024: no campaigns
  { name: 'Oct 2024 #15',       inHomeStart: '2024-10-28', inHomeEnd: '2024-11-01', pieces: 31306 },
  { name: 'Nov 2024 #3',        inHomeStart: '2024-11-16', inHomeEnd: '2024-11-18', pieces: 27319 },
  { name: 'Nov/Dec 2024 batch', inHomeStart: '2024-12-02', inHomeEnd: '2024-12-23', pieces: 60841 },
  { name: 'Dec 2024 #66/68',    inHomeStart: '2025-01-06', inHomeEnd: '2025-01-13', pieces: 10541 },
  // Jan–Mar 2025: no campaigns
  { name: 'Apr 2025 #41',       inHomeStart: '2025-05-12', inHomeEnd: '2025-05-16', pieces: 10205 },
  { name: 'Jun 2025 #50',       inHomeStart: '2025-06-30', inHomeEnd: '2025-07-07', pieces: 30272 },
  { name: 'Jun 2025 #99',       inHomeStart: '2025-07-14', inHomeEnd: '2025-07-18', pieces: 27989 },
  { name: 'Jul 2025 #141',      inHomeStart: '2025-08-04', inHomeEnd: '2025-08-08', pieces: 13004 },
  { name: 'Jul 2025 #136',      inHomeStart: '2025-08-07', inHomeEnd: '2025-08-11', pieces: 16172 },
  // Aug 2025–Jun 2026: no campaigns
  { name: 'Jul 2026 #139',      inHomeStart: '2026-08-10', inHomeEnd: '2026-08-14', pieces: 12576 },
  { name: 'Jul 2026 #141',      inHomeStart: '2026-08-13', inHomeEnd: '2026-08-17', pieces: 21064 },
];

/** All YYYY-MM keys present in MONTHLY_SPEND across any shop, sorted. */
export function allMonthlyMonths(): string[] {
  const s = new Set<string>();
  for (const shopData of Object.values(MONTHLY_SPEND)) {
    for (const m of Object.keys(shopData)) s.add(m);
  }
  return [...s].sort();
}

/** Chain-wide total spend for a given month. */
export function chainSpendForMonth(month: string): MonthSpend {
  let googleAds = 0, advertising = 0, listing = 0;
  for (const shopData of Object.values(MONTHLY_SPEND)) {
    const d = shopData[month];
    if (d) { googleAds += d.googleAds; advertising += d.advertising; listing += d.listing; }
  }
  return { googleAds, advertising, listing };
}

/** Per-shop spend for a given month (zeros for shops with no data). */
export function shopSpendForMonth(month: string): Record<string, MonthSpend> {
  const out: Record<string, MonthSpend> = {};
  for (const [num, shopData] of Object.entries(MONTHLY_SPEND)) {
    out[num] = shopData[month] ?? { googleAds: 0, advertising: 0, listing: 0 };
  }
  return out;
}
