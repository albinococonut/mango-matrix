// Executive-only metrics dispatcher. Hosts /forecast and /opportunity behind
// ?view= to stay under Vercel Hobby's 12-function cap. Role check runs once
// here so the underlying handlers don't repeat it.

import { NextRequest, NextResponse } from 'next/server';
import { handle as handleForecast } from '@/lib/handlers/forecast';
import { handle as handleOpportunity } from '@/lib/handlers/opportunity';
import { handle as handleProjection } from '@/lib/handlers/projection';
import { handle as handleAR } from '@/lib/handlers/ar';
import { handle as handleGoalBenchmarks } from '@/lib/handlers/goalBenchmarks';
import { getRole } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // AR bootstrap pulls 24mo when ar_current_v2_* is cold

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const view = req.nextUrl.searchParams.get('view');
  if (view === 'forecast') return handleForecast(req);
  if (view === 'opportunity') return handleOpportunity(req);
  if (view === 'projection') return handleProjection(req);
  if (view === 'ar') return handleAR(req);
  if (view === 'goal-benchmarks') return handleGoalBenchmarks();
  return NextResponse.json({ error: 'specify view=forecast|opportunity|projection|ar|goal-benchmarks' }, { status: 400 });
}
