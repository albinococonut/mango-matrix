// GET /api/drift-log
// Returns the full persistent drift review log (all weeks, all entries).
// Also seeds new entries in the background from recent weekly drift caches so
// the log stays current without requiring a separate cron job.

import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/serverAuth';
import { getDriftLog, seedDriftFromReport } from '@/lib/driftLog';
import { readCache } from '@/lib/cache';
import type { DriftReport } from '@/lib/weeklySnapshot';
import { addDays, startOfWeek } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { CHAIN_TZ } from '@/lib/dates';

export const dynamic = 'force-dynamic';

async function seedRecentWeeks(): Promise<void> {
  const now = toZonedTime(new Date(), CHAIN_TZ);
  const thisMonday = startOfWeek(now, { weekStartsOn: 1 });
  // Check the last 16 weeks for any drift reports not yet in the log
  for (let i = 1; i <= 16; i++) {
    const mon = addDays(thisMonday, -7 * i);
    const weekStart = mon.toISOString().slice(0, 10);
    const report = await readCache<DriftReport>(`weekly_drift_v3_${weekStart}`);
    if (report?.diffs?.length) {
      await seedDriftFromReport(weekStart, report, report.snapshotBased ?? false);
    }
  }
}

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }

  let entries = await getDriftLog();

  // First-time bootstrap: if the log is empty, seed synchronously so the very
  // first page load returns real data instead of an empty state.
  if (entries.length === 0) {
    await seedRecentWeeks();
    entries = await getDriftLog();
  } else {
    // Log already populated — seed any new weeks in the background.
    seedRecentWeeks().catch(() => {});
  }

  // Newest detected-at first
  const sorted = [...entries].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
  );

  return NextResponse.json({ entries: sorted });
}
