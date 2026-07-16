// Admin endpoint: backfill Call Conversion % for a specific past week.
// Protected by executive session (same as heatmap). Calls WhatConverts +
// Claude to re-classify the week's leads and writes the metric snapshot.
// Use this to fix weeks whose snapshot was frozen with 0% due to the
// Sunday-night Central/Mountain timezone mismatch in snapshotWeeklyMetrics.

import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/serverAuth';
import { backfillWeekMetricsForShop } from '@/lib/syncJobs';
import { SHOPS } from '@/lib/shops';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }

  const url = req.nextUrl;
  const week = url.searchParams.get('week');
  const shopParam = url.searchParams.get('shop') || 'all';

  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return NextResponse.json({ error: 'week param required (YYYY-MM-DD, a Monday)' }, { status: 400 });
  }

  const shops = shopParam === 'all' ? SHOPS.map(s => s.num) : [shopParam];
  const startedAt = new Date().toISOString();
  const out: Array<{ shop: string; status: 'ok' | 'error'; durationMs: number; message?: string; error?: string }> = [];

  for (const num of shops) {
    const t0 = Date.now();
    try {
      const msg = await backfillWeekMetricsForShop(week, num);
      out.push({ shop: num, status: 'ok', durationMs: Date.now() - t0, message: msg });
    } catch (e: any) {
      out.push({ shop: num, status: 'error', durationMs: Date.now() - t0, error: e?.message || String(e) });
    }
  }

  return NextResponse.json({
    startedAt,
    finishedAt: new Date().toISOString(),
    week,
    results: out,
  });
}
