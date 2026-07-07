import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/serverAuth';
import { fetchROsByCreatedDate } from '@/lib/tekmetric';
import { SHOPS } from '@/lib/shops';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getRole(req);
  if (role !== 'executive') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const shop = SHOPS[0]; // Cottonwood
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const ros = await fetchROsByCreatedDate(
    shop.tekmetricId,
    weekAgo + 'T00:00:00Z',
    today + 'T23:59:59Z',
  );

  const sample = ros.slice(0, 3).map((ro: any) => ({
    id: ro.id,
    status: ro.repairOrderStatus?.code,
    jobsCount: ro.jobs?.length ?? 'no jobs field',
    firstJob: ro.jobs?.[0] ? {
      id: ro.jobs[0].id,
      name: ro.jobs[0].name,
      cannedJobId: ro.jobs[0].cannedJobId,
      partsCount: ro.jobs[0].parts?.length ?? 'no parts field',
      firstPart: ro.jobs[0].parts?.[0] ?? null,
    } : null,
  }));

  const totalROs = ros.length;
  const rosWithJobs = ros.filter((ro: any) => (ro.jobs?.length ?? 0) > 0).length;
  const rosWithParts = ros.filter((ro: any) =>
    (ro.jobs ?? []).some((j: any) => (j.parts?.length ?? 0) > 0)
  ).length;
  const totalParts = ros.reduce((s: number, ro: any) =>
    s + (ro.jobs ?? []).reduce((s2: number, j: any) => s2 + (j.parts?.length ?? 0), 0), 0
  );

  return NextResponse.json({
    shop: shop.name,
    range: `${weekAgo} to ${today}`,
    totalROs,
    rosWithJobs,
    rosWithParts,
    totalParts,
    sample,
  });
}
