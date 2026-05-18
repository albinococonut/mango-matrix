// Registry of sync jobs the cron endpoint runs.
//
// Lightweight by design: only Tekmetric warm-ups + the tech-name lookup. Heavy
// jobs (Anthropic classification, Postgres-backed GBP review sync, FBR warm)
// live in _disabled_jobs until DB + paid Vercel tier are in place. Keeping
// this file dep-light is what lets the cron route stay under the 250MB
// serverless function size cap on Hobby.
//
// Each job is self-contained:
//   - `isEnabled` is evaluated at call time so toggling env vars takes effect
//     on the next cron tick without redeploy.
//   - `run()` should be idempotent and fail closed — throw on error so the
//     dispatcher can record the failure without bringing down sibling jobs.

import { resolveRange } from '@/lib/dates';
import { rosForChain } from '@/lib/dataAccess';
import { getTechnicianNames } from '@/lib/technicians';

export interface SyncJob {
  name: string;
  isEnabled(): boolean;
  run(): Promise<{ message?: string; details?: Record<string, unknown> }>;
}

const warmTekmetric: SyncJob = {
  name: 'warm-tekmetric-cache',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    const windows = ['this_week', 'this_month'] as const;
    let totalROs = 0;
    for (const r of windows) {
      const w = resolveRange(r);
      const ros = await rosForChain({ startISO: w.startISO, endISO: w.endISO });
      totalROs += ros.length;
    }
    return { message: `${totalROs} ROs cached across this_week + this_month` };
  },
};

const refreshTechNames: SyncJob = {
  name: 'refresh-tech-names',
  isEnabled: () => !!process.env.TEKMETRIC_CLIENT_ID,
  async run() {
    const names = await getTechnicianNames();
    return { message: `tech roster refreshed`, details: { count: Object.keys(names).length } };
  },
};

export const JOBS: SyncJob[] = [
  warmTekmetric,
  refreshTechNames,
];

export interface JobResult {
  name: string;
  status: 'ok' | 'skipped' | 'error';
  durationMs: number;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export async function runAllSyncs(): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of JOBS) {
    const t0 = Date.now();
    if (!job.isEnabled()) {
      results.push({ name: job.name, status: 'skipped', durationMs: 0, message: 'disabled (env or feature gate)' });
      continue;
    }
    try {
      const r = await job.run();
      results.push({ name: job.name, status: 'ok', durationMs: Date.now() - t0, message: r.message, details: r.details });
    } catch (e: any) {
      results.push({ name: job.name, status: 'error', durationMs: Date.now() - t0, error: e?.message || String(e) });
    }
  }
  return results;
}
