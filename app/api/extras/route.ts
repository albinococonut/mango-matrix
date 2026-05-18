// Combined endpoint. Vercel Hobby caps a deployment at 12 functions, so we
// dispatch three small handlers (comebacks, google-ratings, booked-rate) through
// one route. Use ?view=comebacks | google-ratings | booked-rate.

import { NextRequest, NextResponse } from 'next/server';
import { handle as handleComebacks } from '@/lib/handlers/comebacks';
import { handle as handleGoogleRatings } from '@/lib/handlers/googleRatings';
import { handle as handleBookedRate } from '@/lib/handlers/bookedRate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get('view');
  if (view === 'comebacks') return handleComebacks(req);
  if (view === 'google-ratings') return handleGoogleRatings();
  if (view === 'booked-rate') return handleBookedRate(req);
  return NextResponse.json({ error: 'specify view=comebacks|google-ratings|booked-rate' }, { status: 400 });
}
