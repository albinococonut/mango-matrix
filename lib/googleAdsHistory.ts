// Permanent Redis storage for Google Ads phone call data, keyed by ISO week.
// No TTL — historical weeks are immutable once stored. Recent weeks are
// re-fetched and updated on each backfill pass.

import { readCache, writeCache } from '@/lib/cache';
import { fetchPhoneCallsByWeek } from '@/lib/googleAds';

const KEY_PREFIX = 'gads_calls_wk_';

// shopNum → call count for one ISO week. 'all' holds the total.
export type WeekCallMap = Record<string, number>;

// Mapping from lowercase keywords in campaign names → shop number
const SHOP_KEYWORDS: Array<{ num: string; keywords: string[] }> = [
  { num: '001', keywords: ['cottonwood'] },
  { num: '002', keywords: ['heights'] },
  { num: '003', keywords: ['downtown'] },
  { num: '004', keywords: ['pellicano'] },
  { num: '005', keywords: ['las cruces', 'cruces'] },
  { num: '006', keywords: ['yuma'] },
  { num: '007', keywords: ['montana'] },
  { num: '009', keywords: ['valley'] },
];

export function matchCampaignToShop(campaignName: string): string | null {
  const lower = campaignName.toLowerCase();
  for (const { num, keywords } of SHOP_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return num;
  }
  return null;
}

function weekKey(weekISO: string): string {
  return KEY_PREFIX + weekISO;
}

export async function readWeekCalls(weekISO: string): Promise<WeekCallMap | null> {
  return readCache<WeekCallMap>(weekKey(weekISO));
}

export async function writeWeekCalls(weekISO: string, data: WeekCallMap): Promise<void> {
  // No TTL — historical data is permanent; caller re-writes recent weeks to update.
  await writeCache(weekKey(weekISO), data, { ttlSeconds: 0 });
}

// Fetch a date range from Google Ads, bucket by week+shop, write to Redis.
// Returns the number of week records written.
export async function backfillRange(
  customerIds: string[],
  startDate: string,
  endDate: string,
): Promise<number> {
  // Collect all rows across all customer accounts
  const allRows = (
    await Promise.all(customerIds.map((id) => fetchPhoneCallsByWeek(id, startDate, endDate)))
  ).flat();

  // Bucket by weekISO
  const byWeek = new Map<string, WeekCallMap>();
  for (const row of allRows) {
    if (!row.weekISO) continue;
    if (!byWeek.has(row.weekISO)) byWeek.set(row.weekISO, { all: 0 });
    const wk = byWeek.get(row.weekISO)!;
    wk.all = (wk.all ?? 0) + row.phoneCalls;
    const shopNum = matchCampaignToShop(row.campaignName);
    if (shopNum) wk[shopNum] = (wk[shopNum] ?? 0) + row.phoneCalls;
  }

  // Persist each week
  await Promise.all(
    Array.from(byWeek.entries()).map(([wk, data]) => writeWeekCalls(wk, data)),
  );

  return byWeek.size;
}

// Read call data for a list of ISO week dates (parallel Redis reads).
export async function readMultiWeekCalls(
  weekISOs: string[],
): Promise<Record<string, WeekCallMap | null>> {
  const results = await Promise.all(weekISOs.map((w) => readWeekCalls(w)));
  return Object.fromEntries(weekISOs.map((w, i) => [w, results[i]]));
}
