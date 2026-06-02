// Local-only: populate the dev server's response caches so every exec section
// renders for visual review. Mints an executive session from the local
// AUTH_SECRET already in .env.local (this machine, this user's own secret —
// no password, no network account) and hits the same endpoints the dashboard
// calls. Run with the dev server up:
//   set -a; . ./.env.local; set +a; npx tsx scripts/warmLocal.ts
import { signRoleCookie, COOKIE_NAME } from '../lib/auth';

const BASE = process.env.WARM_BASE || 'http://localhost:3007';

async function main() {
  const { value } = await signRoleCookie('executive');
  const headers = { Cookie: `${COOKIE_NAME}=${value}` };
  const today = new Date().toISOString().slice(0, 10);
  const yStart = `${today.slice(0, 4)}-01-01`;

  const urls = [
    '/api/metrics?range=this_month',
    '/api/metrics?range=last_7_days',
    '/api/metrics?range=this_week',
    '/api/tech-production?range=this_month',
    '/api/tech-production?range=last_7_days',
    '/api/fbr?view=leaderboard',
    '/api/extras?view=comebacks&range=this_month',
    '/api/extras?view=comebacks&range=last_7_days',
    '/api/extras?view=google-ratings',
    '/api/extras?view=booked-rate&strict=1',
    '/api/period-comparison?range=this_month&compare=same_period_last_year&no_weekends=1',
    '/api/shop-performance-heatmap?weeks=12',
    '/api/exec-metrics?view=opportunity&range=this_month',
    '/api/exec-metrics?view=projection&period=this_week',
    '/api/exec-metrics?view=projection&period=this_month',
    `/api/exec-metrics?view=ar&mode=over30&start=${yStart}&end=${today}`,
    `/api/exec-metrics?view=ar&mode=total&start=${yStart}&end=${today}`,
    `/api/exec-metrics?view=ar&mode=new&start=${yStart}&end=${today}`,
  ];

  for (const u of urls) {
    const t0 = Date.now();
    try {
      const r = await fetch(BASE + u, { headers });
      const txt = await r.text();
      const ok = r.status === 200;
      console.log(`${ok ? '✓' : '✗'} ${r.status} ${u} (${Date.now() - t0}ms, ${txt.length}b)`);
    } catch (e: any) {
      console.log(`✗ ERR ${u} — ${e?.message}`);
    }
    await new Promise((res) => setTimeout(res, 800)); // gentle on Tekmetric
  }
  console.log('\n[warm] done — refresh the dashboard');
}
main().catch((e) => { console.error(e); process.exit(1); });
