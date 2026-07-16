// PATCH /api/drift-log/review
// Update the review status and/or notes for a single drift log entry.
// Body: { id: string; status?: 'pending'|'approved'|'rejected'; notes?: string }

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/serverAuth';
import { updateDriftEntry } from '@/lib/driftLog';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (session?.role !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  const reviewerEmail = session.email;

  let body: { id?: string; status?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { id, status, notes } = body;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  if (status !== undefined && !['pending', 'approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'status must be pending|approved|rejected' }, { status: 400 });
  }

  const entry = await updateDriftEntry(id, {
    ...(status !== undefined ? { status: status as 'pending' | 'approved' | 'rejected' } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(status !== undefined && reviewerEmail ? { reviewedBy: reviewerEmail } : {}),
  });

  if (!entry) {
    return NextResponse.json({ error: 'entry not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, entry });
}
