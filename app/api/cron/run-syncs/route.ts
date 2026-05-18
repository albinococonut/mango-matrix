// Single protected endpoint that runs every enabled sync job.
// Triggered every 15 minutes by GitHub Actions (.github/workflows/run-syncs.yml).
//
// Authorization: Bearer ${CRON_SECRET}. Refuses anything else.
//
// We use the Node runtime here (not Edge) because the sync jobs reach into the
// file-cache, the Anthropic SDK, and (when configured) the Postgres pool for
// GBP reviews — none of which run on Edge.

import { NextRequest, NextResponse } from 'next/server';
import { runAllSyncs } from '@/lib/syncJobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // longest job (booked-rate strict) can run ~3 min

function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured on the server' }, { status: 500 });
  }
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || !constEq(token, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const startedAt = new Date().toISOString();
  const results = await runAllSyncs();
  const finishedAt = new Date().toISOString();
  const summary = {
    startedAt, finishedAt,
    counts: {
      ok: results.filter(r => r.status === 'ok').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length,
    },
    jobs: results,
  };
  // Log each job result on its own line so the GH Actions log is scannable.
  for (const r of results) {
    const tag = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '·' : '✗';
    const detail = r.message || r.error || '';
    console.log(`[cron] ${tag} ${r.name} (${r.durationMs}ms) ${detail}`);
  }
  // Always 200 with a summary — GH Actions checks individual job statuses in the body.
  return NextResponse.json(summary);
}

// Allow GET for quick browser inspection by developers (still requires Bearer).
export async function GET(req: NextRequest) { return POST(req); }
