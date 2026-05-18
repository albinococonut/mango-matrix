// Executive-only metrics dispatcher. Hosts /forecast and /opportunity behind
// ?view= to stay under Vercel Hobby's 12-function cap. Role check runs once
// here so the underlying handlers don't repeat it.

import { NextRequest, NextResponse } from 'next/server';
import { handle as handleForecast } from '@/lib/handlers/forecast';
import { handle as handleOpportunity } from '@/lib/handlers/opportunity';
import { getRole } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const view = req.nextUrl.searchParams.get('view');
  if (view === 'forecast') return handleForecast(req);
  if (view === 'opportunity') return handleOpportunity(req);
  return NextResponse.json({ error: 'specify view=forecast|opportunity' }, { status: 400 });
}
