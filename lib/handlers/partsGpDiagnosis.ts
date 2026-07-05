// Parts GP% diagnosis: breaks down which job names are dragging parts GP%
// below the 55% matrix target. Tells us whether the cause is canned jobs
// (same job name appearing many times at below-matrix pricing) or manual
// price overrides (scattered across many different job names).
//
// GET /api/extras?view=parts-gp-diagnosis&weekStart=YYYY-MM-DD

import { NextRequest, NextResponse } from 'next/server';
import { rosForChain } from '@/lib/dataAccess';
import { customRange } from '@/lib/dates';
import { isCountedRO } from '@/lib/metrics';
import { c2d } from '@/lib/tekmetric';

const PARTS_GP_TARGET = 0.55;

interface JobRow {
  jobName: string;
  roCount: number;           // how many ROs had this job
  partsSold: number;         // total retail (dollars) billed to customers
  partsCost: number;         // total cost (dollars) to the shop
  actualGpPct: number;       // (sold - cost) / sold
  targetGpDollars: number;   // partsSold * 0.55
  actualGpDollars: number;   // partsSold - partsCost
  dragDollars: number;       // how many GP$ below the 55% target
}

function weekStartToFriday(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const fri = new Date(y, m - 1, d);
  fri.setDate(fri.getDate() + 4); // Monday + 4 = Friday
  return `${fri.getFullYear()}-${String(fri.getMonth() + 1).padStart(2, '0')}-${String(fri.getDate()).padStart(2, '0')}`;
}

export async function handle(req: NextRequest): Promise<NextResponse> {
  const weekStart = req.nextUrl.searchParams.get('weekStart');
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: 'weekStart param required (YYYY-MM-DD Monday)' }, { status: 400 });
  }

  const weekEnd = (() => {
    const [y, m, d] = weekStart.split('-').map(Number);
    const e = new Date(y, m - 1, d);
    e.setDate(e.getDate() + 6);
    return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
  })();

  const w = customRange(weekStart, weekEnd);
  const orders = await rosForChain(w);

  // Per-job-name bucket
  const byJob = new Map<string, { roIds: Set<number>; soldCents: number; costCents: number }>();

  for (const ro of orders) {
    if (!isCountedRO(ro)) continue;
    for (const job of ro.jobs) {
      if (!job.authorized) continue;
      if (!job.parts || job.parts.length === 0) continue;
      const name = (job.name || '(unnamed)').trim();
      const bucket = byJob.get(name) ?? { roIds: new Set(), soldCents: 0, costCents: 0 };
      bucket.roIds.add(ro.id);
      for (const p of job.parts) {
        bucket.soldCents += (p.retail ?? 0) * p.quantity;
        bucket.costCents += (p.cost ?? 0) * p.quantity;
      }
      byJob.set(name, bucket);
    }
  }

  const rows: JobRow[] = [];
  for (const [jobName, b] of byJob) {
    const partsSold = c2d(b.soldCents);
    const partsCost = c2d(b.costCents);
    if (partsSold <= 0) continue;
    const actualGpDollars = partsSold - partsCost;
    const targetGpDollars = partsSold * PARTS_GP_TARGET;
    const dragDollars = targetGpDollars - actualGpDollars;
    rows.push({
      jobName,
      roCount: b.roIds.size,
      partsSold,
      partsCost,
      actualGpPct: actualGpDollars / partsSold,
      targetGpDollars,
      actualGpDollars,
      dragDollars,
    });
  }

  // Sort by drag descending (most GP$ lost first)
  rows.sort((a, b) => b.dragDollars - a.dragDollars);

  // Chain summary
  const totalSold = rows.reduce((s, r) => s + r.partsSold, 0);
  const totalCost = rows.reduce((s, r) => s + r.partsCost, 0);
  const totalActualGp = totalSold - totalCost;
  const totalTargetGp = totalSold * PARTS_GP_TARGET;
  const totalDrag = totalTargetGp - totalActualGp;

  // Top jobs driving the drag (only those below target)
  const belowTarget = rows.filter(r => r.dragDollars > 0);
  const top20 = belowTarget.slice(0, 20);
  // Concentration: what % of drag is in top-5 job names?
  const top5Drag = belowTarget.slice(0, 5).reduce((s, r) => s + r.dragDollars, 0);
  const concentrationPct = totalDrag > 0 ? top5Drag / totalDrag : 0;

  return NextResponse.json({
    weekStart,
    weekEnd,
    summary: {
      totalPartsSold: Math.round(totalSold),
      totalPartsCost: Math.round(totalCost),
      actualGpPct: totalSold > 0 ? Math.round((totalActualGp / totalSold) * 1000) / 10 : 0,
      targetGpPct: PARTS_GP_TARGET * 100,
      totalDragDollars: Math.round(totalDrag),
      uniqueJobNames: rows.length,
      top5ConcentrationPct: Math.round(concentrationPct * 1000) / 10,
      // High concentration = canned jobs; low = manual overrides scattered across many jobs
      likelyCause: concentrationPct >= 0.6 ? 'canned-jobs' : concentrationPct >= 0.35 ? 'mixed' : 'manual-overrides',
    },
    topOffenders: top20.map(r => ({
      jobName: r.jobName,
      roCount: r.roCount,
      partsSoldDollars: Math.round(r.partsSold),
      actualGpPct: Math.round(r.actualGpPct * 1000) / 10,
      dragDollars: Math.round(r.dragDollars),
    })),
  });
}
