// One-off: warm the production Upstash Redis cache right now so the dashboard
// isn't empty while waiting for the 15-min cron. Run with the pulled prod env
// (KV creds + Tekmetric/WhatConverts/Anthropic) so writeCache targets prod
// Redis:  npx tsx --env-file=/tmp/prod.env scripts/warmProd.ts

import { rosForChain } from '../lib/dataAccess';
import { resolveRange } from '../lib/dates';
import { runAllSyncs } from '../lib/syncJobs';

async function main() {
  const useRedis = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  console.log(`[warm] target = ${useRedis ? 'PROD Redis (Upstash)' : 'LOCAL file cache'}`);
  if (!useRedis) { console.error('[warm] KV creds missing — aborting so we do not write to the wrong cache'); process.exit(1); }

  // Underlying RO cache for the windows the live components actually request.
  for (const r of ['last_7_days', 'this_week', 'this_month', 'wtd'] as const) {
    const w = resolveRange(r);
    const t0 = Date.now();
    try {
      const ros = await rosForChain({ startISO: w.startISO, endISO: w.endISO });
      console.log(`[warm] rosForChain ${r}: ${ros.length} ROs (${Date.now() - t0}ms)`);
    } catch (e: any) {
      console.warn(`[warm] rosForChain ${r} FAILED: ${e?.message || e}`);
    }
  }

  // Run the cron set 9× with a pause between: warm-fbr-leaderboard advances
  // its round-robin pointer each run, so 9 passes covers all 8 shops (one
  // appointment pull at a time — no 429 burst).
  for (let pass = 1; pass <= 9; pass++) {
    const results = await runAllSyncs();
    for (const r of results) {
      if (r.name === 'warm-fbr-leaderboard' || pass === 1) {
        console.log(`[warm] pass${pass} ${r.name.padEnd(26)} ${r.status.padEnd(8)} ${r.durationMs}ms  ${r.message || r.error || ''}`);
      }
    }
    await new Promise(res => setTimeout(res, 4000)); // be gentle on Tekmetric
  }
  console.log('[warm] done — prod Redis populated');
}

main().catch(e => { console.error(e); process.exit(1); });
