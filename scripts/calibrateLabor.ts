// Per shop, for the current month (≈ Tekmetric report "Current Period"),
// print the dashboard's labor-hours input and current implied labor cost so
// each shop's rate can be calibrated to Tekmetric's actual Labor Cost:
//   calibratedRate = TekmetricActualLaborCost / dashboardLaborHours
// Run: set -a; . ./.env.local; set +a; npx tsx scripts/calibrateLabor.ts

import { rosForShop } from '../lib/dataAccess';
import { isCountedRO } from '../lib/metrics';
import { resolveRange } from '../lib/dates';
import { SHOPS } from '../lib/shops';

const RATE: Record<string, number> = { '001':59,'002':54,'003':50,'004':52,'005':55,'006':53,'007':48,'009':54 };

async function main() {
  const w = resolveRange('this_month');
  console.log(`Window ${w.startISO.slice(0,10)} → ${w.endISO.slice(0,10)} (compare to Tekmetric report Current Period)\n`);
  console.log('shop  name          laborHrs   partsCost   revenue   curRate  impliedLaborCost  curGP%');
  for (const shop of SHOPS) {
    const ros = [
      ...await rosForShop(shop.tekmetricId, { startISO: w.startISO, endISO: w.endISO }),
      ...(shop.tekmetricIdSecondary ? await rosForShop(shop.tekmetricIdSecondary, { startISO: w.startISO, endISO: w.endISO }) : []),
    ];
    let revC = 0, partsC = 0, hrs = 0;
    for (const o of ros) {
      if (!isCountedRO(o)) continue;
      revC += o.laborSales + o.partsSales + o.subletSales + o.feeTotal - o.discountTotal;
      for (const j of o.jobs) {
        if (!j.authorized) continue;
        for (const p of j.parts) partsC += p.cost * p.quantity;
        hrs += j.laborHours || 0;
      }
    }
    const rev = revC / 100, parts = partsC / 100;
    const rate = RATE[shop.num] ?? 50;
    const laborCost = hrs * rate;
    const gp = rev ? ((rev - parts - laborCost) / rev) * 100 : 0;
    console.log(`${shop.num}   ${shop.name.padEnd(12)} ${hrs.toFixed(1).padStart(8)} ${parts.toFixed(0).padStart(11)} ${rev.toFixed(0).padStart(9)} ${String(rate).padStart(7)} ${laborCost.toFixed(0).padStart(16)} ${gp.toFixed(1).padStart(7)}`);
    await new Promise(r => setTimeout(r, 250));
  }
  console.log('\ncalibratedRate = TekmetricActualLaborCost / laborHrs   →   set LABOR_RATE_BY_SHOP');
}
main().catch(e => { console.error(e); process.exit(1); });
