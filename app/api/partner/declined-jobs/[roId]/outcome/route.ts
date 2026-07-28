// POST /api/partner/declined-jobs/:roId/outcome
//
// Write back a call outcome for a declined-job RO. Multiple POSTs append —
// the full call history is preserved, newest last.
//
// Auth: Bearer token matching PARTNER_API_SECRET env var.
//
// Request body (all fields optional, but at least one required):
//   { calledAt?, calledBy?, note?, recordingUrl? }
//
//   calledAt    — ISO timestamp of when the call happened (defaults to now)
//   calledBy    — agent name / ID from the calling system
//   note        — free-text summary of the call
//   recordingUrl — URL to the recording or transcript in your calling system
//
// Response:
//   { ok: true, roId, outcomeCount }

import { NextRequest, NextResponse } from 'next/server';
import { appendCallOutcome } from '@/lib/partnerCallStore';

function isAuthed(req: NextRequest): boolean {
  const secret = process.env.PARTNER_API_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { roId: string } },
) {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const roId = parseInt(params.roId, 10);
  if (!Number.isFinite(roId) || roId <= 0) {
    return NextResponse.json({ error: 'Invalid roId' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { calledAt, calledBy, note, recordingUrl } = body as {
    calledAt?: string;
    calledBy?: string;
    note?: string;
    recordingUrl?: string;
  };

  if (!calledBy && !note && !recordingUrl) {
    return NextResponse.json(
      { error: 'Provide at least one of: calledBy, note, recordingUrl' },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const outcomes = await appendCallOutcome(roId, {
    calledAt: calledAt ?? now,
    calledBy: calledBy || undefined,
    note: note || undefined,
    recordingUrl: recordingUrl || undefined,
    loggedAt: now,
  });

  return NextResponse.json({ ok: true, roId, outcomeCount: outcomes.length });
}
