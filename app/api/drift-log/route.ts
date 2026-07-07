// GET /api/drift-log
// Returns the full persistent drift review log (all weeks, all entries).
// Seeds from two paths:
//  1. Snapshot-based: weekly_drift_v3_<weekStart> written by check-weekly-drift cron
//  2. On-demand fallback: checkDriftByUpdatedDate scans Tekmetric directly when
//     no snapshot cache exists — covers cases where the cron never ran.
//
// POST /api/drift-log  { force: true }
// Force-refresh: re-scans Tekmetric for the last 4 weeks and seeds new entries.

import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/serverAuth';
import { getDriftLog, seedDriftFromReport } from '@/lib/driftLog';
import { readCache } from '@/lib/cache';
import type { DriftReport } from '@/lib/weeklySnapshot';
import { checkDriftByUpdatedDate } from '@/lib/weeklySnapshot';
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
async function seedFromSnapshots(weeks: string[]): Promise<void> {
  for (const weekStart of weeks) {
    const report = await readCache<DriftReport>(`weekly_drift_v3_${weekStart}`);
    if (report?.diffs?.length) {
      await seedDriftFromReport(weekStart, report, report.snapshotBased ?? false);
    }
  }
}

// Seed from live Tekmetric scan for weeks with no snapshot — slow but accurate.
async function seedFromLiveScan(weeks: string[]): Promise<number> {
  let added = 0;
  for (const weekStart of weeks) {
    const cached = await readCache<DriftReport>(`weekly_drift_v3_${weekStart}`);
    if (cached) continue; // already have a snapshot for this week
    try {
      const report = await checkDriftByUpdatedDate(weekStart);
      if (report?.diffs?.length) {
        added += await seedDriftFromReport(weekStart, report, false);
      }
    } catch {
      // skip week on Tekmetric error
    }
  }
  return added;
}

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }

  const last16 = recentWeekStarts(16);
  const last4  = recentWeekStarts(4);

  let entries = await getDriftLog();

  if (entries.length === 0) {
    // Cold start: seed synchronously from snapshots, then live-scan last 4 weeks.
    await seedFromSnapshots(last16);
    await seedFromLiveScan(last4);
    entries = await getDriftLog();
  } else {
    // Warm path: snapshot seed in bg; live-scan last 4 weeks in bg to pick up
    // edits that happened since the snapshot cron last ran.
    Promise.all([
      seedFromSnapshots(last16),
      seedFromLiveScan(last4),
    ]).catch(() => {});
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

  const last4 = recentWeekStarts(4);
  await seedFromSnapshots(recentWeekStarts(16));
  const added = await seedFromLiveScan(last4);

  const entries = await getDriftLog();
  const sorted = [...entries].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
  );

  return NextResponse.json({ entries: sorted, newEntries: added });
}
