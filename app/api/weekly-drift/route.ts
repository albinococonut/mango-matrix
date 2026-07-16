// GET /api/weekly-drift?weekStart=YYYY-MM-DD
// Returns post-close ticket changes for the given week.
//
// Primary path: returns a cached drift report written by the weekly-audit
// cron (take-weekly-snapshot Friday 7 PM MT → check-weekly-drift daily noon).
//
// Fallback (no cron / no snapshot): computes on-demand by scanning ROs whose
// updatedDate falls after the week ended. Cached 4 hours so subsequent loads
// are instant. This path provides RO numbers + edit timestamps but not the
// before/after revenue delta (no snapshot to compare against).

import { NextRequest, NextResponse } from 'next/server';
import { getLatestDrift, checkDriftByUpdatedDate } from '@/lib/weeklySnapshot';
import { getRole } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const weekStart = req.nextUrl.searchParams.get('weekStart');
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: 'weekStart param required (YYYY-MM-DD)' }, { status: 400 });
  }

  // Check for an existing cached report (written by the cron or a prior on-demand scan)
  const cached = await getLatestDrift(weekStart);
  if (cached) {
    return NextResponse.json({ weekStart, snapshotAvailable: true, report: cached });
  }

  // No cached report — scan updatedDate on-demand
  try {
    const report = await checkDriftByUpdatedDate(weekStart);
    return NextResponse.json({ weekStart, snapshotAvailable: true, report });
  } catch (e: any) {
    return NextResponse.json({ weekStart, snapshotAvailable: false, error: e?.message }, { status: 500 });
  }
}
