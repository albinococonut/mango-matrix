// One-off: (1) delete the Golden Mango key so the hero rolls back to
// "Awaiting the First Crown"; (2) warm last_7_days ROs into prod Redis;
// (3) run the strict Claude-classified booked-rate and print a sample so we
// can SEE Anthropic responding, then write it to prod Redis.
//
// Run: npx tsx --env-file=/tmp/warm.env scripts/fixNow.ts

import { rosForChain } from '../lib/dataAccess';
import { resolveRange } from '../lib/dates';
import { fetchAllLeads, isEligibleCall } from '../lib/whatconverts';
import { classifyBatch } from '../lib/classify';
import { SHOP_BY_NUM, ShopNum } from '../lib/shops';
import { writeCache } from '../lib/cache';

const URL = process.env.KV_REST_API_URL!;
const TOKEN = process.env.KV_REST_API_TOKEN!;

async function redis(args: (string | number)[]) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return (await r.json()).result;
}

async function main() {
  if (!URL || !TOKEN) { console.error('KV creds missing'); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing — Claude cannot classify'); process.exit(1); }

  // 1) Roll Golden Mango back to "Awaiting the First Crown".
  const del = await redis(['DEL', 'mango:golden_mango']);
  console.log(`[fix] deleted mango:golden_mango (removed ${del}) → hero now "Awaiting the First Crown"`);

  // 2) Warm last_7_days ROs (durable Redis) for metrics/tech/SPC/weekly.
  const w7 = resolveRange('last_7_days');
  const ros = await rosForChain({ startISO: w7.startISO, endISO: w7.endISO });
  console.log(`[fix] warmed last_7_days ROs: ${ros.length}`);

  // 3) Strict booked-rate with Claude — print a sample to prove it works.
  const range = resolveRange('last_7_days');
  const startDate = range.startISO.slice(0, 10);
  const endDate = range.endISO.slice(0, 10);
  const shops = Object.keys(SHOP_BY_NUM) as ShopNum[];
  const out: any[] = [];
  let totalElig = 0, totalBooked = 0, sampleShown = false;
  for (const num of shops) {
    try {
      const leads = await fetchAllLeads({ shop: num, startDate, endDate });
      const eligible = leads.filter(isEligibleCall);
      const results = await classifyBatch(eligible, 8);
      if (!sampleShown && results.size) {
        const [, c] = [...results.entries()][0];
        console.log(`[fix] CLAUDE SAMPLE → booked=${(c as any).appointment_booked} conf=${(c as any).confidence} reason="${String((c as any).reason).slice(0, 90)}"`);
        sampleShown = true;
      }
      const booked = [...results.values()].filter((r: any) => r.appointment_booked).length;
      totalElig += eligible.length; totalBooked += booked;
      out.push({ shopNum: num, shopName: SHOP_BY_NUM[num].name, totalCalls: leads.length, eligible: eligible.length, booked, bookedRatePct: eligible.length ? Math.round((booked / eligible.length) * 1000) / 10 : 0 });
      console.log(`[fix] strict ${num} ${SHOP_BY_NUM[num].name}: ${booked}/${eligible.length}`);
    } catch (e: any) {
      out.push({ shopNum: num, shopName: SHOP_BY_NUM[num].name, totalCalls: 0, eligible: 0, booked: 0, bookedRatePct: 0, error: e?.message });
      console.warn(`[fix] strict ${num} FAILED: ${e?.message}`);
    }
  }
  await writeCache('booked_rate_wtd_strict', {
    windowStart: startDate, windowEnd: endDate, computedAt: new Date().toISOString(),
    classifier: 'claude_strict', shops: out,
    chain: { eligible: totalElig, booked: totalBooked, bookedRatePct: totalElig ? Math.round((totalBooked / totalElig) * 1000) / 10 : 0 },
  });
  console.log(`[fix] strict booked-rate written: chain ${totalBooked}/${totalElig} (${totalElig ? (100 * totalBooked / totalElig).toFixed(1) : 0}%)`);
  console.log('[fix] done');
}

main().catch(e => { console.error(e); process.exit(1); });
