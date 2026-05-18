import { NextRequest, NextResponse } from 'next/server';
import { rosForChain } from '@/lib/dataAccess';
import { dailySeries } from '@/lib/metrics';
import { ComparisonMode, customRange, resolveComparisonRange, resolveRange, RangeKey } from '@/lib/dates';
import { getRole } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const noWeekends = req.nextUrl.searchParams.get('no_weekends') === '1';
  const range = (req.nextUrl.searchParams.get('range') as RangeKey) || 'this_year';
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');
  const compMode = (req.nextUrl.searchParams.get('compare') as ComparisonMode) || 'same_period_last_year';
  const compStart = req.nextUrl.searchParams.get('compStart');
  const compEnd = req.nextUrl.searchParams.get('compEnd');

  const currWindow = range === 'custom' && start && end ? customRange(start, end) : resolveRange(range);
  const prevWindow = resolveComparisonRange(currWindow, compMode, compStart || undefined, compEnd || undefined);

  try {
    const [curr, prev] = await Promise.all([
      rosForChain({ startISO: currWindow.startISO, endISO: currWindow.endISO }),
      rosForChain({ startISO: prevWindow.startISO, endISO: prevWindow.endISO }),
    ]);
    const isWeekendStr = (ymd: string) => {
      const [y, m, d] = ymd.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return dow === 0 || dow === 6;
    };
    // Totals always reflect ALL days; no_weekends only filters the chart series so the
    // line doesn't have visual gaps on weekends.
    const curFull = dailySeries(curr);
    const preFull = dailySeries(prev);
    const curSeries = noWeekends ? curFull.filter(p => !isWeekendStr(p.date)) : curFull;
    const preSeries = noWeekends ? preFull.filter(p => !isWeekendStr(p.date)) : preFull;
    const curTotal = curFull.reduce((s, d) => s + d.revenue, 0);
    const preTotal = preFull.reduce((s, d) => s + d.revenue, 0);
    return NextResponse.json({
      current: { series: curSeries, total: curTotal, label: currWindow.label },
      comparison: { series: preSeries, total: preTotal, label: prevWindow.label },
      change: preTotal ? (curTotal - preTotal) / preTotal : 0,
    });
  } catch (e: any) {
    console.error('[period-comparison] failed:', e);
    return NextResponse.json({ error: e?.message || 'period comparison failed' }, { status: 500 });
  }
}
