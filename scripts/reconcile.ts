// Reconciliation harness. Pulls Tekmetric (the dashboard's own source) per
// shop + range and prints the dashboard's computed Revenue / GP% / Car-count
// exactly as chainKpi produces them, so they can be diffed against the
// Tekmetric Custom Report. Run:
//   set -a; . ./.env.local; set +a; npx tsx scripts/reconcile.ts

import { rosForShop } from '../lib/dataAccess';
import { chainKpi } from '../lib/metrics';
import { resolveRange, RangeKey } from '../lib/dates';
import { SHOPS } from '../lib/shops';

const RANGES: RangeKey[] = ['this_week', 'last_week', 'this_month', 'last_month', 'this_quarter'];

async function main() {
  for (const range of RANGES) {
    const w = resolveRange(range);
    console.log(`\n===== ${range.toUpperCase()}  (${w.startISO.slice(0,10)} → ${w.endISO.slice(0,10)}, basis=postedDate, tz=Tekmetric report tz) =====`);
    let chainRev = 0, chainCars = 0, chainGp = 0;
    for (const shop of SHOPS) {
      try {
        const ros = await rosForShop(shop.tekmetricId, { startISO: w.startISO, endISO: w.endISO });
        const extra = shop.tekmetricIdSecondary
          ? await rosForShop(shop.tekmetricIdSecondary, { startISO: w.startISO, endISO: w.endISO })
          : [];
        const kpi = chainKpi([...ros, ...extra]);
        const s = kpi.byShop.find(x => x.shopNum === shop.num);
        const rev = s?.revenue ?? 0, cars = s?.cars ?? 0, gp = s?.gpPct ?? 0;
        chainRev += rev; chainCars += cars; chainGp += rev * gp;
        console.log(`  ${shop.num} ${shop.name.padEnd(12)} rev=$${rev.toLocaleString(undefined,{maximumFractionDigits:0}).padStart(9)}  cars=${String(cars).padStart(4)}  GP%=${(gp*100).toFixed(1).padStart(5)}  (ROs counted=${s ? 'y' : 'n'}, raw=${ros.length+extra.length})`);
      } catch (e: any) {
        console.log(`  ${shop.num} ${shop.name.padEnd(12)} ERROR: ${e?.message}`);
      }
      await new Promise(r => setTimeout(r, 300)); // gentle on Tekmetric
    }
    console.log(`  ── CHAIN: rev=$${chainRev.toLocaleString(undefined,{maximumFractionDigits:0})}  cars=${chainCars}  blendedGP%=${chainRev ? (100*chainGp/chainRev).toFixed(1) : 0}`);
  }
  console.log('\n[reconcile] done');
}
main().catch(e => { console.error(e); process.exit(1); });
