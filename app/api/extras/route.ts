// Combined endpoint. Vercel Hobby caps a deployment at 12 functions, so we
// dispatch all small handlers through one route. Use ?view=<name>.

import { NextRequest, NextResponse } from 'next/server';
import { handle as handleComebacks } from '@/lib/handlers/comebacks';
import { handle as handleGoogleRatings } from '@/lib/handlers/googleRatings';
import { handle as handleBookedRate } from '@/lib/handlers/bookedRate';
import { handle as handleGoldenMango } from '@/lib/handlers/goldenMango';
import { handle as handleReturnCustomers } from '@/lib/handlers/returnCustomers';
import { handle as handleMissedCallbacks } from '@/lib/handlers/missedCallbacks';
import { handle as handleMissedRebooks } from '@/lib/handlers/missedRebooks';
import { handle as handleZapierReviews } from '@/lib/handlers/zapierReviews';
import { handle as handleDeclinedJobs } from '@/lib/handlers/declinedJobs';
import { handle as handleTodoRecoveries } from '@/lib/handlers/todoRecoveries';
import { handle as handlePartsGpDiagnosis } from '@/lib/handlers/partsGpDiagnosis';
import { handle as handleSalesEffectiveness } from '@/lib/handlers/salesEffectivenessHandler';
import { handle as handleCallRecordings } from '@/lib/handlers/callRecordings';
import { debugPhoneMap, bustPhoneMapCache } from '@/lib/ringcentral';
import { verifyRoleCookie, COOKIE_NAME } from '@/lib/auth';
import { cookies } from 'next/headers';
import { cacheUpdatedAt } from '@/lib/cache';
import { readSettledWeeks } from '@/lib/reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get('view');
  if (view === 'comebacks') return handleComebacks(req);
  if (view === 'booked-rate') return handleBookedRate(req);
  if (view === 'golden-mango') return handleGoldenMango();
  if (view === 'return-customers') return handleReturnCustomers();
  if (view === 'missed-callbacks') return handleMissedCallbacks();
  if (view === 'missed-rebooks') return handleMissedRebooks();
  if (view === 'zapier-reviews') return handleZapierReviews();
  if (view === 'declined-jobs') return handleDeclinedJobs();
  if (view === 'todo-recoveries') return handleTodoRecoveries(req);
  if (view === 'google-ratings') return handleGoogleRatings();
  if (view === 'parts-gp-diagnosis') return handlePartsGpDiagnosis(req);
  if (view === 'sales-effectiveness') return handleSalesEffectiveness(req);
  if (view === 'call-recordings') return handleCallRecordings(req);
  if (view === 'rc-phone-debug') {
    const role = await verifyRoleCookie(cookies().get(COOKIE_NAME)?.value);
    if (role !== 'executive') return NextResponse.json({ error: 'executive only' }, { status: 403 });
    if (req.nextUrl.searchParams.get('bust') === '1') {
      await bustPhoneMapCache();
    }
    const result = await debugPhoneMap();
    return NextResponse.json(result);
  }
  if (view === 'data-status') {
    // Prefer the explicit heartbeats; fall back to always-warm keys so the
    // footer is correct immediately after a deploy (before the first cron
    // tick writes the heartbeats). fbr_warm_idx is rewritten every cron tick
    // alongside the Tekmetric warm; booked_rate_wtd_strict is the WhatConverts
    // snapshot.
    const [hbTek, hbWc, tekFallback, wcFallback, settledWeeks] = await Promise.all([
      cacheUpdatedAt('hb_tekmetric'),
      cacheUpdatedAt('hb_ringcentral'),
      cacheUpdatedAt('fbr_warm_idx'),
      cacheUpdatedAt('booked_rate_wtd_strict'),
      readSettledWeeks(),
    ]);
    const lastSettled = settledWeeks.length ? settledWeeks[settledWeeks.length - 1] : null;
    return NextResponse.json({
      tekmetric: hbTek ?? tekFallback,
      ringcentral: hbWc ?? wcFallback,
      revenueSettledThrough: lastSettled?.weekEnd ?? null,
      revenueSettledAt: lastSettled?.computedAt ?? null,
    });
  }
  return NextResponse.json({ error: 'specify view=comebacks|google-ratings|booked-rate|golden-mango|return-customers|missed-callbacks|missed-rebooks|zapier-reviews|declined-jobs|todo-recoveries|data-status' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const view = req.nextUrl.searchParams.get('view');
  if (view === 'sales-effectiveness') return handleSalesEffectiveness(req);
  if (view === 'call-recordings') return handleCallRecordings(req);
  return NextResponse.json({ error: 'specify view' }, { status: 400 });
}
