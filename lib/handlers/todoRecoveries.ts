// Read-only handler for the "To-Do List Items Checked Off" trophy / widget.
// Counts per-shop recoveries in either a this-week (Mon→now MT) or a
// rolling-7-day window, reading the timestamped log written by
// lib/recoveredLedger.ts whenever a manager marks a callback / rebook /
// declined-job as "recovered."

import { NextRequest, NextResponse } from 'next/server';
import { recoveredCountsByWindow } from '@/lib/recoveredLedger';
import { SHOPS } from '@/lib/shops';

export async function handle(req: NextRequest) {
  const windowParam = (req.nextUrl.searchParams.get('window') || 'this_week') as 'this_week' | 'rolling_7d';
  const safeWindow: 'this_week' | 'rolling_7d' = windowParam === 'rolling_7d' ? 'rolling_7d' : 'this_week';
  try {
    const { windowStartISO, windowEndISO, byShop } = await recoveredCountsByWindow(safeWindow);
    const shops = SHOPS.map((s) => ({
      shopNum: s.num,
      shopName: s.name,
      count: byShop[s.num] ?? 0,
    }));
    const chainCount = shops.reduce((sum, s) => sum + s.count, 0);
    return NextResponse.json({
      window: safeWindow,
      windowStartISO,
      windowEndISO,
      computedAt: new Date().toISOString(),
      chain: { count: chainCount },
      shops,
    });
  } catch (e: any) {
    console.error('[todo-recoveries] failed:', e);
    return NextResponse.json({ error: e?.message || 'todo-recoveries failed' }, { status: 500 });
  }
}
