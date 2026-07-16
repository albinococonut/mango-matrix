import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/serverAuth';
import {
  readAllPartsHistory,
  getMissingWeeks,
  computeAndSaveWeek,
} from '@/lib/partsMatrixHistory';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const role = await getRole(req);
  if (role !== 'executive') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const [buckets, missing] = await Promise.all([readAllPartsHistory(), getMissingWeeks()]);
  return NextResponse.json({ buckets, missingCount: missing.length });
}

export async function POST(req: NextRequest) {
  const role = await getRole(req);
  if (role !== 'executive') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { batchSize?: number };
  const batchSize = Math.min(body.batchSize ?? 2, 5);

  const missing = await getMissingWeeks(); // newest-first
  if (missing.length === 0) return NextResponse.json({ computed: [], remaining: 0, done: true });

  const toProcess = missing.slice(0, batchSize);
  const computed: string[] = [];
  for (const w of toProcess) {
    await computeAndSaveWeek(w);
    computed.push(w);
  }

  const remaining = missing.length - computed.length;
  return NextResponse.json({ computed, remaining, done: remaining === 0 });
}
