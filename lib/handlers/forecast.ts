import { NextRequest, NextResponse } from 'next/server';
import { customRange, resolveRange, RangeKey } from '@/lib/dates';
import { rosForChain, rosForShopNum } from '@/lib/dataAccess';
import { forecast, revenueProjection } from '@/lib/metrics';
import { ShopNum, SHOP_BY_NUM } from '@/lib/shops';
import { getRole } from '@/lib/serverAuth';

// Executive-only handler. The route wrapper does the role check before calling.
export async function handle(req: NextRequest) {
  const range = (req.nextUrl.searchParams.get('range') as RangeKey) || 'this_month';
  const shop = req.nextUrl.searchParams.get('shop') as ShopNum | 'all' | null;
  const noWeekends = req.nextUrl.searchParams.get('no_weekends') === '1';
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');
  const w = range === 'custom' && start && end ? customRange(start, end) : resolveRange(range);
  try {
    const ros =
      shop && shop !== 'all' && SHOP_BY_NUM[shop]
        ? await rosForShopNum(shop, w)
        : await rosForChain(w, { excludeSecondary: true });

    // Approximate approved pipeline from authorized, non-posted jobs.
    let approvedPipelineCents = 0;
    let openROCount = 0;
    for (const o of ros) {
      // "Open" = not POSTED status. Pipeline value = sum of subtotal across authorized jobs.
      if (o.repairOrderStatus.code !== 'POSTED' && o.repairOrderStatus.code !== 'INVOICED') {
        openROCount++;
        for (const j of o.jobs) if (j.authorized) approvedPipelineCents += j.subtotal;
      }
    }
    // Tech roster sized from observed labor in window.
    const techIds = new Set<number>();
    let laborMinutesTotal = 0;
    for (const o of ros) for (const j of o.jobs) {
      laborMinutesTotal += (j.laborHours || 0) * 60;
      for (const l of j.labor || []) if (l.technicianId) techIds.add(l.technicianId);
    }
    const techCount = techIds.size || 33;
    // Hours/day per tech inferred: total billed hours / window days / techCount * techCount = total/days
    const days = Math.max(1, ros.length ? 27 : 27);
    const techHoursPerDay = Math.max(1, Math.round((laborMinutesTotal / 60) / Math.max(days, 1)));
    const laborRatePerHour = 89;

    const proj = revenueProjection({
      orders: ros,
      asOf: new Date(),
      techHoursPerDay,
      laborRatePerHour,
      techCount,
      approvedPipelineCents,
      openROCount,
    });

    const fc = forecast(ros, w.start, w.end, noWeekends);

    return NextResponse.json({ range, shop: shop || 'all', forecast: fc, projection: proj, openROCount, techCount, techHoursPerDay });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'forecast failed' }, { status: 500 });
  }
}
