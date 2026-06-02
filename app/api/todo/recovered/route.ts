// "Customers recovered this week" — per-shop counts from the durable ledger
// (lib/recoveredLedger). Read-only; the page already gates access. Returns the
// current week's tally so the To Do header shows an accurate cumulative number
// that survives the rolling-feed churn + 12h auto-reopen sweep.

import { NextResponse } from 'next/server';
import { recoveredSetsThisWeek } from '@/lib/recoveredLedger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Return the per-shop SETS of recovered entry-ids (not just counts) so the
    // client can union them with the rows it currently shows as recovered and
    // dedupe — crediting visibly-checkmarked customers even if they predate
    // this ledger.
    const { weekStart, byShop } = await recoveredSetsThisWeek();
    return NextResponse.json({ weekStart, byShop });
  } catch (e: any) {
    return NextResponse.json({ weekStart: null, byShop: {}, error: e?.message || 'failed' }, { status: 200 });
  }
}
