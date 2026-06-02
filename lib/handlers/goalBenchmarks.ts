// Goal-meeting benchmarks handler (executive-only; the exec-metrics route does
// the role check). Mines the permanent weekly archive for each shop's
// goal-hitting KPI levels. The archive only changes once a week, so the result
// is cached for a day; on a compute error we serve the last good payload.

import { NextResponse } from 'next/server';
import { readCache, writeCache, isFresh } from '@/lib/cache';
import { goalMeetingBenchmarks } from '@/lib/goalBenchmarks';

const KEY = 'goal_benchmarks_v1';
const FRESH_MS = 24 * 60 * 60 * 1000;

export async function handle() {
  const cached = await readCache(KEY);
  if (cached && (await isFresh(KEY, FRESH_MS))) return NextResponse.json(cached);
  try {
    const data = await goalMeetingBenchmarks();
    await writeCache(KEY, data); // durable; recomputed at most once a day
    return NextResponse.json(data);
  } catch (e: any) {
    if (cached) return NextResponse.json(cached); // serve stale rather than fail
    console.error('[goal-benchmarks] failed:', e);
    return NextResponse.json({ error: e?.message || 'goal-benchmarks failed' }, { status: 500 });
  }
}
