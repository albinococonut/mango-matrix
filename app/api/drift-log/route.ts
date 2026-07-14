// GET /api/drift-log
// Returns the full persistent drift review log (all weeks, all entries).
// Seeds from snapshot-based drift reports (weekly_drift_v3_<weekStart>) written
// by the Friday close cron. If no snapshot exists for a week, nothing is seeded
// for that week — the updatedDate fallback was removed because it captures
// Tekmetric billing automation (POSTED→ACCRECV transitions etc.), not real
// post-close edits, and produced 100% false-positive entries.
//
// POST /api/drift-log
// Force-refresh: re-seeds from snapshot caches (no live Tekmetric scan).

import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/serverAuth';
import { getDriftLog, seedDriftFromReport } from '@/lib/driftLog';
import { readCache } from '@/lib/cache';
import type { DriftReport } from '@/lib/weeklySnapshot';
import { addDays, startOfWeek } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { CHAIN_TZ } from '@/lib/dates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function recentWeekStarts(n: number): string[] {
  const now = toZonedTime(new Date(), CHAIN_TZ);
  const thisMonday = startOfWeek(now, { weekStartsOn: 1 });
  const weeks: string[] = [];
  for (let i = 1; i <= n; i++) {
    weeks.push(addDays(thisMonday, -7 * i).toISOString().slice(0, 10));
  }
  return weeks;
}

// Seed from snapshot cache (fast, no Tekmetric calls).
// Only processes snapshot-based reports — skips any stale updatedDate-scan
// reports that may still be in the cache.
async function seedFromSnapshots(weeks: string[]): Promise<void> {
  for (const weekStart of weeks) {
    const report = await readCache<DriftReport>(`weekly_drift_v3_${weekStart}`);
    if (report?.snapshotBased && report.diffs?.length) {
      await seedDriftFromReport(weekStart, report, true);
    }
  }
}

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }

  const last16 = recentWeekStarts(16);
  let entries = await getDriftLog();

  if (entries.length === 0) {
    await seedFromSnapshots(last16);
    entries = await getDriftLog();
  } else {
    seedFromSnapshots(last16).catch(() => {});
  }

  const sorted = [...entries].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
  );

  return NextResponse.json({ entries: sorted });
}

// Force-refresh: triggered by the Refresh button in the UI.
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }

  await seedFromSnapshots(recentWeekStarts(16));

  const entries = await getDriftLog();
  const sorted = [...entries].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
  );

  return NextResponse.json({ entries: sorted, newEntries: 0 });
}
