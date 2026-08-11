// GET /api/drift-log
// Returns the full persistent drift review log (all weeks, all entries).
// Seeds from two paths:
//  1. Snapshot-based: weekly_drift_v3_<weekStart> written by check-weekly-drift cron
//  2. On-demand fallback: checkDriftByUpdatedDate scans Tekmetric directly when
//     no snapshot cache exists — covers cases where the snapshot cron hasn't yet
//     run for a given week. Results include both real post-close edits and some
//     billing automation noise; managers review and approve/reject each entry.
//
// POST /api/drift-log
// Force-refresh: re-seeds from snapshots + live scan for last 4 weeks.

import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/serverAuth';
import { getDriftLog, seedDriftFromReport, clearPendingEntriesForWeeks } from '@/lib/driftLog';
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

// Fallback scan for weeks with no snapshot: uses Tekmetric's updatedDate field.
// Catches real post-close edits but also some billing automation noise (individual
// POSTED→ACCRECV transitions that don't batch). Managers review and reject noise.
async function seedFromLiveScan(weeks: string[]): Promise<number> {
  let added = 0;
  for (const weekStart of weeks) {
    const cached = await readCache<DriftReport>(`weekly_drift_v3_${weekStart}`);
    if (cached?.snapshotBased) continue; // real snapshot exists — no need to scan
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

  // Only show tickets from last week — don't go further back for now.
  const lastWeek = recentWeekStarts(1);
  const weekFilter = lastWeek[0];

  let entries = await getDriftLog();

  // Seed last week in the background (or await if log is empty).
  if (entries.filter(e => e.weekStart === weekFilter).length === 0) {
    await seedFromSnapshots(lastWeek);
    await seedFromLiveScan(lastWeek);
    entries = await getDriftLog();
  } else {
    // Run snapshot seeder first so it can upgrade any existing non-snapshot
    // entries before the live scan runs (avoids a race where updatedDate scan
    // seeds an entry as snapshotBased:false and then the snapshot data is ignored).
    seedFromSnapshots(lastWeek)
      .then(() => seedFromLiveScan(lastWeek))
      .catch(() => {});
  }

  const filtered = entries.filter(e => e.weekStart === weekFilter);
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
  );

  return NextResponse.json({ entries: sorted });
}

// Force-refresh: clears pending entries for last week and re-scans Tekmetric.
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }

  const lastWeek = recentWeekStarts(1);
  const weekFilter = lastWeek[0];

  // Clear pending entries so the re-scan starts clean (preserves approved/rejected).
  await clearPendingEntriesForWeeks(lastWeek);

  await seedFromSnapshots(lastWeek);
  const added = await seedFromLiveScan(lastWeek);

  const entries = await getDriftLog();
  const filtered = entries.filter(e => e.weekStart === weekFilter);
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
  );

  return NextResponse.json({ entries: sorted, newEntries: added });
}
