import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/serverAuth';
import { getPartsMatrixReview, updatePartsMatrixReviewEntry } from '@/lib/partsMatrixReview';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (session?.role !== 'executive') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const map = await getPartsMatrixReview();
  // Return as a plain object keyed by id for O(1) client lookup
  return NextResponse.json({ entries: Object.fromEntries(map) });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (session?.role !== 'executive') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json() as {
    id: string;
    partData?: Parameters<typeof updatePartsMatrixReviewEntry>[1]['partData'];
    status?: 'pending' | 'approved' | 'rejected';
    notes?: string;
  };

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const entry = await updatePartsMatrixReviewEntry(body.id, {
    partData: body.partData,
    status: body.status,
    notes: body.notes,
    reviewedBy: session.email,
  });

  return NextResponse.json({ ok: true, entry });
}
