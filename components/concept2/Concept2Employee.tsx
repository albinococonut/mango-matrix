'use client';

// CONCEPT 2 — Employee View (recognition core) in the bespoke luxury design.
// Section 1 (Golden Mango champion) + the Weekly Leaderboard are rebuilt here
// from the same endpoints as production. The remaining recognition + operations
// widgets are flagged as the next increment (built section by section).

import { useEffect, useMemo, useState } from 'react';
import { SHOPS, SHOP_BY_NUM } from '@/lib/shops';
import { loadGoals, GoalsByShop, weeklyMinuteProratedGoal } from '@/lib/goals';
import { INK, INK2, FAINT, LINE, AMBER, GOOD, WARN, BAD, heatRGB, norm, usd, safe } from './kit';
import { MissedCallbacksChainStrip, MissedCallbacksShopQueue } from '@/components/MissedCallbacks';
import { MissedRebooksShopList } from '@/components/MissedRebooks';
import { TrophyIcon } from '@/components/Trophy';
import { toZonedTime } from 'date-fns-tz';
import { historyWeeksSince } from '@/lib/trophyHistory';
import { TechCard } from '@/components/TechProduction';
import MangoTierIcon, { tierFor, MangoTier } from '@/components/MangoTierIcon';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';

const GOLD = '#C9A227', GOLD_SOFT = 'rgba(201,162,39,0.28)';
const pct = (v: number) => (v * 100).toFixed(1) + '%';
const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); } catch { return iso.slice(0, 10); } };
const heatBar = (score: number) => { const [r, g, b] = heatRGB(score); return `linear-gradient(90deg, rgba(${r},${g},${b},0.55), rgba(${r},${g},${b},0.95))`; };
const heatSolid = (score: number) => { const [r, g, b] = heatRGB(score); return `rgb(${r},${g},${b})`; };

interface Champion { periodStart: string; crownedAt: string; shopNum: string; shopName: string; score: number; medals: { gold: number; silver: number; bronze: number }; revenue: number; gpPct: number; cars: number; rankMovement: number | null; defendingSince: string; isNewChampion: boolean; isTie?: boolean; tiedShopNames?: string[] }

function useCountdown(targetISO: string | null) {
  const [p, setP] = useState<{ d: number; h: number; m: number; s: number } | null>(null);
  useEffect(() => {
    if (!targetISO) return;
    const tick = () => {
      const ms = new Date(targetISO).getTime() - Date.now();
      if (ms <= 0) { setP({ d: 0, h: 0, m: 0, s: 0 }); return; }
      setP({ d: Math.floor(ms / 86400000), h: Math.floor((ms % 86400000) / 3600000), m: Math.floor((ms % 3600000) / 60000), s: Math.floor((ms % 60000) / 1000) });
    };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [targetISO]);
  return p;
}
function TimeBlock({ n, label }: { n: number; label: string }) {
  // Same white-translucent inset pattern the rest of the page uses for
  // numbers-on-tinted-surfaces (LeaderSpotlight, OpsHero micros). Drops the
  // champagne-plastic look that didn't match anything else on the page.
  return (
    <div className="flex flex-col items-center">
      <div className="c2disp tabular-nums rounded-xl px-4 py-2.5" style={{
        minWidth: '3.6rem',
        fontSize: '1.7rem',
        letterSpacing: '-0.02em',
        color: INK,
        background: 'rgba(255,255,255,0.62)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.6), 0 1px 0 rgba(255,255,255,0.7) inset',
      }}>{String(n).padStart(2, '0')}</div>
      <span className="c2ui mt-2 text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: INK2 }}>{label}</span>
    </div>
  );
}
function HeroStat({ label, value }: { label: string; value: string }) {
  // Bumped concept-1-confident: 1.4→2.0rem (was 1.15→1.6) so the champion's
  // Weekly Score / Revenue / GP% / Cars / Defending-Since stats carry weight
  // proportional to the hero numbers around them.
  return <div className="flex flex-col"><span className="c2disp tabular-nums" style={{ color: INK, fontSize: 22, letterSpacing: '-0.015em' }}>{value}</span><span className="c2ui mt-1.5 text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: INK2 }}>{label}</span></div>;
}

function GoldenMango() {
  const [data, setData] = useState<{ champion: Champion | null; nextCrownAt: string } | null>(null);
  const cd = useCountdown(data?.nextCrownAt ?? null);
  const fetchOnce = () => safe<any>('/api/extras?view=golden-mango').then((d) => { setData(d); return d; });
  useEffect(() => { fetchOnce(); }, []);
  const reachedZero = cd && cd.d === 0 && cd.h === 0 && cd.m === 0 && cd.s === 0;
  useEffect(() => {
    if (!reachedZero || !data) return;
    const startedAt = data.nextCrownAt; let polls = 0;
    const id = setInterval(async () => { polls++; if (polls > 20) { clearInterval(id); return; } const fresh = await fetchOnce(); if (fresh?.nextCrownAt && fresh.nextCrownAt !== startedAt) clearInterval(id); }, 15000);
    return () => clearInterval(id);
  }, [reachedZero, data?.nextCrownAt]);

  const champ = data?.champion ?? null;
  const move = (() => { if (!champ) return null; if (champ.rankMovement === null) return { txt: 'New', c: '#3E9CB0' }; if (champ.rankMovement > 0) return { txt: `▲ ${champ.rankMovement}`, c: GOOD }; if (champ.rankMovement === 0) return { txt: 'Holding', c: INK2 }; return { txt: `▼ ${Math.abs(champ.rankMovement)}`, c: BAD }; })();
  const title = champ?.isTie ? (champ.tiedShopNames || [champ.shopName]).join('  ·  ') : champ?.shopName;

  return (
    <section className="relative w-full overflow-hidden mb-7" style={{
      borderRadius: 26,
      // Same atmospheric blue → gold → coral wash the OpsHero and
      // LeaderSpotlight chrome use, so the Golden Mango sits on the page in
      // the same visual system instead of being a saturated-gold plaque that
      // didn't match anything around it. Gold is reserved for: the small
      // wordmark accent, the TrophyIcon, and the actual Golden Mango trophy
      // image — not the chrome.
      background: 'linear-gradient(160deg, rgba(95,169,214,0.12), rgba(242,206,112,0.12) 55%, rgba(232,134,62,0.12))',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55), 0 1px 0 rgba(255,255,255,0.7) inset, 0 18px 48px -28px rgba(40,34,26,0.30)',
    }}>
      <div className="relative px-6 sm:px-10 py-9 sm:py-11">
        {/* Header — small TrophyIcon + refined Fraunces wordmark, both in
            gold. That's the only gold accent in the chrome. */}
        <div className="flex items-center gap-2.5">
          <TrophyIcon rank={1} size={22} />
          <div>
            <div className="c2disp" style={{ color: GOLD, fontSize: 18, letterSpacing: '-0.005em', fontWeight: 600 }}>The Golden Mango</div>
            <div className="c2ui text-[13px] mt-0.5" style={{ color: INK2 }}>This week’s champion · locked Fridays 6 PM MT</div>
          </div>
        </div>

        {champ ? (
          <div className="mt-7">
            {/* HERO — 2-column editorial. LEFT: cinematic team photo.
                RIGHT: trophy + kicker + champion shop name + medals + score.
                Breakpoint is md (768px) not lg (1024px) so most viewports
                land in the 2-column composition; the single-column stack
                only fires on phone-sized widths. Photo also has a maxHeight
                cap so it can't dominate the page when it stacks. */}
            <div className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr] gap-6 md:gap-10 items-stretch">
              {/* LEFT — team photo only. Earlier revisions stamped the
                  Golden Mango trophy on the top-right corner of the photo
                  for a "magazine cover" composition, but the trophy covered
                  the team members and read as visual clutter. The trophy
                  now lives in the right column above the headline so the
                  photo can breathe and the team is fully visible.
                  maxHeight caps the stacked-on-mobile case where a wide
                  parent + 4:3 aspect ratio would otherwise produce an
                  absurdly tall photo that pushes the champion's name + the
                  Weekly Score row off the visible viewport. */}
              {/* When stacked (single-column, below md), the photo would
                  otherwise occupy the full content width AND honor 4:3,
                  producing a 700×525 wall poster that pushed the champion's
                  name + medals below the fold. maxWidth caps the width
                  ceiling so the photo never exceeds a normal "team photo"
                  presentation; mx-auto centers it inside the parent column
                  on small viewports; w-full lets it grow up to the cap when
                  there's room. In the 2-col composition (md+) the parent
                  grid column already constrains width so these caps don't
                  fire — same composition as before. */}
              <div className="relative rounded-3xl overflow-hidden w-full mx-auto" style={{
                aspectRatio: '4 / 3',
                maxWidth: 540,
                maxHeight: 405,
                background: 'linear-gradient(160deg, rgba(252,243,217,0.6), rgba(244,225,170,0.4))',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.7), 0 18px 40px -16px rgba(40,34,26,0.32)',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/shop-photos/${encodeURIComponent(`${champ.shopNum} team photo.jpg`)}`} alt={`${champ.shopName} team`} className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              </div>

              {/* RIGHT — editorial text block. Vertically centers against
                  the photo on lg+ so the champion's name + medals read as
                  the story beside the image. Trophy lives at the top of
                  THIS column so it's part of the headline rather than
                  covering the team photo. */}
              <div className="flex flex-col justify-center min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/the-golden-mango.png" alt="The Golden Mango trophy" className="object-contain mb-3" style={{ width: 'clamp(80px, 12vw, 140px)', height: 'auto', filter: 'drop-shadow(0 10px 18px rgba(124,72,12,0.36))' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                {champ.isTie && <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em] mb-2" style={{ color: GOLD }}>Shared Title</div>}
                <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em] mb-2.5" style={{ color: INK2 }}>Champion · this week</div>
                {/* Title fontSize: previously fixed at 44 which would overflow
                    or push the medals row off-screen at any column width below
                    ~320 px (long shop names like "Cottonwood" hit ~230 px at
                    44 px). clamp() scales the headline with viewport width so
                    "The Valley" still reads as the hero on a phone while
                    "Cottonwood" doesn't break the layout on a 900 px laptop
                    in the 2-col composition. min-w-0 + break-words guard
                    against the rare extra-long custom name. */}
                <h2 className="c2disp leading-[1.02] break-words" style={{ color: INK, fontSize: 'clamp(28px, 3.6vw, 44px)', letterSpacing: '-0.03em' }}>{title}</h2>
                {/* Medal + score + rank-movement row. gap-x scales from
                    compact (5 = 20 px) on narrow screens to airy (8 = 32 px)
                    on md+. flex-wrap + items-end keep them gracefully
                    stacked when the column gets tight, instead of
                    overflowing horizontally. */}
                <div className="mt-6 flex flex-wrap items-end gap-x-5 sm:gap-x-8 gap-y-4">
                  <div className="flex flex-col">
                    <span className="c2disp tabular-nums flex items-center gap-2.5 flex-wrap" style={{ fontSize: 22, letterSpacing: '-0.015em', color: INK }}>
                      <span className="inline-flex items-center gap-1.5"><TrophyIcon rank={1} size={22} />{champ.medals.gold}</span>
                      <span className="inline-flex items-center gap-1.5"><TrophyIcon rank={2} size={22} />{champ.medals.silver}</span>
                      <span className="inline-flex items-center gap-1.5"><TrophyIcon rank={3} size={22} />{champ.medals.bronze}</span>
                    </span>
                    <span className="c2ui mt-1.5 text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: INK2 }}>Medals</span>
                  </div>
                  <HeroStat label="Weekly Score" value={String(champ.score)} />
                  {move && <div className="flex flex-col"><span className="c2disp tabular-nums" style={{ color: move.c, fontSize: 22, letterSpacing: '-0.015em' }}>{move.txt}</span><span className="c2ui mt-1.5 text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: INK2 }}>vs last week</span></div>}
                </div>
              </div>
            </div>

            {/* STATS — one unified row, not split across two stat groups. */}
            <div className="mt-8 pt-7 grid grid-cols-2 md:grid-cols-4 gap-6" style={{ borderTop: '1px solid rgba(34,32,28,0.10)' }}>
              <HeroStat label="Revenue" value={usd(champ.revenue)} />
              <HeroStat label="GP %" value={`${(champ.gpPct * 100).toFixed(1)}%`} />
              <HeroStat label="Cars Serviced" value={String(champ.cars)} />
              <HeroStat label="Defending Since" value={fmtDate(champ.defendingSince)} />
            </div>

            {/* FOOTER — countdown left, ceremony description right. */}
            <div className="mt-8 pt-7 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-x-12 gap-y-5 items-start" style={{ borderTop: '1px solid rgba(34,32,28,0.10)' }}>
              <div>
                <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: GOLD }}>Next Crown</div>
                <div className="flex items-start gap-2.5"><TimeBlock n={cd?.d ?? 0} label="Days" /><TimeBlock n={cd?.h ?? 0} label="Hrs" /><TimeBlock n={cd?.m ?? 0} label="Min" /><TimeBlock n={cd?.s ?? 0} label="Sec" /></div>
              </div>
              <p className="c2ui text-[12.5px] leading-relaxed max-w-xl" style={{ color: INK2 }}>Awarded to the shop with the most <span style={{ color: INK, fontWeight: 600 }}>gold</span> finishes across the weekly categories — Revenue, GP%, Top Tech, Re-Books, Comebacks, Reviews &amp; Call Conversion. Ties break by silver, then bronze.</p>
            </div>
          </div>
        ) : (
          <div className="mt-8 flex flex-col items-center text-center">
            <h2 className="c2disp leading-tight" style={{ color: INK, fontSize: 30, letterSpacing: '-0.025em' }}>Crown loading…</h2>
            <p className="c2ui mt-2.5 text-[13px] max-w-md" style={{ color: INK2 }}>The current champion is being computed. The Golden Mango is locked every Friday at 6:00 PM Mountain — refresh in a moment.</p>
            <div className="mt-7 flex items-start gap-2.5"><TimeBlock n={cd?.d ?? 0} label="Days" /><TimeBlock n={cd?.h ?? 0} label="Hrs" /><TimeBlock n={cd?.m ?? 0} label="Min" /><TimeBlock n={cd?.s ?? 0} label="Sec" /></div>
            <div className="mt-10 w-full">
              <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em] mb-5" style={{ color: GOLD }}>Who will it be?</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
                {SHOPS.map((s) => (
                  <div key={s.num} className="flex flex-col items-center text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/shop-photos/${encodeURIComponent(`${s.num} team photo.jpg`)}`} alt={`${s.name} team`} className="w-16 h-16 rounded-full object-cover mb-2" style={{ boxShadow: '0 0 0 1.5px rgba(255,255,255,0.7), 0 4px 12px -4px rgba(40,34,26,0.20)' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                    <span className="c2ui text-[13px] font-medium leading-tight" style={{ color: INK }}>{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

interface ShopMetrics { shopNum: string; shopName: string; revenue: number; gpPct: number; tickets: number; approvedDollars: number }
function WeeklyLeaderboard() {
  const [metrics, setMetrics] = useState<ShopMetrics[] | null>(null);
  const [goals, setGoals] = useState<GoalsByShop>({});
  const [dataAt, setDataAt] = useState<Date | null>(null);
  useEffect(() => { setGoals(loadGoals()); }, []);
  useEffect(() => {
    safe<any>('/api/metrics?range=this_week').then((d) => {
      if (!d?.kpi?.byShop) return;
      const byNum = new Map<string, any>(d.kpi.byShop.map((s: any) => [s.shopNum, s]));
      setMetrics(SHOPS.map((shop) => { const s = byNum.get(shop.num); return { shopNum: shop.num, shopName: shop.name, revenue: s?.revenue ?? 0, gpPct: s?.gpPct ?? 0, tickets: s?.cars ?? 0, approvedDollars: s?.approvedDollars ?? 0 }; }));
      setDataAt(new Date());
    });
  }, []);
  const proratedRevenueGoal = (shopNum: string): number | undefined => { const raw = goals[shopNum]?.revenueWeekly; if (!raw || !dataAt) return undefined; return weeklyMinuteProratedGoal(shopNum, raw, dataAt); };

  if (!metrics) return <div className="rounded-[26px] mb-7" style={{ height: 360, background: 'rgba(255,255,255,0.5)', border: `1px solid ${LINE}` }} />;
  const withRatios = metrics.map((r) => { const goal = proratedRevenueGoal(r.shopNum); return { ...r, revGoal: goal, revRatio: goal ? r.revenue / goal : 0, weeklyGoal: goals[r.shopNum]?.revenueWeekly }; });
  const byRevenue = [...withRatios].sort((a, b) => b.revRatio - a.revRatio);
  const byGP = [...withRatios].sort((a, b) => b.gpPct - a.gpPct);

  const revLeader = byRevenue[0];
  const gpLeader = byGP[0];

  // Editorial leader spotlight card — used twice (Revenue + GP%). Big
  // Fraunces hero number, shop-color identity stripe, heat-tinted score
  // track. The hero moment the previous side-by-side lists were missing.
  const LeaderSpotlight = ({ r, kind }: { r: typeof withRatios[number]; kind: 'revenue' | 'gp' }) => {
    const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
    const shopColor = meta?.color || FAINT;
    const score = kind === 'revenue' ? (r.revGoal ? norm(r.revRatio, 0.8, 1.05) : 0.5) : norm(r.gpPct, 0.5, 0.6);
    const [rr, gg, bb] = heatRGB(score);
    const headlineValue = kind === 'revenue' ? usd(r.revenue) : pct(r.gpPct);
    const fillPct = kind === 'revenue' ? Math.min(100, Math.max(4, r.revRatio * 100)) : Math.min(100, Math.max(4, (r.gpPct / 0.6) * 100));
    const goalMarkerX = kind === 'revenue' ? 100 : Math.min(100, (0.58 / 0.6) * 100);
    return (
      <div className="rounded-[24px] overflow-hidden" style={{
        // Concept-1 heat-tinted card surface: the spotlight's atmosphere IS
        // the leader's score (cool blue if crushing it, gold-yellow at
        // pace, coral if behind). Same luminous radial wash the diagnostic's
        // projection tiles use. Shop identity is kept via the top stripe
        // below + the identity dot beside the name + the heat-bar's goal
        // tick rendered in shop color.
        background: `radial-gradient(135% 160% at 28% -10%, rgba(${rr},${gg},${bb},0.36), rgba(${rr},${gg},${bb},0.12) 70%, rgba(${rr},${gg},${bb},0.06))`,
        boxShadow: `inset 0 0 0 1px rgba(${rr},${gg},${bb},0.30), 0 1px 0 rgba(255,255,255,0.7) inset, 0 12px 32px -22px rgba(40,34,26,0.30)`
      }}>
        <div style={{ height: 6, background: `linear-gradient(90deg, ${shopColor}, ${shopColor}aa 70%, ${shopColor}55)` }} />
        <div className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <TrophyIcon rank={1} size={20} />
            <span className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: AMBER }}>
              {kind === 'revenue' ? 'Revenue leader · this week' : 'Gross profit leader · this week'}
            </span>
          </div>
          <div className="flex items-baseline gap-3 mb-1.5 flex-wrap">
            <span className="inline-block rounded-full shrink-0" style={{ width: 12, height: 12, background: shopColor, boxShadow: `0 0 0 4px ${shopColor}22` }} />
            <div className="c2disp leading-tight" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>{r.shopName}</div>
          </div>
          <div className="c2disp tabular-nums leading-none mt-3" style={{ color: INK, fontSize: 44, letterSpacing: '-0.03em' }}>{headlineValue}</div>
          <div className="c2ui text-[12.5px] mt-2.5" style={{ color: INK2 }}>
            {kind === 'revenue' ? (
              <>
                <span className="c2disp tabular-nums font-bold" style={{ color: `rgb(${rr},${gg},${bb})`, fontSize: 14 }}>{r.revGoal ? `${(r.revRatio * 100).toFixed(0)}%` : '—'}</span>
                {r.revGoal ? <> of {usd(r.revGoal)} prorated goal · </> : ' '}
                <span className="tabular-nums" style={{ color: INK }}>{r.tickets}</span> tickets · approved <span className="c2disp tabular-nums" style={{ color: INK }}>{usd(r.approvedDollars)}</span>
              </>
            ) : (
              <>
                <span className="c2disp tabular-nums font-bold" style={{ color: `rgb(${rr},${gg},${bb})`, fontSize: 14 }}>{(r.gpPct * 100).toFixed(1)}%</span> vs 58% target
                {r.tickets > 0 && <> · <span className="tabular-nums" style={{ color: INK }}>{r.tickets}</span> tickets</>}
              </>
            )}
          </div>
          <div className="mt-4 relative h-3 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.06)' }}>
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fillPct}%`, background: `linear-gradient(90deg, rgba(${rr},${gg},${bb},0.55), rgba(${rr},${gg},${bb},0.95))` }} />
            <div className="absolute top-0 bottom-0 w-px" style={{ left: `${goalMarkerX}%`, background: 'rgba(34,32,28,0.55)' }} />
            <div className="absolute top-1/2 c2ui text-[13px] font-bold uppercase tracking-wider rounded px-1" style={{ left: `${goalMarkerX}%`, transform: `translate(${goalMarkerX > 80 ? '-100%' : '4px'}, -50%)`, background: 'rgba(255,255,255,0.9)', color: INK }}>
              {kind === 'revenue' ? 'Goal' : '58%'}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Compact row for the rest of the shops — both Revenue and GP% on a
  // single horizontal line so the eye scans the chain at once.
  const compactRow = (r: typeof withRatios[number], idx: number) => {
    const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
    const shopColor = meta?.color || FAINT;
    const revScore = r.revGoal ? norm(r.revRatio, 0.8, 1.05) : 0.5;
    const gpScore = norm(r.gpPct, 0.5, 0.6);
    const [rr, gg, bb] = heatRGB(revScore);
    const [gr, gg2, gb] = heatRGB(gpScore);
    return (
      <div key={r.shopNum} className="grid items-center gap-4 py-2.5 px-2" style={{ gridTemplateColumns: '20px 1.4fr 1.2fr 1.2fr', borderBottom: `1px solid ${LINE}` }}>
        <div className="text-right c2disp text-[13px]" style={{ color: idx < 3 ? AMBER : FAINT }}>{idx + 2}</div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: shopColor }} />
          <div className="min-w-0">
            <div className="c2ui font-medium text-[13px] leading-tight truncate" style={{ color: INK }}>{r.shopName}</div>
            <div className="c2ui text-[12.5px] leading-tight" style={{ color: FAINT }}>{r.weeklyGoal ? `Goal ${usd(r.weeklyGoal)}/wk · ${r.tickets} tkts` : `${r.tickets} tickets`}</div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.06)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, r.revRatio * 100))}%`, background: `linear-gradient(90deg, rgba(${rr},${gg},${bb},0.55), rgba(${rr},${gg},${bb},0.95))` }} />
          </div>
          <div className="c2disp text-[13px] tabular-nums w-16 text-right" style={{ color: INK }}>{usd(r.revenue)}</div>
          <div className="c2ui text-[12.5px] tabular-nums w-9 text-right" style={{ color: FAINT }}>{r.revGoal ? `${(r.revRatio * 100).toFixed(0)}%` : '—'}</div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.06)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, (r.gpPct / 0.6) * 100))}%`, background: `linear-gradient(90deg, rgba(${gr},${gg2},${gb},0.55), rgba(${gr},${gg2},${gb},0.95))` }} />
          </div>
          <div className="c2disp text-[13px] tabular-nums w-14 text-right" style={{ color: INK }}>{pct(r.gpPct)}</div>
        </div>
      </div>
    );
  };

  const restByRevenue = byRevenue.filter((r) => r.shopNum !== revLeader.shopNum);

  return (
    <div className="rounded-[26px] border mb-7" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.58))', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', borderColor: 'rgba(255,255,255,0.75)', boxShadow: '0 18px 48px -28px rgba(40,34,26,0.30)' }}>
      <div className="px-6 pt-6 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.22em]" style={{ color: FAINT }}>This Week · live</div>
        <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 22, letterSpacing: '-0.02em' }}>Pacing to Goal &amp; GP% Target</h2>
        <p className="c2ui text-[12.5px] mt-1.5 max-w-xl" style={{ color: INK2 }}>Two heroes leading: the shop earning the highest share of its prorated weekly revenue goal, and the shop holding the highest gross-profit percentage. The other six follow below.</p>
      </div>
      <div className="px-6 py-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LeaderSpotlight r={revLeader} kind="revenue" />
        <LeaderSpotlight r={gpLeader} kind="gp" />
      </div>
      <div className="px-6 pb-6">
        <div className="grid items-center gap-4 px-2 pb-2" style={{ gridTemplateColumns: '20px 1.4fr 1.2fr 1.2fr', borderBottom: `1px solid ${LINE}` }}>
          <div />
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>Shop</div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>Revenue · vs goal</div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>GP% · vs 58% target</div>
        </div>
        {/* Render the rest in revenue order; each row shows BOTH metrics for
            that shop, so the eye scans the chain once instead of cross-
            referencing two parallel columns like the old two-up layout. */}
        {restByRevenue.map((r, i) => compactRow(r, i))}
      </div>
    </div>
  );
}

export default function Concept2Employee({ role }: { role?: string }) {
  const isExec = role === 'executive';
  return (
    <div>
      <div id="golden" className="scroll-mt-6"><GoldenMango /></div>
      <div id="trophies" className="scroll-mt-6">
        <SectionOpener kicker="Recognition" title="Trophies, Leaders & Leverage" sub="Where the wins live — and where the next one is hiding. Every shop, every metric, this week." />
        <TrophyTallyWeek />
        {/* TrophyTallyQuarter ("Past Trophies Earned this Quarter") was
            moved to the END of the Diagnostic page at user request — the
            cumulative YTD ledger sits with the diagnostic narrative, this
            employee page focuses on THIS WEEK's tally and operations. */}
        <HighestLeverage />
        <WeeklyLeaderboard />
      </div>
      <div id="operations" className="scroll-mt-6">
        <SectionOpener kicker="Operations" title="The Numbers Behind the Numbers" sub="Calls answered, jobs re-booked, comebacks avoided, hours billed. The unglamorous engine room of the chain." accent={INK2} />
        {/* Ordering matches production /employee Dashboard.tsx — Tech first,
            then loss-tracking (Comebacks, FBR), then operational levers (Reviews
            exec-only, Call Conversion, To-Do), then chain-wide comparison. */}
        <TechProduction />
        <Comebacks />
        <FbrLeaderboard />
        {isExec && <GoogleRatings />}
        <BookedRate />
        <TodoRecoveriesWidget />
        <ShopPerformance isExec={isExec} />
      </div>
    </div>
  );
}

// shared luxury two-button toggle for rolling-7 vs this-week leaderboards
function WinToggle({ value, onChange }: { value: 'rolling' | 'this_week'; onChange: (v: 'rolling' | 'this_week') => void }) {
  return (
    <div className="inline-flex rounded-full p-1" style={{ background: 'rgba(34,32,28,0.05)', border: `1px solid ${LINE}` }}>
      {(['this_week', 'rolling'] as const).map((k) => (
        <button key={k} onClick={() => onChange(k)} className="c2ui rounded-full px-3 py-1 text-[13px] font-semibold transition" style={value === k ? { background: '#fff', color: INK, boxShadow: '0 1px 4px rgba(40,34,26,0.12)' } : { color: INK2 }}>{k === 'this_week' ? 'This Week' : 'Rolling 7d'}</button>
      ))}
    </div>
  );
}
function frostCard(): React.CSSProperties { return { background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.58))', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '1px solid rgba(255,255,255,0.75)', boxShadow: '0 18px 48px -28px rgba(40,34,26,0.30)' }; }
function tileInset(): React.CSSProperties { return { background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }; }
const numFmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pctR = (v: number, d = 1) => (v * 100).toFixed(d) + '%';

// Editorial hero for operations widgets — replaces uniform 4-tile KPI grids
// with a kicker + statement number + supporting micro-stat strip. Used by
// BookedRate, FbrLeaderboard, Comebacks to give each ops module a real headline
// moment (massive Fraunces tabular number, journalism-style byline) instead of
// four equal-weight squares.
type Micro = { label: string; value: string; emphasis?: 'cost' | 'mute' };
function OpsHero({ kicker, heroValue, heroLabel, heroAccent, micros, footnote }: { kicker: string; heroValue: string; heroLabel: string; heroAccent?: string; micros: Micro[]; footnote?: React.ReactNode }) {
  const accent = heroAccent || INK;
  return (
    <div className="rounded-[22px] px-7 py-6 mb-5" style={{
      // Concept-1 atmospheric wash — same blue → gold → coral gradient the
      // diagnostic's projection portfolio panel uses. Replaces the prior
      // ivory inset, which read as "box of stats." This wash gives every
      // ops widget a luminous lede that the eye treats as a hero.
      background: 'linear-gradient(160deg, rgba(95,169,214,0.12), rgba(242,206,112,0.10) 55%, rgba(232,134,62,0.12))',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55), 0 1px 0 rgba(255,255,255,0.7) inset, 0 6px 18px -10px rgba(40,34,26,0.18)'
    }}>
      <div className="grid grid-cols-1 md:grid-cols-[1.15fr_1fr] gap-x-8 gap-y-4 items-end">
        <div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: accent }}>{kicker}</div>
          <div className="c2disp tabular-nums leading-none mt-2.5" style={{ color: INK, fontSize: 44, letterSpacing: '-0.025em' }}>{heroValue}</div>
          <div className="c2ui text-[13px] mt-2" style={{ color: INK2 }}>{heroLabel}</div>
        </div>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3 md:justify-end md:border-l md:pl-8" style={{ borderColor: 'rgba(34,32,28,0.08)' }}>
          {micros.map((m) => (
            <div key={m.label} className="flex flex-col">
              <span className="c2disp tabular-nums" style={{ color: m.emphasis === 'cost' ? BAD : INK, fontSize: 22, letterSpacing: '-0.005em' }}>{m.value}</span>
              <span className="c2ui mt-1 text-[12.5px] uppercase tracking-[0.16em]" style={{ color: m.emphasis === 'mute' ? FAINT : INK2 }}>{m.label}</span>
            </div>
          ))}
        </div>
      </div>
      {footnote && <div className="c2ui text-[13px] leading-relaxed mt-4 pt-3" style={{ color: INK2, borderTop: `1px solid rgba(34,32,28,0.08)` }}>{footnote}</div>}
    </div>
  );
}

// Section opener that introduces a chapter (Recognition / Operations) the way a
// magazine prints a department head — eyebrow + Fraunces title + intro line.
function SectionOpener({ kicker, title, sub, accent }: { kicker: string; title: string; sub: string; accent?: string }) {
  const a = accent || AMBER;
  return (
    <div className="mb-6 mt-2">
      <div className="flex items-center gap-3 mb-2">
        <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${a}, transparent)` }} />
        <span className="c2ui text-[12.5px] font-bold uppercase tracking-[0.28em]" style={{ color: a }}>{kicker}</span>
        <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, ${a})` }} />
      </div>
      <h2 className="c2disp leading-tight text-center" style={{ color: INK, fontSize: 30, letterSpacing: '-0.02em' }}>{title}</h2>
      <p className="c2ui text-center text-[12.5px] mt-1.5 max-w-2xl mx-auto" style={{ color: INK2 }}>{sub}</p>
    </div>
  );
}

// ── Call Conversion (Booked Rate) ────────────────────────────────────────────
interface BookedRateShop { shopNum: string; shopName: string; totalCalls: number; eligible: number; booked: number; bookedRatePct: number }
interface BookedRateSnap { windowStart: string; windowEnd: string; computedAt: string; shops: BookedRateShop[]; chain: { eligible: number; booked: number; bookedRatePct: number } }
// ── Trophy Tally — this week ─────────────────────────────────────────────────
// Recognition centerpiece pairing with the Golden Mango: who took 1st/2nd/3rd
// in each weekly category (Revenue, GP%, Top Tech, Most Re-Books, Fewest
// Comebacks, Highest Call Conversion). Reviews stay paused (Google Business
// Profile API access pending) — auto-resumes when fiveStar > 0 returns.
//
// Phase tick: 'awarded' Mon 6 PM → Tue 7:30 AM MT (~13.5h post-ceremony
// celebration window); 'pending' the rest of the week. Polls every 60s so the
// page flips at the boundary without a manual refresh.
type TTCategory = 'revenue' | 'gp' | 'tech' | 'rebook' | 'comebacks' | 'reviews' | 'conversion' | 'todo';
const TT_CATEGORIES: { key: TTCategory; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'gp', label: 'GP%' },
  { key: 'tech', label: 'Top Tech' },
  { key: 'rebook', label: 'Most Re-Books' },
  { key: 'comebacks', label: 'Fewest Comebacks' },
  { key: 'conversion', label: 'Highest Call Conversion' },
  { key: 'todo', label: 'Most To-Do Items Checked Off' },
];
function trophyPhase(now: Date = new Date()): 'pending' | 'awarded' {
  const mt = toZonedTime(now, 'America/Denver');
  const dow = mt.getDay(); const minutes = mt.getHours() * 60 + mt.getMinutes();
  if (dow === 1 && minutes >= 18 * 60) return 'awarded';
  if (dow === 2 && minutes < 7 * 60 + 30) return 'awarded';
  return 'pending';
}
const GOLD_C = '#C9A227', GOLD_SOFT_C = 'rgba(201,162,39,0.28)';
function TrophyTallyWeek() {
  const [metrics, setMetrics] = useState<any[] | null>(null);
  const [techs, setTechs] = useState<any[] | null>(null);
  const [fbr, setFbr] = useState<any[] | null>(null);
  const [comebacks, setComebacks] = useState<any[] | null>(null);
  const [reviews, setReviews] = useState<any[] | null>(null);
  const [conversion, setConversion] = useState<any[] | null>(null);
  const [todoRec, setTodoRec] = useState<any[] | null>(null);
  const [selectedShop, setSelectedShop] = useState<string | null>(null);
  const [phase, setPhase] = useState<'pending' | 'awarded'>(() => trophyPhase());
  useEffect(() => { const id = setInterval(() => setPhase(trophyPhase()), 60_000); return () => clearInterval(id); }, []);
  const isAwarded = phase === 'awarded';
  useEffect(() => {
    safe<any>('/api/metrics?range=this_week').then((d) => { if (d?.kpi?.byShop) setMetrics(d.kpi.byShop.map((s: any) => ({ shopNum: s.shopNum, shopName: s.shopName, revenue: s.revenue, gpPct: s.gpPct }))); });
    safe<any>('/api/tech-production?range=this_week').then((d) => setTechs(d?.rows || []));
    safe<any>('/api/fbr?view=leaderboard_wtd').then((d) => setFbr(d?.shops || []));
    safe<any>('/api/extras?view=comebacks&range=this_week').then((d) => setComebacks(d?.shops || []));
    safe<any>('/api/extras?view=google-ratings').then((d) => setReviews(d?.shops || []));
    safe<any>('/api/extras?view=booked-rate&wtd=1').then((d) => setConversion(d?.shops || []));
    safe<any>('/api/extras?view=todo-recoveries&window=this_week').then((d) => setTodoRec(d?.shops || []));
  }, []);

  const rankings = useMemo(() => {
    const r: Record<TTCategory, string[]> = { revenue: [], gp: [], tech: [], rebook: [], comebacks: [], reviews: [], conversion: [], todo: [] };
    if (metrics) r.revenue = [...metrics].sort((a, b) => b.revenue - a.revenue).map((x) => x.shopNum);
    if (metrics) r.gp = [...metrics].sort((a, b) => b.gpPct - a.gpPct).map((x) => x.shopNum);
    if (techs) r.tech = [...techs].sort((a, b) => b.efficiency - a.efficiency).map((x) => x.shopNum);
    if (fbr) r.rebook = [...fbr].sort((a, b) => (b.fbr?.fbrPct ?? 0) - (a.fbr?.fbrPct ?? 0)).map((x) => x.shopNum);
    if (comebacks) r.comebacks = [...comebacks].sort((a, b) => a.comebackJobs - b.comebackJobs).map((x) => x.shopNum);
    if (reviews && reviews.some((x: any) => (x.fiveStar ?? 0) > 0)) r.reviews = [...reviews].sort((a, b) => b.fiveStar - a.fiveStar).map((x) => x.shopNum);
    if (conversion) r.conversion = [...conversion].sort((a, b) => b.bookedRatePct - a.bookedRatePct).map((x) => x.shopNum);
    // To-Do recoveries — rank by count desc, only counting shops with >0
    // recoveries so a 0/0/0 cohort doesn't back into bronze.
    if (todoRec) r.todo = [...todoRec].filter((x: any) => (x.count ?? 0) > 0).sort((a: any, b: any) => (b.count ?? 0) - (a.count ?? 0)).map((x: any) => x.shopNum);
    return r;
  }, [metrics, techs, fbr, comebacks, reviews, conversion, todoRec]);

  const trophies = useMemo(() => {
    const out: Record<string, { gold: number; silver: number; bronze: number; by: Partial<Record<TTCategory, 1 | 2 | 3>> }> = {};
    for (const s of SHOPS) out[s.num] = { gold: 0, silver: 0, bronze: 0, by: {} };
    for (const cat of TT_CATEGORIES) {
      rankings[cat.key].slice(0, 3).forEach((shopNum, i) => {
        if (!out[shopNum]) return;
        const rank = (i + 1) as 1 | 2 | 3;
        out[shopNum].by[cat.key] = rank;
        if (rank === 1) out[shopNum].gold++; else if (rank === 2) out[shopNum].silver++; else out[shopNum].bronze++;
      });
    }
    return out;
  }, [rankings]);

  const summary = useMemo(() => SHOPS
    .map((s) => ({ shop: s, ...trophies[s.num] }))
    .filter((x) => x.gold + x.silver + x.bronze > 0)
    .sort((a, b) => (b.gold * 100 + b.silver * 10 + b.bronze) - (a.gold * 100 + a.silver * 10 + a.bronze)), [trophies]);

  if (summary.length === 0) return null;

  return (
    <>
      <section className="relative w-full overflow-hidden mb-7" style={{ borderRadius: 26, background: 'linear-gradient(140deg, rgba(255,252,244,0.92), rgba(253,246,231,0.85) 55%, rgba(252,241,220,0.85))', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', boxShadow: `inset 0 0 0 1px ${GOLD_SOFT_C}, 0 18px 48px -28px rgba(124,72,12,0.30)` }}>
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${GOLD_C}, transparent)` }} />
        <div className="relative px-6 sm:px-8 py-7">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-full" style={{ background: 'rgba(201,162,39,0.12)', boxShadow: `inset 0 0 0 1px ${GOLD_SOFT_C}` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GOLD_C} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" /></svg>
            </span>
            <div>
              <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.22em]" style={{ color: GOLD_C }}>{isAwarded ? 'Awarded' : 'Pending'} Trophies · This Week</div>
              <p className="c2ui text-[13px] mt-0.5" style={{ color: INK2 }}>{isAwarded ? 'Trophies for the week are locked in. New week begins Tuesday 7:30 AM MT.' : 'Finishing 1st / 2nd / 3rd in a category earns a 🥇/🥈/🥉 — most trophies leads.'}</p>
            </div>
          </div>
          <p className="c2ui text-[12.5px] mt-1" style={{ color: FAINT }}>Counted this week: {TT_CATEGORIES.map((c) => c.label).join(' · ')} · <span style={{ opacity: 0.7 }}>(5★ Reviews paused — Google Business Profile API access pending)</span></p>

          {/* Top 3 spotlights — #1 is a full-width editorial hero with the
              team photo + big Fraunces shop name + prominent medal stack; #2
              and #3 sit beneath in a 2-up split. Click-through to the
              category-detail modal is preserved for all three. */}
          <div className="mt-5 space-y-4">
            {summary.slice(0, 1).map((s) => {
              const total = s.gold + s.silver + s.bronze;
              const rankColor = '#F5C518';
              return (
                <button key={s.shop.num} onClick={() => setSelectedShop(s.shop.num)} className="group relative w-full cursor-pointer overflow-hidden transition-transform hover:-translate-y-0.5 rounded-2xl text-left" style={isAwarded ? { background: '#FFFFFF', border: `1.5px solid ${rankColor}`, boxShadow: `0 4px 14px rgba(31,41,55,0.06), 0 0 0 4px ${rankColor}1A` } : { background: '#FBFAF7', border: `1.5px dashed ${rankColor}80`, boxShadow: '0 1px 2px rgba(31,41,55,0.04)', filter: 'saturate(0.7)' }}>
                  <div className="absolute inset-0 pointer-events-none" style={{ background: isAwarded ? `${rankColor}1F` : `${rankColor}10` }} />
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                    {isAwarded ? (
                      <><span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[12.5px] font-bold text-white" style={{ background: rankColor }}>✓</span><span className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: rankColor }}>Awarded</span></>
                    ) : (
                      <><span className="tt-spin inline-block w-4 h-4 rounded-full" style={{ border: `2px solid ${rankColor}55`, borderTopColor: rankColor }} /><span className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>Pending</span></>
                    )}
                  </div>
                  <div className="relative grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-6 p-6">
                    <div className="min-w-0">
                      <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em] mb-2.5" style={{ color: rankColor }}>This week's leader · #1</div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="inline-block rounded-full shrink-0" style={{ width: 14, height: 14, background: s.shop.color, boxShadow: `0 0 0 4px ${s.shop.color}22` }} />
                        <div className="c2disp leading-tight" style={{ color: INK, fontSize: 44, letterSpacing: '-0.02em' }}>{s.shop.name}</div>
                      </div>
                      <div className="c2ui text-[12.5px]" style={{ color: INK2 }}>{total} {total === 1 ? 'trophy' : 'trophies'} across this week's categories</div>
                      <div className="mt-5 flex items-end flex-wrap gap-3">
                        {s.gold > 0 && <span className="inline-flex items-center gap-2 c2disp tabular-nums px-4 py-2 rounded-xl shadow-sm" style={{ fontSize: 34, background: 'linear-gradient(180deg, #FEF3C7 0%, #FDE68A 100%)', color: INK }}><TrophyIcon rank={1} size={40} />{s.gold}</span>}
                        {s.silver > 0 && <span className="inline-flex items-center gap-2 c2disp tabular-nums px-3.5 py-2 rounded-xl" style={{ fontSize: 26, background: '#F3F4F6', color: INK }}><TrophyIcon rank={2} size={28} />{s.silver}</span>}
                        {s.bronze > 0 && <span className="inline-flex items-center gap-2 c2disp tabular-nums px-3.5 py-2 rounded-xl" style={{ fontSize: 26, background: '#FBEAD8', color: INK }}><TrophyIcon rank={3} size={28} />{s.bronze}</span>}
                      </div>
                    </div>
                    <div className="relative flex items-center justify-center min-h-[140px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/shop-photos/${encodeURIComponent(`${s.shop.num} team photo.jpg`)}`} alt={`${s.shop.name} team`} className="block w-full h-full object-cover rounded-xl" style={{ aspectRatio: '16/10', maxHeight: 200, boxShadow: `0 0 0 3px ${rankColor}33, 0 12px 24px rgba(124,72,12,0.14)` }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                  </div>
                </button>
              );
            })}
            {summary.length > 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {summary.slice(1, 3).map((s, idx) => {
                  const rank = idx + 1;
                  const total = s.gold + s.silver + s.bronze;
                  const rankColor = rank === 1 ? '#9CA3AF' : '#C2814B';
                  const rankLabel = rank === 1 ? 'Silver · #2' : 'Bronze · #3';
                  return (
                    <button key={s.shop.num} onClick={() => setSelectedShop(s.shop.num)} className="group relative flex flex-col items-stretch gap-3 p-4 rounded-2xl cursor-pointer overflow-hidden transition-transform hover:-translate-y-0.5 text-left" style={isAwarded ? { background: '#FFFFFF', border: `1.5px solid ${rankColor}`, boxShadow: `0 2px 6px rgba(31,41,55,0.05), 0 0 0 3px ${rankColor}1A` } : { background: '#FBFAF7', border: `1.5px dashed ${rankColor}80`, boxShadow: '0 1px 2px rgba(31,41,55,0.04)', filter: 'saturate(0.7)' }}>
                      <div className="absolute inset-0 pointer-events-none rounded-2xl" style={{ background: isAwarded ? `${rankColor}22` : `${rankColor}14` }} />
                      <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10">
                        {isAwarded ? (
                          <><span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[13px] font-bold text-white" style={{ background: rankColor }}>✓</span><span className="c2ui text-[13px] font-semibold uppercase tracking-[0.12em]" style={{ color: rankColor }}>Awarded</span></>
                        ) : (
                          <><span className="tt-spin inline-block w-3.5 h-3.5 rounded-full" style={{ border: `2px solid ${rankColor}55`, borderTopColor: rankColor }} /><span className="c2ui text-[13px] font-semibold uppercase tracking-[0.12em]" style={{ color: FAINT }}>Pending</span></>
                        )}
                      </div>
                      <div className="relative">
                        <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em] mb-1.5" style={{ color: rankColor }}>{rankLabel}</div>
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-3 h-3 rounded-full ring-2 ring-white shrink-0" style={{ background: s.shop.color }} />
                          <div className="c2disp leading-tight truncate" style={{ color: INK, fontSize: 19, letterSpacing: '-0.01em' }}>{s.shop.name}</div>
                        </div>
                        <div className="c2ui text-[12.5px] uppercase tracking-wide mt-0.5" style={{ color: INK2 }}>{total} {total === 1 ? 'trophy' : 'trophies'}</div>
                      </div>
                      <div className="relative flex items-center gap-2 flex-wrap">
                        {s.gold > 0 && <span className="inline-flex items-center gap-1 c2disp tabular-nums px-3 py-1.5 rounded-lg shadow-sm" style={{ fontSize: 22, background: 'linear-gradient(180deg, #FEF3C7 0%, #FDE68A 100%)', color: INK }}><TrophyIcon rank={1} size={26} />{s.gold}</span>}
                        {s.silver > 0 && <span className="inline-flex items-center gap-1 c2disp tabular-nums px-2.5 py-1.5 rounded-lg" style={{ fontSize: 18, background: '#F3F4F6', color: INK }}><TrophyIcon rank={2} size={20} />{s.silver}</span>}
                        {s.bronze > 0 && <span className="inline-flex items-center gap-1 c2disp tabular-nums px-2.5 py-1.5 rounded-lg" style={{ fontSize: 18, background: '#FBEAD8', color: INK }}><TrophyIcon rank={3} size={20} />{s.bronze}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Honorable mentions */}
          {summary.length > 3 && (
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${GOLD_SOFT_C}` }}>
              <div className="c2ui text-[12.5px] uppercase tracking-wide font-semibold mb-2" style={{ color: FAINT }}>Honorable mentions</div>
              <div className="flex flex-wrap gap-2">
                {summary.slice(3).map((s) => (
                  <button key={s.shop.num} onClick={() => setSelectedShop(s.shop.num)} className="c2ui inline-flex items-center gap-2 px-3 py-1.5 rounded-full transition" style={{ background: 'rgba(255,255,255,0.7)', border: `1px solid ${LINE}` }}>
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: s.shop.color }} />
                    <span className="font-medium text-[12.5px]" style={{ color: INK }}>{s.shop.name}</span>
                    <span className="inline-flex items-center gap-1 text-[12.5px]" style={{ color: INK2 }}>
                      {s.gold > 0 && <><TrophyIcon rank={1} size={12} />{s.gold}</>}
                      {s.silver > 0 && <><TrophyIcon rank={2} size={12} />{s.silver}</>}
                      {s.bronze > 0 && <><TrophyIcon rank={3} size={12} />{s.bronze}</>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="c2ui text-[12.5px] mt-5 pt-3" style={{ borderTop: `1px solid ${GOLD_SOFT_C}`, color: FAINT }}>Board order uses a weighted score: gold = 100, silver = 10, bronze = 1. Click any shop to see exactly which categories it placed in. "Most 5★ Reviews" is paused while Google Business Profile API access is pending and returns automatically once review totals are available.</p>
          <style jsx>{`
            .tt-spin { animation: tt-spin 0.9s linear infinite; }
            @keyframes tt-spin { to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) { .tt-spin { animation: none; } }
          `}</style>
        </div>
      </section>

      {selectedShop && (() => {
        const s = summary.find((x) => x.shop.num === selectedShop);
        if (!s) return null;
        const items = (Object.entries(s.by) as [TTCategory, 1 | 2 | 3][]).map(([cat, rank]) => ({ cat, rank })).sort((a, b) => a.rank - b.rank);
        return (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(34,32,28,0.40)' }} onClick={() => setSelectedShop(null)}>
            <div className="rounded-[26px] p-6 max-w-md w-full" style={{ background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(20px)', boxShadow: '0 24px 60px -20px rgba(40,34,26,0.4)' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="inline-block w-4 h-4 rounded-full" style={{ background: s.shop.color, boxShadow: '0 0 0 3px rgba(34,32,28,0.06)' }} />
                  <div>
                    <div className="c2disp" style={{ color: INK, fontSize: 22, letterSpacing: '-0.01em' }}>{s.shop.name}</div>
                    <div className="c2ui text-[12.5px]" style={{ color: FAINT }}>{isAwarded ? 'Awarded this week' : 'Pending trophies this week'}</div>
                  </div>
                </div>
                <button onClick={() => setSelectedShop(null)} className="c2ui text-[24px] leading-none" style={{ color: INK2 }}>×</button>
              </div>
              <div className="space-y-2">
                {items.map(({ cat, rank }) => {
                  const label = TT_CATEGORIES.find((c) => c.key === cat)?.label || cat;
                  const rankLabel = rank === 1 ? '#1 — Gold' : rank === 2 ? '#2 — Silver' : '#3 — Bronze';
                  return (
                    <div key={cat} className="flex items-center gap-3 p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}>
                      <TrophyIcon rank={rank} size={28} />
                      <div className="flex-1"><div className="c2ui font-semibold text-[13px]" style={{ color: INK }}>{label}</div><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>{rankLabel}</div></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

// ── Trophy Tally — Quarter (YTD-style accumulation) ─────────────────────────
// Per-shop gold/silver/bronze trophies banked since the start of the calendar
// quarter. Revenue + GP% accumulate across completed weeks (via the trophy-
// history backfill) plus this week's in-progress snapshot; the other 5
// categories (Top Tech / Re-Books / Comebacks / Reviews / Conversion) only
// count this week's snapshot — same approximation as production since those
// upstream APIs don't backfill. Tally-mark visualization preserved.
const QCATS: { key: TTCategory; label: string }[] = [
  { key: 'revenue', label: 'Revenue' }, { key: 'gp', label: 'GP%' }, { key: 'tech', label: 'Top Tech' },
  { key: 'rebook', label: 'Most Re-Books' }, { key: 'comebacks', label: 'Fewest Comebacks' },
  { key: 'reviews', label: 'Most New 5★ Reviews' }, { key: 'conversion', label: 'Highest Call Conversion' },
  { key: 'todo', label: 'Most To-Do Items Checked Off' },
];
function currentQuarter(now: Date) {
  const y = now.getUTCFullYear();
  const qIdx = Math.floor(now.getUTCMonth() / 3);
  return { year: y, qIdx, label: `Q${qIdx + 1}`, startDate: `${y}-${String(qIdx * 3 + 1).padStart(2, '0')}-01` };
}
function TallyMarks({ count, color }: { count: number; color: string }) {
  if (count === 0) return <svg width="34" height="10" viewBox="0 0 34 10" className="opacity-50"><path d="M1 5 Q5 1 9 5 T17 5 T25 5 T33 5" fill="none" stroke="#cbd0d6" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  if (count > 40) return <span className="c2disp tabular-nums" style={{ color, fontWeight: 700 }}>{count}</span>;
  const fives = Math.floor(count / 5), rem = count % 5;
  return (
    <span className="inline-flex items-center gap-1.5 leading-none" title={String(count)}>
      {Array.from({ length: fives }).map((_, k) => (
        <svg key={k} width="26" height="20" viewBox="0 0 26 20" className="shrink-0" aria-hidden>
          {[3, 8, 13, 18].map((x, i) => <line key={i} x1={x} y1="2" x2={x} y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />)}
          <line x1="0" y1="18" x2="24" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      ))}
      {rem > 0 && (
        <svg width={rem * 5 + 2} height="20" viewBox={`0 0 ${rem * 5 + 2} 20`} className="shrink-0" aria-hidden>
          {Array.from({ length: rem }).map((_, i) => <line key={i} x1={3 + i * 5} y1="2" x2={3 + i * 5} y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />)}
        </svg>
      )}
    </span>
  );
}
export function TrophyTallyQuarter() {
  const [techs, setTechs] = useState<any[] | null>(null);
  const [fbr, setFbr] = useState<any[] | null>(null);
  const [comebacks, setComebacks] = useState<any[] | null>(null);
  const [reviews, setReviews] = useState<any[] | null>(null);
  const [conversion, setConversion] = useState<any[] | null>(null);
  const [todoRecQ, setTodoRecQ] = useState<any[] | null>(null);
  const [liveKpi, setLiveKpi] = useState<Array<{ shopNum: string; revenue: number; gpPct: number }>>([]);
  const q = useMemo(() => currentQuarter(new Date()), []);
  useEffect(() => {
    safe<any>('/api/tech-production?range=last_7_days').then((d) => setTechs(d?.rows || []));
    safe<any>('/api/fbr?view=leaderboard').then((d) => setFbr(d?.shops || []));
    safe<any>('/api/extras?view=comebacks&range=last_7_days').then((d) => setComebacks(d?.shops || []));
    safe<any>('/api/extras?view=google-ratings').then((d) => setReviews(d?.shops || []));
    safe<any>('/api/extras?view=booked-rate&strict=1').then((d) => setConversion(d?.shops || []));
    safe<any>('/api/extras?view=todo-recoveries&window=this_week').then((d) => setTodoRecQ(d?.shops || []));
    safe<any>('/api/metrics?range=last_7_days').then((d) => { const lk: Array<{ shopNum: string; revenue: number; gpPct: number }> = []; for (const s of (d?.kpi?.byShop || [])) lk.push({ shopNum: s.shopNum, revenue: s.revenue, gpPct: s.gpPct }); setLiveKpi(lk); });
  }, []);
  const tallies = useMemo(() => {
    const out: Record<string, { gold: number; silver: number; bronze: number; perCategory: Record<TTCategory, { g: number; s: number; b: number }> }> = {};
    for (const s of SHOPS) out[s.num] = { gold: 0, silver: 0, bronze: 0, perCategory: { revenue: { g: 0, s: 0, b: 0 }, gp: { g: 0, s: 0, b: 0 }, tech: { g: 0, s: 0, b: 0 }, rebook: { g: 0, s: 0, b: 0 }, comebacks: { g: 0, s: 0, b: 0 }, reviews: { g: 0, s: 0, b: 0 }, conversion: { g: 0, s: 0, b: 0 }, todo: { g: 0, s: 0, b: 0 } } };
    function award(cat: TTCategory, ranking: string[]) {
      ranking.slice(0, 3).forEach((shopNum, i) => {
        if (!out[shopNum]) return;
        const slot: 'g' | 's' | 'b' = i === 0 ? 'g' : i === 1 ? 's' : 'b';
        out[shopNum].perCategory[cat][slot]++;
        if (slot === 'g') out[shopNum].gold++; else if (slot === 's') out[shopNum].silver++; else out[shopNum].bronze++;
      });
    }
    for (const hw of historyWeeksSince(q.startDate)) {
      award('revenue', hw.rankings.revenue); award('gp', hw.rankings.gp);
      award('tech', hw.rankings.tech); award('comebacks', hw.rankings.comebacks);
    }
    if (liveKpi.length) {
      award('revenue', [...liveKpi].sort((a, b) => b.revenue - a.revenue).map((x) => x.shopNum));
      award('gp', [...liveKpi].sort((a, b) => b.gpPct - a.gpPct).map((x) => x.shopNum));
    }
    if (techs) award('tech', [...techs].sort((a, b) => b.efficiency - a.efficiency).map((x) => x.shopNum));
    if (fbr) award('rebook', [...fbr].sort((a, b) => (b.fbr?.fbrPct ?? 0) - (a.fbr?.fbrPct ?? 0)).map((x) => x.shopNum));
    if (comebacks) award('comebacks', [...comebacks].sort((a, b) => a.comebackJobs - b.comebackJobs).map((x) => x.shopNum));
    if (reviews && reviews.some((x: any) => (x.fiveStar ?? 0) > 0)) award('reviews', [...reviews].sort((a, b) => b.fiveStar - a.fiveStar).map((x) => x.shopNum));
    if (conversion) award('conversion', [...conversion].sort((a, b) => b.bookedRatePct - a.bookedRatePct).map((x) => x.shopNum));
    // To-Do recoveries — only this week's snapshot contributes (no
    // backfill history yet). Same approximation as the other live-only cats.
    if (todoRecQ) award('todo', [...todoRecQ].filter((x: any) => (x.count ?? 0) > 0).sort((a: any, b: any) => (b.count ?? 0) - (a.count ?? 0)).map((x: any) => x.shopNum));
    return out;
  }, [liveKpi, techs, fbr, comebacks, reviews, conversion, todoRecQ, q.startDate]);
  function topCategories(t: typeof tallies[string]): string {
    const sorted = (Object.entries(t.perCategory) as [TTCategory, any][]).map(([cat, p]) => ({ cat, weight: p.g * 3 + p.s * 2 + p.b })).filter((x) => x.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 2);
    if (sorted.length === 0) return '—';
    return sorted.map((x) => QCATS.find((c) => c.key === x.cat)?.label || x.cat).join(', ');
  }
  const grandTotal = SHOPS.reduce((sum, s) => sum + tallies[s.num].gold + tallies[s.num].silver + tallies[s.num].bronze, 0);
  return (
    <div className="rounded-[26px] border mb-7" style={frostCard()}>
      <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>{q.label} {q.year} · Quarter to date</div>
            <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>Past Trophies Earned this Quarter</h2>
            <p className="c2ui text-[13px] mt-1" style={{ color: INK2 }}>Every trophy each shop has banked since {q.startDate}. The shop with the most leads the quarter.</p>
          </div>
        </div>
        <p className="c2ui text-[12.5px] mt-2" style={{ color: FAINT }}>{QCATS.map((c) => c.label).join(' · ')}</p>
      </div>
      <div className="px-6 py-5">
        {grandTotal === 0 ? (
          <div className="c2ui text-[13px] py-8 text-center" style={{ color: INK2 }}>The quarter is just starting — trophies will appear here after the first week closes.</div>
        ) : (() => {
          // Concept-1 rebuild: replace the table with a heat-tinted shop-tile
          // grid. The card surface is the quarter's standing — a shop with
          // the most trophies banked reads cool blue, a shop with few/none
          // reads coral. Tally marks for each medal type still render
          // inside, but inside a real composition instead of a table cell.
          const maxTotal = Math.max(1, ...SHOPS.map(x => tallies[x.num].gold + tallies[x.num].silver + tallies[x.num].bronze));
          const ordered = [...SHOPS].sort((a, b) => {
            const ta = tallies[a.num], tb = tallies[b.num];
            return (tb.gold * 100 + tb.silver * 10 + tb.bronze) - (ta.gold * 100 + ta.silver * 10 + ta.bronze);
          });
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {ordered.map((s) => {
                const t = tallies[s.num];
                const total = t.gold + t.silver + t.bronze;
                // Score: 1.0 = leads the quarter; 0.0 = no trophies banked.
                // Below-median shops read coral, above-median read cool.
                const score = norm(total / maxTotal, 0.15, 0.95);
                const [tr, tg, tb] = heatRGB(score);
                const tops = topCategories(t);
                return (
                  <div key={s.num} className="rounded-2xl p-5 overflow-hidden" style={{
                    background: `radial-gradient(135% 160% at 28% -10%, rgba(${tr},${tg},${tb},0.32), rgba(${tr},${tg},${tb},0.10) 70%, rgba(${tr},${tg},${tb},0.05))`,
                    boxShadow: `inset 0 0 0 1px rgba(${tr},${tg},${tb},0.28), 0 1px 0 rgba(255,255,255,0.6) inset`,
                  }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: s.color, boxShadow: `0 0 0 3px ${s.color}22` }} />
                      <div className="c2disp leading-tight" style={{ color: INK, fontSize: 18, letterSpacing: '-0.015em' }}>{s.name}</div>
                      <span className="ml-auto c2disp tabular-nums" style={{ color: INK, fontSize: 22, letterSpacing: '-0.015em' }}>{total}</span>
                    </div>
                    <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em] mb-3" style={{ color: INK2 }}>{total === 1 ? 'trophy' : 'trophies'} this quarter</div>
                    {/* Tally rows — each medal type on its own line so the
                        visual rhythm matches the per-shop card composition
                        in concept-1, not a table-cell. */}
                    <div className="space-y-2.5 pt-3" style={{ borderTop: '1px solid rgba(34,32,28,0.10)' }}>
                      <div className="flex items-center gap-3 min-h-[24px]">
                        <span className="inline-flex items-center gap-1 c2ui text-[12.5px] uppercase tracking-[0.14em] font-bold w-14 shrink-0" style={{ color: '#9F7E14' }}><TrophyIcon rank={1} size={14} /> Gold</span>
                        <TallyMarks count={t.gold} color="#C9A227" />
                      </div>
                      <div className="flex items-center gap-3 min-h-[24px]">
                        <span className="inline-flex items-center gap-1 c2ui text-[12.5px] uppercase tracking-[0.14em] font-bold w-14 shrink-0" style={{ color: '#737880' }}><TrophyIcon rank={2} size={14} /> Silver</span>
                        <TallyMarks count={t.silver} color="#9CA3AF" />
                      </div>
                      <div className="flex items-center gap-3 min-h-[24px]">
                        <span className="inline-flex items-center gap-1 c2ui text-[12.5px] uppercase tracking-[0.14em] font-bold w-14 shrink-0" style={{ color: '#8E5D3F' }}><TrophyIcon rank={3} size={14} /> Bronze</span>
                        <TallyMarks count={t.bronze} color="#B97A56" />
                      </div>
                    </div>
                    {tops !== '—' && total > 0 && (
                      <div className="mt-4 pt-3 c2ui text-[13px]" style={{ color: INK2, borderTop: '1px solid rgba(34,32,28,0.10)' }}>
                        <span className="font-semibold uppercase tracking-[0.14em] text-[12.5px]" style={{ color: INK2 }}>Often trophies in</span>
                        <div className="mt-1" style={{ color: INK }}>{tops}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Highest Leverage — by Shop ───────────────────────────────────────────────
// Per-shop card surfacing the seven UPSTREAM levers (Calls · Conversion · AWRO
// · Close Rate · Parts GP · Labor GP · Return Customers) vs the chain median
// THIS WEEK (Mon → today MT). Same lever set + median logic as production —
// Car Count + ARO excluded (downstream). Below median → action item card,
// at-or-above → faded "holding strong" footer.
interface LiveKpi { shopNum: string; awro: number; closeRate: number; partsGpPct: number; laborGpPct: number; cars: number }
// Sample-size guards — same thresholds as production HighestLeverageByShop.
// 0% with 0 calls or 0 closed ROs isn't an action item, it's an absence of
// data. Surface as "Need more calls/tickets" instead of fake-zero "weak".
const HL_MIN_CALLS = 5;
const HL_MIN_TICKETS = 3;
type HLPendingReason = 'no-calls' | 'no-tickets' | 'awaiting' | null;
// Exact-zero parts/labor GP means the substrate is missing (no parts sold,
// not invoiced, etc.) — real shops always have SOME margin. Suppress as
// pending so we don't shame a shop for incomplete data.
function isHLPhantomGp(v: number | null | undefined): boolean {
  return v === 0 || v == null;
}
function HighestLeverage() {
  const [conversion, setConversion] = useState<any[] | null>(null);
  const [returnCustomers, setReturnCustomers] = useState<any[] | null>(null);
  const [liveKpi, setLiveKpi] = useState<LiveKpi[]>([]);
  useEffect(() => {
    safe<any>('/api/extras?view=booked-rate&wtd=1').then((d) => {
      const rows = (d?.shops || []).map((s: any) => ({ ...s, bookedRatePct: typeof s.bookedRatePct === 'number' ? s.bookedRatePct / 100 : 0 }));
      setConversion(rows);
    });
    safe<any>('/api/extras?view=return-customers').then((d) => setReturnCustomers(d?.shops || []));
    safe<any>('/api/metrics?range=this_week').then((d) => {
      const lk: LiveKpi[] = [];
      for (const s of (d?.kpi?.byShop || [])) lk.push({ shopNum: s.shopNum, awro: s.awro ?? 0, closeRate: s.closeRate ?? 0, partsGpPct: s.partsGpPct ?? 0, laborGpPct: s.laborGpPct ?? 0, cars: s.cars ?? 0 });
      setLiveKpi(lk);
    });
  }, []);
  const medianValues = useMemo(() => {
    const med = (arr: number[]) => { const xs = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!xs.length) return 0; const m = Math.floor(xs.length / 2); return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; };
    const conv = (conversion || []) as any[];
    // Only include shops with enough calls/tickets in the median — otherwise
    // shops with no data drag the floor toward 0 and everyone looks weak.
    const convQ = conv.filter((x: any) => (x.eligible ?? 0) >= HL_MIN_CALLS);
    const liveQ = liveKpi.filter((x) => x.cars >= HL_MIN_TICKETS);
    // Phantom-zero filters for the value-bearing metrics — exclude shops
    // whose substrate is missing so the median floor reflects real data.
    const liveQAwro = liveQ.filter((x) => !isHLPhantomGp(x.awro));
    const liveQParts = liveQ.filter((x) => !isHLPhantomGp(x.partsGpPct));
    const liveQLabor = liveQ.filter((x) => !isHLPhantomGp(x.laborGpPct));
    const rc = (returnCustomers || []).filter((x: any) => !x.pending && typeof x.returnWtdPct === 'number');
    return {
      calls: med(conv.map((x: any) => x.eligible ?? 0)),
      conversion: med(convQ.map((x: any) => x.bookedRatePct ?? 0)),
      awro: med(liveQAwro.map((x) => x.awro)),
      closeRate: med(liveQ.map((x) => x.closeRate)),
      partsGp: med(liveQParts.map((x) => x.partsGpPct)),
      laborGp: med(liveQLabor.map((x) => x.laborGpPct)),
      ret: med(rc.map((x: any) => x.returnWtdPct ?? 0)),
    };
  }, [conversion, liveKpi, returnCustomers]);
  const fmtMed = (key: string, v: number) => { if (key === 'awro') return usd(v); if (key === 'calls') return numFmt(v); return pctR(v, 0); };
  function leavesFor(shopNum: string) {
    const live = liveKpi.find((x) => x.shopNum === shopNum);
    const conv = ((conversion || []) as any[]).find((x: any) => x.shopNum === shopNum);
    const rc = (returnCustomers || []).find((x: any) => x.shopNum === shopNum);
    const rcReady = rc && !rc.pending && typeof rc.returnWtdPct === 'number';
    const eligibleCalls = conv?.eligible ?? null;
    const cars = live?.cars ?? null;
    const callsPending: HLPendingReason = eligibleCalls === null || eligibleCalls < HL_MIN_CALLS ? 'no-calls' : null;
    const ticketsPending: HLPendingReason = cars === null || cars < HL_MIN_TICKETS ? 'no-tickets' : null;
    return [
      { key: 'calls', label: 'Calls', value: conv?.eligible ?? null, display: conv ? numFmt(conv.eligible ?? 0) : '—', med: medianValues.calls, pending: (eligibleCalls === null || eligibleCalls === 0) ? 'no-calls' as HLPendingReason : null },
      { key: 'conversion', label: 'Call Conversion', value: conv?.bookedRatePct ?? null, display: callsPending ? '—' : (conv ? pctR(conv.bookedRatePct ?? 0, 0) : '—'), med: medianValues.conversion, pending: callsPending },
      { key: 'awro', label: 'AWRO', value: live?.awro ?? null, display: ticketsPending || isHLPhantomGp(live?.awro) ? '—' : usd(live!.awro), med: medianValues.awro, pending: ticketsPending || isHLPhantomGp(live?.awro) ? (ticketsPending ?? 'no-tickets') : null },
      { key: 'closeRate', label: 'Close Rate', value: live?.closeRate ?? null, display: ticketsPending ? '—' : (live ? pctR(live.closeRate) : '—'), med: medianValues.closeRate, pending: ticketsPending },
      { key: 'partsGp', label: 'Parts GP', value: live?.partsGpPct ?? null, display: ticketsPending || isHLPhantomGp(live?.partsGpPct) ? '—' : pctR(live!.partsGpPct), med: medianValues.partsGp, pending: ticketsPending || isHLPhantomGp(live?.partsGpPct) ? (ticketsPending ?? 'no-tickets') : null },
      { key: 'laborGp', label: 'Labor GP', value: live?.laborGpPct ?? null, display: ticketsPending || isHLPhantomGp(live?.laborGpPct) ? '—' : pctR(live!.laborGpPct), med: medianValues.laborGp, pending: ticketsPending || isHLPhantomGp(live?.laborGpPct) ? (ticketsPending ?? 'no-tickets') : null },
      { key: 'returnCust', label: 'Return Customers', value: rcReady ? rc.returnWtdPct : null, display: rcReady ? pctR(rc.returnWtdPct) : '—', med: medianValues.ret, pending: rcReady ? null : 'awaiting' as HLPendingReason },
    ] as Array<{ key: string; label: string; value: number | null; display: string; med: number; pending: HLPendingReason }>;
  }
  return (
    <div className="rounded-[26px] border mb-7" style={frostCard()}>
      <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Where to focus this week</div>
            <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>Highest Leverage — by Shop</h2>
          </div>
          <div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Below company median = action item · At or above = holding strong</div>
        </div>
        <p className="c2ui text-[13px] mt-2" style={{ color: INK2 }}>Week-to-date (Mon → today MT). Seven upstream levers — Car Count + ARO are excluded because they're downstream (Car Count is driven by call conversion + prior re-books; ARO = AWRO × close rate). WTD across the board means below the median = behind the company at the same point in the week.</p>
      </div>
      {/* Chain-wide "biggest leak" hero — counts, across all 8 shops × 7
          levers, where the chain is hemorrhaging the most. Lever with the
          most shops below the company median wins the lede; the next two are
          callouts. Gives the page a journalistic answer to "where do we focus
          this week?" before diving into per-shop detail. */}
      {(() => {
        const allLeavers = SHOPS.map((s) => leavesFor(s.num));
        const labels: Record<string, string> = { calls: 'Calls', conversion: 'Call Conversion', awro: 'AWRO', closeRate: 'Close Rate', partsGp: 'Parts GP', laborGp: 'Labor GP', returnCust: 'Return Customers' };
        const tally: Record<string, { weak: number; shops: string[] }> = {};
        for (const leaves of allLeavers) {
          for (const L of leaves) {
            // Sample-size pending skips the tally entirely — a 0% from a
            // shop with 0 calls/tickets isn't a "shop below median"; it's
            // an absence of data. Including it would inflate the chain
            // biggest-leak count with phantom failures.
            if (L.pending) continue;
            const has = L.value !== null && Number.isFinite(L.value as number);
            if (!has || L.med <= 0) continue;
            if ((L.value as number) < L.med) {
              tally[L.key] = tally[L.key] || { weak: 0, shops: [] };
              tally[L.key].weak++;
              tally[L.key].shops.push((allLeavers.indexOf(leaves) >= 0 ? SHOPS[allLeavers.indexOf(leaves)].name : ''));
            }
          }
        }
        const ranked = Object.entries(tally).map(([key, v]) => ({ key, label: labels[key] || key, ...v })).sort((a, b) => b.weak - a.weak);
        // Total measurable cells = sum of per-shop leaves where data is
        // available. Hardcoding 8×7 = 56 implies every cell is measurable;
        // a pending-heavy week would read "8 of 56" when it's really "8 of 14".
        const totalCells = allLeavers.reduce((sum, ls) => sum + ls.filter((L) => !L.pending).length, 0);
        const totalWeak = ranked.reduce((s, x) => s + x.weak, 0);
        if (ranked.length === 0) {
          return (
            <div className="px-6 pt-5">
              <div className="rounded-[22px] px-7 py-6 c2ui text-[13px]" style={{
                background: 'linear-gradient(160deg, rgba(122,192,230,0.14), rgba(193,214,142,0.14) 55%, rgba(139,205,197,0.14))',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55)',
                color: GOOD
              }}>
                Every shop holds at or above the company median on every lever this week. Nothing to fix.
              </div>
            </div>
          );
        }
        const top = ranked[0];
        const rest = ranked.slice(1, 3);
        return (
          <div className="px-6 pt-5">
            <div className="rounded-[22px] px-7 py-6" style={{
          // Concept-1 atmospheric wash on the chain-MTD hero strip — same
          // gradient as OpsHero so the page reads as a coherent visual
          // system. The chain revenue Fraunces number floats on the luminous
          // surface instead of a plain ivory box.
          background: 'linear-gradient(160deg, rgba(95,169,214,0.12), rgba(242,206,112,0.10) 55%, rgba(232,134,62,0.12))',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55), 0 1px 0 rgba(255,255,255,0.7) inset, 0 6px 18px -10px rgba(40,34,26,0.18)'
        }}>
              <div className="grid grid-cols-1 md:grid-cols-[1.15fr_1fr] gap-x-8 gap-y-4 items-end">
                <div>
                  <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: BAD }}>Biggest leak across the chain</div>
                  <div className="c2disp leading-none mt-2.5" style={{ color: INK, fontSize: 30, letterSpacing: '-0.025em' }}>{top.label}</div>
                  <div className="c2ui text-[12.5px] mt-2" style={{ color: INK2 }}>
                    <span className="c2disp tabular-nums font-bold" style={{ color: BAD }}>{top.weak} of 8 shops</span> below the company median this week
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-x-8 gap-y-3 md:justify-end md:border-l md:pl-8" style={{ borderColor: 'rgba(34,32,28,0.08)' }}>
                  {rest.map((r) => (
                    <div key={r.key} className="flex flex-col">
                      <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 22, letterSpacing: '-0.005em' }}>{r.weak} of 8</span>
                      <span className="c2ui mt-1 text-[12.5px] uppercase tracking-[0.16em]" style={{ color: INK2 }}>{r.label}</span>
                    </div>
                  ))}
                  <div className="flex flex-col">
                    <span className="c2disp tabular-nums" style={{ color: FAINT, fontSize: 22, letterSpacing: '-0.005em' }}>{totalWeak}<span className="c2ui text-[13px] ml-1" style={{ color: FAINT }}>/ {totalCells}</span></span>
                    <span className="c2ui mt-1 text-[12.5px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>Total cells below median</span>
                  </div>
                </div>
              </div>
              <p className="c2ui text-[13px] mt-4 pt-3" style={{ color: INK2, borderTop: '1px solid rgba(34,32,28,0.08)' }}>The lever with the most shops below the company median this week is the highest-leverage thing to coach against. Per-shop breakdown follows below — each shop's action items are surfaced individually so a manager can take it to their crew.</p>
            </div>
          </div>
        );
      })()}
      <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {SHOPS.map((s) => {
          const leaves = leavesFor(s.num);
          const classify = (L: typeof leaves[number]) => {
            // Pending always wins — see HighestLeverageByShop for rationale.
            if (L.pending) return 'unknown' as const;
            const has = L.value !== null && Number.isFinite(L.value as number);
            if (!has || L.med <= 0) return 'unknown' as const;
            return (L.value as number) >= L.med ? 'strong' as const : 'weak' as const;
          };
          const weak = leaves.filter((L) => classify(L) === 'weak');
          const strong = leaves.filter((L) => classify(L) === 'strong');
          const unknown = leaves.filter((L) => classify(L) === 'unknown');
          const pendNoCalls = unknown.filter((L) => L.pending === 'no-calls');
          const pendNoTickets = unknown.filter((L) => L.pending === 'no-tickets');
          const pendAwaiting = unknown.filter((L) => L.pending === 'awaiting' || L.pending == null);
          const measured = weak.length + strong.length;
          const score = measured > 0 ? strong.length / measured : 0.5;
          const [lr, lg, lb] = heatRGB(score);
          return (
            <div key={s.num} className="rounded-2xl p-4 overflow-hidden" style={{
              // Concept-1 heat-tinted shop card: cool blue when all measured
              // levers are at-or-above the company median, coral when most
              // are below. The atmosphere tells you at a glance which shops
              // need coaching before you read the action items. Action items
              // sit on white-translucent panels so they stay legible.
              background: `radial-gradient(135% 160% at 28% -10%, rgba(${lr},${lg},${lb},0.32), rgba(${lr},${lg},${lb},0.10) 70%, rgba(${lr},${lg},${lb},0.05))`,
              boxShadow: `inset 0 0 0 1px rgba(${lr},${lg},${lb},0.28), 0 1px 0 rgba(255,255,255,0.6) inset`,
            }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: s.color, boxShadow: `0 0 0 3px ${s.color}22` }} />
                <div className="c2disp" style={{ color: INK, fontSize: 16, letterSpacing: '-0.01em' }}>{s.name}</div>
                {measured > 0 && (
                  <span className="ml-auto c2ui text-[12.5px] font-bold tabular-nums px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.55)', color: INK2 }}>{strong.length}/{measured} strong</span>
                )}
              </div>
              {weak.length > 0 ? (
                <div className="space-y-1.5">
                  {weak.map((L) => (
                    <div key={L.key} className="flex items-center gap-3 rounded-xl px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.62)', boxShadow: 'inset 0 0 0 1px rgba(232,134,62,0.35)' }}>
                      <div className="min-w-0 flex-1">
                        <div className="c2ui text-[12.5px] uppercase tracking-wide font-semibold leading-tight" style={{ color: '#8E3F22' }}>{L.label}</div>
                        <div className="c2disp tabular-nums leading-tight" style={{ color: INK, fontSize: 17 }}>{L.display}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="c2ui text-[13px] uppercase leading-none font-semibold" style={{ color: INK2 }}>median</div>
                        <div className="c2ui text-[13px] font-medium tabular-nums" style={{ color: INK2 }}>{fmtMed(L.key, L.med)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="c2ui text-[12.5px] font-semibold px-1 py-2" style={{ color: INK }}>All levers at or above company median ✓</div>
              )}
              {strong.length > 0 && weak.length > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(34,32,28,0.10)' }}>
                  <div className="c2ui text-[12.5px] uppercase tracking-wide mb-1.5 font-semibold" style={{ color: INK2 }}>Holding strong</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {strong.map((L) => <span key={L.key} className="c2ui inline-flex items-center gap-1 text-[12.5px]" style={{ color: INK2 }}>{L.label} <span className="tabular-nums font-semibold" style={{ color: INK }}>{L.display}</span></span>)}
                  </div>
                </div>
              )}
              {unknown.length > 0 && (
                <div className="mt-2 c2ui text-[12.5px] italic space-y-0.5" style={{ color: INK2 }}>
                  {pendNoCalls.length > 0 && <div>Need more calls: {pendNoCalls.map((L) => L.label).join(', ')}</div>}
                  {pendNoTickets.length > 0 && <div>Need more tickets closed: {pendNoTickets.map((L) => L.label).join(', ')}</div>}
                  {pendAwaiting.length > 0 && <div>Awaiting data: {pendAwaiting.map((L) => L.label).join(', ')}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BookedRate() {
  const [snap, setSnap] = useState<BookedRateSnap | null>(null);
  const [aroByShop, setAroByShop] = useState<Record<string, number>>({});
  const [win, setWin] = useState<'rolling' | 'this_week'>('this_week');
  const [openShop, setOpenShop] = useState<string | null>(null);
  useEffect(() => {
    setSnap(null);
    const callsUrl = win === 'this_week' ? '/api/extras?view=booked-rate&wtd=1' : '/api/extras?view=booked-rate&strict=1';
    const aroRange = win === 'this_week' ? 'this_week' : 'last_7_days';
    let cancelled = false;
    safe<BookedRateSnap>(callsUrl).then((j) => { if (!cancelled && j) setSnap(j); });
    safe<any>(`/api/metrics?range=${aroRange}`).then((d) => { if (cancelled) return; const map: Record<string, number> = {}; for (const s of (d?.kpi?.byShop || [])) map[s.shopNum] = s.aro; setAroByShop(map); });
    const t = setInterval(() => safe<BookedRateSnap>(callsUrl).then((j) => { if (!cancelled && j) setSnap(j); }), 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [win]);
  if (!snap) return <div className="rounded-[26px] mb-4" style={{ height: 360, background: 'rgba(255,255,255,0.5)', border: `1px solid ${LINE}` }} />;
  const sorted = [...snap.shops].sort((a, b) => b.bookedRatePct - a.bookedRatePct);
  const chainRevLost = sorted.reduce((s, x) => s + Math.max(0, x.eligible - x.booked) * (aroByShop[x.shopNum] || 0), 0);
  const winCopy = win === 'this_week' ? '(Mon → today)' : '(resets Monday)';
  return (
    <div className="rounded-[26px] border mb-4" style={frostCard()}>
      <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-3 flex-wrap" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Operations</div>
          <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>Call Conversion — {win === 'this_week' ? 'This Week' : 'Rolling 7 Days'}</h2>
          <p className="c2ui text-[13px] mt-1" style={{ color: INK2 }}>Window: {snap.windowStart} → {snap.windowEnd} {winCopy} · Auto-refreshes every 15 min · Revenue lost = unbooked calls × shop ARO.</p>
        </div>
        <WinToggle value={win} onChange={setWin} />
      </div>
      <div className="px-6 py-5">
        <OpsHero
          kicker={win === 'this_week' ? 'Company conversion · this week' : 'Company conversion · rolling 7d'}
          heroValue={`${snap.chain.bookedRatePct.toFixed(1)}%`}
          heroLabel={`${numFmt(snap.chain.booked)} booked out of ${numFmt(snap.chain.eligible)} eligible calls`}
          heroAccent={INK}
          micros={[
            { label: 'Eligible', value: numFmt(snap.chain.eligible) },
            { label: 'Converted', value: numFmt(snap.chain.booked) },
            { label: 'Missed', value: numFmt(Math.max(0, snap.chain.eligible - snap.chain.booked)) },
            { label: 'Revenue lost', value: chainRevLost ? usd(chainRevLost) : '—', emphasis: 'cost' },
          ]}
          footnote={<>Each missed call ≈ one ARO's worth of work that walked out the door. Ranked below by conversion %, with the shops bleeding the most revenue surfaced first.</>}
        />
        <MissedCallbacksChainStrip />
        <div className="mt-3">
          {sorted.map((r, i) => {
            const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
            const score = norm(r.bookedRatePct, 15, 45);
            const [rr, gg, bb] = heatRGB(score);
            const fill = `${Math.min(100, Math.max(4, (r.bookedRatePct / 60) * 100))}%`;
            const aro = aroByShop[r.shopNum] || 0;
            const missed = Math.max(0, r.eligible - r.booked);
            const revLost = missed * aro;
            const open = openShop === r.shopNum;
            return (
              <div key={r.shopNum} style={{ borderBottom: `1px solid ${LINE}` }}>
                <div className="flex items-center gap-3 py-2">
                  <div className="w-5 text-right c2disp text-[13px]" style={{ color: i < 3 ? AMBER : FAINT }}>{i + 1}</div>
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta?.color }} />
                  <div className="c2ui font-medium w-28 shrink-0 text-[13px]" style={{ color: INK }}>{r.shopName}</div>
                  <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.06)' }} title={`${r.booked}/${r.eligible} calls converted`}><div className="h-full rounded-full" style={{ width: fill, background: `linear-gradient(90deg, rgba(${rr},${gg},${bb},0.55), rgba(${rr},${gg},${bb},0.95))` }} /></div>
                  <div className="c2disp text-[13px] tabular-nums w-16 text-right px-2 py-0.5 rounded" style={{ background: `rgba(${rr},${gg},${bb},0.18)`, color: INK }}>{r.bookedRatePct.toFixed(1)}%</div>
                  <div className="c2ui text-[12.5px] tabular-nums w-16 text-right" style={{ color: INK2 }} title="Converted / Eligible">{r.booked}/{r.eligible}</div>
                  <div className="c2disp tabular-nums w-24 text-right text-[14px]" style={{ color: BAD }} title={`${missed} missed × ARO ${usd(aro)}`}>{aro ? usd(revLost) : '—'}</div>
                  <button onClick={() => setOpenShop(open ? null : r.shopNum)} className="c2ui inline-flex items-center gap-1 text-[12.5px] shrink-0" style={{ color: INK2 }}>Callbacks {open ? '▲' : '▾'}</button>
                </div>
                {open && <MissedCallbacksShopQueue shopNum={r.shopNum} />}
              </div>
            );
          })}
        </div>
        <p className="c2ui text-[12.5px] mt-3" style={{ color: FAINT }}>Calls excluded from denominator: spam, wrong number, dropped/audio issues, or transcript &lt;30 chars.</p>
      </div>
    </div>
  );
}

// ── Re-Book at Checkout (FBR) ────────────────────────────────────────────────
interface FbrRow { shopNum: string; shopName: string; fbr: { eligibleROs: number; forwardBookedROs: number; fbrPct: number; avgMonthsToRebook?: number | null }; kar: { expectedAppts: number; keptAppts: number; karPct: number }; ramping: boolean }
const FBR_TARGET = 0.6;
function FbrLeaderboard() {
  const [rows, setRows] = useState<FbrRow[] | null>(null);
  const [aroByShop, setAroByShop] = useState<Record<string, number>>({});
  const [win, setWin] = useState<'rolling' | 'this_week'>('this_week');
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const aroRange = win === 'this_week' ? 'this_week' : 'last_7_days';
    safe<any>(`/api/metrics?range=${aroRange}`).then((d) => { const map: Record<string, number> = {}; for (const s of (d?.kpi?.byShop || [])) map[s.shopNum] = s.aro; setAroByShop(map); });
  }, [win]);
  useEffect(() => {
    let cancelled = false; let retry: ReturnType<typeof setTimeout> | undefined;
    setRows(null); setError(null);
    const fbrUrl = win === 'this_week' ? '/api/fbr?view=leaderboard_wtd' : '/api/fbr?view=leaderboard';
    async function load() {
      try {
        const r = await fetch(fbrUrl); if (!r.ok) { if (!cancelled) setError(`Server returned ${r.status}. First load can take a few minutes — refresh in a moment.`); return; }
        const d = await r.json(); if (cancelled) return;
        if (d.error) { setError(d.error); return; }
        if (d.warming) { retry = setTimeout(load, 30000); return; }
        setRows(d.shops || []);
      } catch (e: any) { if (!cancelled) setError(e?.message || 'Network error'); }
    }
    load();
    return () => { cancelled = true; if (retry) clearTimeout(retry); };
  }, [win]);
  const winLabel = win === 'this_week' ? 'This Week' : 'Rolling 7 Days';
  const winCopy = win === 'this_week' ? 'this week (Mon → today)' : 'the last 7 days';
  const totalRevLost = (rows || []).reduce((s, r) => s + Math.max(0, (r.fbr?.eligibleROs ?? 0) - (r.fbr?.forwardBookedROs ?? 0)) * (aroByShop[r.shopNum] || 0), 0);
  const totalMissed = (rows || []).reduce((s, r) => s + Math.max(0, (r.fbr?.eligibleROs ?? 0) - (r.fbr?.forwardBookedROs ?? 0)), 0);
  const chainElig = (rows || []).reduce((s, r) => s + (r.fbr?.eligibleROs ?? 0), 0);
  const chainBooked = (rows || []).reduce((s, r) => s + (r.fbr?.forwardBookedROs ?? 0), 0);
  const chainKarN = (rows || []).reduce((s, r) => s + (r.kar?.keptAppts ?? 0), 0);
  const chainKarD = (rows || []).reduce((s, r) => s + (r.kar?.expectedAppts ?? 0), 0);
  const chainFbr = chainElig ? chainBooked / chainElig : 0;
  const chainKar = chainKarD ? chainKarN / chainKarD : 0;
  return (
    <div className="rounded-[26px] border mb-4" style={frostCard()}>
      <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-3 flex-wrap" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Operations</div>
          <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>Customers who Re-Booked — {winLabel}</h2>
          <p className="c2ui text-[13px] mt-1" style={{ color: INK2 }}>% of closed retail tickets in {winCopy} where the customer booked a future appointment — at checkout or within 14 days of leaving.</p>
        </div>
        <WinToggle value={win} onChange={setWin} />
      </div>
      <div className="px-6 py-5">
        {rows && (
          <OpsHero
            kicker={`Company re-book rate · ${winCopy}`}
            heroValue={pctR(chainFbr)}
            heroLabel={`Target ${pctR(FBR_TARGET, 0)} · ${numFmt(chainBooked)} of ${numFmt(chainElig)} eligible tickets rebooked`}
            heroAccent={chainFbr >= FBR_TARGET ? GOOD : chainFbr >= FBR_TARGET * 0.75 ? WARN : BAD}
            micros={[
              { label: 'Kept appts (KAR)', value: pctR(chainKar) },
              { label: 'Customers walked', value: numFmt(totalMissed) },
              { label: 'Future revenue lost', value: totalRevLost ? usd(totalRevLost) : '—', emphasis: 'cost' },
            ]}
            footnote={<>Every customer who leaves without a future appointment is one ARO of work that has to be earned back through fresh marketing. Ranked below by re-book rate.</>}
          />
        )}
        {error ? <div className="rounded-2xl p-4 c2ui text-[13px]" style={{ background: 'rgba(192,90,46,0.10)', border: '1px solid rgba(192,90,46,0.3)', color: INK }}><div className="font-semibold" style={{ color: BAD }}>Couldn't load Re-Book data</div><div style={{ color: INK2 }}>{error}</div></div>
          : !rows ? <div className="rounded-2xl" style={{ height: 360, background: 'rgba(255,255,255,0.4)' }} />
          : (
            <div className="space-y-2">
              {rows.map((r, i) => {
                const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
                const color = meta?.color || FAINT;
                const barPct = Math.min(100, (r.fbr.fbrPct / Math.max(FBR_TARGET * 1.5, 1e-6)) * 100);
                const aro = aroByShop[r.shopNum] || 0;
                const missed = Math.max(0, (r.fbr?.eligibleROs ?? 0) - (r.fbr?.forwardBookedROs ?? 0));
                const revLost = missed * aro;
                const open = openShop === r.shopNum;
                return (
                  <div key={r.shopNum}>
                    <div className="grid items-center gap-3 p-3 rounded-2xl" style={{ gridTemplateColumns: '32px 1.6fr 0.9fr 1.6fr 0.7fr 1fr 0.7fr', background: 'rgba(255,255,255,0.45)', border: `1px solid ${LINE}` }}>
                      <div className="c2disp text-[13px] text-right" style={{ color: i < 3 ? AMBER : FAINT }}>{i + 1}</div>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                        <div className="min-w-0"><div className="c2ui font-semibold leading-tight truncate" style={{ color: INK, fontSize: 13 }}>{r.shopName}</div><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Shop {r.shopNum}{r.ramping ? ' · Ramping' : ''}</div></div>
                      </div>
                      <div className="c2disp tabular-nums" style={{ color, fontSize: 22 }}>{pctR(r.fbr.fbrPct, 1)}</div>
                      <div>
                        <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.08)' }}>
                          <div className="h-full" style={{ width: `${barPct}%`, background: color }} />
                          <div className="absolute top-0 h-full w-px" style={{ left: `${(FBR_TARGET / (FBR_TARGET * 1.5)) * 100}%`, background: INK }} />
                        </div>
                        <div className="flex justify-between c2ui text-[12.5px] mt-0.5" style={{ color: FAINT }}><span>0%</span><span>Target {Math.round(FBR_TARGET * 100)}%</span><span>{Math.round(FBR_TARGET * 150)}%</span></div>
                      </div>
                      <div className="c2ui text-[12.5px] tabular-nums text-right" style={{ color: INK2 }} title="Booked / Eligible">{numFmt(r.fbr.forwardBookedROs)}/{numFmt(r.fbr.eligibleROs)}</div>
                      <div className="text-right" title="Mean months from RO close to rebooked appt"><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Avg time to rebook</div><div className="c2disp tabular-nums" style={{ color: INK, fontSize: 14 }}>{r.fbr.avgMonthsToRebook != null ? `${r.fbr.avgMonthsToRebook.toFixed(1)} mo` : '—'}</div></div>
                      <div className="text-right" title={`${missed} not rebooked × ARO ${usd(aro)}`}><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Rev. lost</div><div className="c2disp tabular-nums" style={{ color: BAD, fontSize: 14 }}>{aro ? usd(revLost) : '—'}</div></div>
                    </div>
                    {win === 'rolling' && missed > 0 && (
                      <div className="mt-1 flex items-center justify-end pr-2">
                        <button onClick={() => setOpenShop(open ? null : r.shopNum)} className="c2ui inline-flex items-center gap-1 text-[12.5px]" style={{ color: INK2 }}>{missed} customers didn't rebook {open ? '▲' : '▾'}</button>
                      </div>
                    )}
                    {win === 'rolling' && open && <MissedRebooksShopList shopNum={r.shopNum} />}
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}

// ── Tech Production ─────────────────────────────────────────────────────────
// Reuses the production TechCard (the Pokemon-style trading card visual stays
// as-is — already a bespoke ornate component, also used by the TV view) and
// MangoTierIcon. The luxury frame wraps it: cards / table / chart toggle,
// sortable table, hours-by-shop bar chart, detail drawer.
interface TechRow { technicianId: number; techName?: string; shopNum: string; shopName: string; billedHours: number; jobs: number; efficiency: number }
type TechSort = 'rank' | 'techName' | 'shopName' | 'billedHours' | 'jobs' | 'efficiency';
const TIER_TXT: Record<MangoTier, string> = { legendary: '#C2410C', golden: '#E08E1A', ripe: '#F5A623' };

function TechProduction() {
  const [rows, setRows] = useState<TechRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<'cards' | 'table' | 'chart'>('cards');
  const [detail, setDetail] = useState<TechRow | null>(null);
  const [win, setWin] = useState<'rolling' | 'this_week'>('this_week');
  const [sortCol, setSortCol] = useState<TechSort>('billedHours');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    setRows(null); setError(null);
    const range = win === 'this_week' ? 'this_week' : 'last_7_days';
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tech-production?range=${range}`);
        if (!res.ok) { if (!cancelled) setError(`Server returned ${res.status}`); return; }
        const d = await res.json();
        if (cancelled) return;
        if (d.error) { setError(d.error); return; }
        setRows(d.rows || []);
      } catch (e: any) { if (!cancelled) setError(e?.message || 'Network error'); }
    })();
    return () => { cancelled = true; };
  }, [win]);

  const TOP_N = 10;
  const listed = (() => {
    if (mode !== 'table') return (rows || []).filter((r) => r.efficiency >= 0.9);
    const all = (rows || []).slice();
    const dir = sortDir === 'asc' ? 1 : -1;
    all.sort((a, b) => {
      if (sortCol === 'techName') return dir * (a.techName || `Tech ${a.technicianId}`).localeCompare(b.techName || `Tech ${b.technicianId}`);
      if (sortCol === 'shopName') return dir * a.shopName.localeCompare(b.shopName);
      if (sortCol === 'billedHours') return dir * (a.billedHours - b.billedHours);
      if (sortCol === 'jobs') return dir * (a.jobs - b.jobs);
      if (sortCol === 'efficiency') return dir * (a.efficiency - b.efficiency);
      return dir * (a.efficiency - b.efficiency);
    });
    return all;
  })();
  const display = showAll ? listed : listed.slice(0, TOP_N);
  const expandLabel = mode === 'table' ? 'employees' : 'technicians';
  const shopTotals = useMemo(() => {
    const m = new Map<string, { shopNum: string; shopName: string; hours: number; jobs: number }>();
    for (const r of (rows || [])) { const e = m.get(r.shopNum) || { shopNum: r.shopNum, shopName: r.shopName, hours: 0, jobs: 0 }; e.hours += r.billedHours; e.jobs += r.jobs; m.set(r.shopNum, e); }
    return [...m.values()].sort((a, b) => b.hours - a.hours);
  }, [rows]);
  function onSort(col: TechSort) {
    if (sortCol === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir(col === 'techName' || col === 'shopName' ? 'asc' : 'desc'); }
  }
  const seg = (active: boolean) => active ? { background: INK, color: '#fff' } : { color: INK2, background: 'transparent' };
  const ariaSortArrow = (col: TechSort) => sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅';

  return (
    <div className="rounded-[26px] border mb-4" style={frostCard()}>
      <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Operations</div>
            <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>Tech Production — {win === 'this_week' ? 'This Week' : 'Rolling 7 Days'}</h2>
            <p className="c2ui text-[13px] mt-1" style={{ color: INK2 }}>{win === 'this_week' ? 'Mon → today · authorized labor on revenue-realized ROs · efficiency denominator scales with elapsed working days' : 'Rolling 7 days · 100% = 42.5 available hrs/tech · authorized labor on revenue-realized ROs'}</p>
            {mode === 'cards' && (
              <p className="c2ui text-[12.5px] mt-1" style={{ color: FAINT }}>Card tiers: <span style={{ color: TIER_TXT.legendary, fontWeight: 600 }}>Legendary 110%+</span> · <span style={{ color: TIER_TXT.golden, fontWeight: 600 }}>Golden 100–109%</span> · <span style={{ color: TIER_TXT.ripe, fontWeight: 600 }}>Ripe 90–99%</span> · &lt;90% doesn't earn a card.</p>
            )}
          </div>
          <WinToggle value={win} onChange={setWin} />
        </div>
        <div className="mt-3 flex items-center justify-end gap-1 rounded-lg p-1 self-end inline-flex" style={{ background: 'rgba(34,32,28,0.05)', width: 'auto' }}>
          {(['cards', 'table', 'chart'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className="c2ui rounded-md px-2.5 py-1 text-[13px] font-semibold transition" style={seg(mode === m)}>{m === 'cards' ? 'Cards' : m === 'table' ? 'Table' : 'Chart'}</button>
          ))}
        </div>
      </div>

      <div className="px-6 py-5">
        {error ? (
          <div className="rounded-2xl p-4 c2ui text-[13px]" style={{ background: 'rgba(192,90,46,0.10)', border: '1px solid rgba(192,90,46,0.3)', color: INK }}><div className="font-semibold" style={{ color: BAD }}>Couldn't load Tech Production</div><div style={{ color: INK2 }}>{error}</div></div>
        ) : !rows ? (
          <div className="rounded-2xl" style={{ height: 320, background: 'rgba(255,255,255,0.4)' }} />
        ) : mode === 'cards' ? (
          (() => {
            // Cards mode shows the 90%+ leaderboard. Early in the week (e.g.
            // Monday morning) no tech has hit 90% yet, which used to render
            // an empty grid (production) or a "No technicians at 90%+ …"
            // banner (concept2 v1) — both read as "this widget is broken."
            // Fallback to a top-5-so-far leaderboard so the operator always
            // sees who's leading the chain even if cards haven't earned a
            // tier yet.
            if (display.length > 0) {
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {display.map((r, i) => <TechCard key={`${r.technicianId}-${r.shopNum}`} r={r} rank={i + 1} onClick={() => setDetail(r)} />)}
                </div>
              );
            }
            const topByEff = [...(rows || [])].sort((a, b) => b.efficiency - a.efficiency).slice(0, 5);
            if (topByEff.length === 0) {
              return <div className="c2ui text-[13px] py-8 text-center" style={{ color: INK2 }}>No technician billing posted yet for this window.</div>;
            }
            return (
              <>
                <div className="rounded-2xl px-4 py-3 mb-4 c2ui text-[13px]" style={{ background: 'rgba(232,134,62,0.10)', border: '1px solid rgba(232,134,62,0.32)', color: INK }}>
                  <span className="font-semibold">No tech at 90%+ yet</span> — week is still young. Top performers so far below; cards unlock as billed hours catch up to the elapsed working-days denominator.
                </div>
                <div className="overflow-x-auto rounded-2xl" style={{ border: `1px solid ${LINE}` }}>
                  <table className="w-full c2ui text-[13px]">
                    <thead><tr className="c2ui text-[12.5px] uppercase tracking-wide font-semibold" style={{ background: 'rgba(247,244,238,0.7)', color: FAINT }}>
                      <th className="py-2.5 px-3 text-left">#</th>
                      <th className="py-2.5 px-3 text-left">Technician</th>
                      <th className="py-2.5 px-3 text-left">Shop</th>
                      <th className="py-2.5 px-3 text-right">Billed Hrs</th>
                      <th className="py-2.5 px-3 text-right">Jobs</th>
                      <th className="py-2.5 px-3 text-right">Efficiency</th>
                    </tr></thead>
                    <tbody>
                      {topByEff.map((r, i) => (
                        <tr key={`${r.technicianId}-${r.shopNum}`} onClick={() => setDetail(r)} className="cursor-pointer" style={{ borderTop: `1px solid ${LINE}` }}>
                          <td className="py-2.5 px-3" style={{ color: INK2 }}>{i + 1}</td>
                          <td className="py-2.5 px-3 c2ui font-medium" style={{ color: INK }}>{r.techName || `Tech ${r.technicianId}`}</td>
                          <td className="py-2.5 px-3" style={{ color: INK2 }}>{r.shopName}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums" style={{ color: INK }}>{r.billedHours.toFixed(1)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums" style={{ color: INK }}>{r.jobs}</td>
                          <td className="py-2.5 px-3 text-right font-semibold tabular-nums" style={{ color: r.efficiency >= 0.75 ? '#E08E1A' : '#C05A2E' }}>{(r.efficiency * 100).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()
        ) : mode === 'table' ? (
          <div className="overflow-x-auto rounded-2xl" style={{ border: `1px solid ${LINE}` }}>
            <table className="w-full c2ui text-[13px]">
              <thead><tr className="c2ui text-[12.5px] uppercase tracking-wide font-semibold" style={{ background: 'rgba(247,244,238,0.7)', color: FAINT }}>
                {([['rank', '#', 'left'], ['techName', 'Technician', 'left'], ['shopName', 'Shop', 'left'], ['billedHours', 'Billed Hrs', 'right'], ['jobs', 'Jobs', 'right'], ['efficiency', 'Efficiency', 'right']] as [TechSort, string, 'left' | 'right'][]).map(([k, label, al]) => (
                  <th key={k} onClick={() => onSort(k)} className={`py-2.5 px-3 cursor-pointer select-none ${al === 'right' ? 'text-right' : 'text-left'}`}><span className={`inline-flex items-center gap-1 ${al === 'right' ? 'flex-row-reverse' : ''}`}>{label}<span className="opacity-50">{ariaSortArrow(k)}</span></span></th>
                ))}
              </tr></thead>
              <tbody>
                {display.map((r, i) => (
                  <tr key={`${r.technicianId}-${r.shopNum}`} onClick={() => setDetail(r)} className="cursor-pointer" style={{ borderTop: `1px solid ${LINE}` }}>
                    <td className="py-2.5 px-3" style={{ color: INK2 }}><span className="inline-flex items-center gap-1.5">{i + 1}{i < 3 && <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={14} />}</span></td>
                    <td className="py-2.5 px-3 c2ui font-medium" style={{ color: INK }}>{r.techName || `Tech ${r.technicianId}`}</td>
                    <td className="py-2.5 px-3" style={{ color: INK2 }}>{r.shopName}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{r.billedHours.toFixed(1)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{numFmt(r.jobs)}</td>
                    <td className="py-2.5 px-3 text-right font-semibold tabular-nums" style={{ color: r.efficiency >= 1 ? GOOD : r.efficiency >= 0.75 ? WARN : BAD }}>{pctR(r.efficiency, 1)}</td>
                  </tr>
                ))}
                {display.length === 0 && <tr><td colSpan={6} className="py-8 text-center c2ui" style={{ color: INK2 }}>No technicians in this window.</td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ width: '100%', height: Math.max(280, shopTotals.length * 38 + 40) }}>
            <ResponsiveContainer>
              <BarChart data={shopTotals.map((s) => ({ name: s.shopName, hours: Number(s.hours.toFixed(1)), jobs: s.jobs, color: SHOP_BY_NUM[s.shopNum as keyof typeof SHOP_BY_NUM]?.color || AMBER }))} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 8 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: INK2 }} interval={0} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: `1px solid ${LINE}`, background: 'rgba(255,255,255,0.95)' }} formatter={(val: any, _k, ctx: any) => [`${val} hrs · ${numFmt(ctx.payload.jobs)} jobs`, ctx.payload.name]} />
                <Bar dataKey="hours" radius={[0, 6, 6, 0]} label={{ position: 'right', fontSize: 11, fill: INK2, formatter: (v: any) => `${v} hrs` }}>
                  {shopTotals.map((s, i) => <Cell key={i} fill={SHOP_BY_NUM[s.shopNum as keyof typeof SHOP_BY_NUM]?.color || AMBER} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {listed.length > TOP_N && (
          <button onClick={() => setShowAll(!showAll)} className="mt-5 w-full pt-3 c2ui text-[13px] font-medium flex items-center justify-center gap-1.5" style={{ borderTop: `1px solid ${LINE}`, color: INK2 }}>
            {showAll ? `Show top ${TOP_N}` : `Show all ${listed.length} ${expandLabel}`}
          </button>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(34,32,28,0.40)' }} onClick={() => setDetail(null)}>
          <div className="rounded-[26px] max-w-sm w-full p-6 text-center" style={{ background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(20px)', boxShadow: '0 24px 60px -20px rgba(40,34,26,0.4)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center"><MangoTierIcon tier={tierFor(detail.efficiency)} size={84} /></div>
            <div className="mt-2 c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: TIER_TXT[tierFor(detail.efficiency)] }}>{tierFor(detail.efficiency)}</div>
            <div className="mt-2 c2disp" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>{detail.techName || `Tech ${detail.technicianId}`}</div>
            <div className="c2ui text-[13px]" style={{ color: INK2 }}>{detail.shopName}</div>
            <div className="my-5 h-px w-full" style={{ background: LINE }} />
            <div className="grid grid-cols-3 gap-3">
              {([['Efficiency', pctR(detail.efficiency, 1)], ['Billed Hrs', detail.billedHours.toFixed(1)], ['Jobs', numFmt(detail.jobs)]] as [string, string][]).map(([l, v]) => (
                <div key={l} className="rounded-xl py-3" style={tileInset()}><div className="c2disp tabular-nums" style={{ color: INK, fontSize: 15 }}>{v}</div><div className="c2ui text-[12.5px] uppercase tracking-wide mt-0.5" style={{ color: FAINT }}>{l}</div></div>
              ))}
            </div>
            <button onClick={() => setDetail(null)} className="mt-5 c2ui text-[13px]" style={{ color: INK2 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ComebackRow { shopNum: string; shopName: string; comebackJobs: number; comebackHours: number; estLaborCost: number; revenueLost: number; revenuePerHour: number; ros: number }
function Comebacks() {
  const [rows, setRows] = useState<ComebackRow[] | null>(null);
  const [win, setWin] = useState<'rolling' | 'this_week'>('this_week');
  useEffect(() => {
    setRows(null);
    const range = win === 'this_week' ? 'this_week' : 'last_7_days';
    safe<any>(`/api/extras?view=comebacks&range=${range}`).then((d) => setRows(d?.shops || []));
  }, [win]);
  const windowLabel = win === 'this_week' ? 'This Week' : 'Rolling 7 Days';
  const windowCopy = win === 'this_week' ? 'this week (Mon → today MT)' : 'the last 7 days';
  if (!rows) return <div className="rounded-[26px] mb-4" style={{ height: 260, background: 'rgba(255,255,255,0.5)', border: `1px solid ${LINE}` }} />;
  const ranked = [...rows].sort((a, b) => a.revenueLost - b.revenueLost); // fewest revenue lost = #1
  const totals = rows.reduce((a, r) => ({ jobs: a.jobs + r.comebackJobs, hours: a.hours + r.comebackHours, cost: a.cost + r.estLaborCost, lost: a.lost + r.revenueLost }), { jobs: 0, hours: 0, cost: 0, lost: 0 });
  const maxLost = Math.max(...ranked.map((r) => r.revenueLost), 1);
  const numFmt = (n: number) => Math.round(n).toLocaleString('en-US');
  return (
    <div className="rounded-[26px] border mb-4" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.58))', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', borderColor: 'rgba(255,255,255,0.75)', boxShadow: '0 18px 48px -28px rgba(40,34,26,0.30)' }}>
      <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-3 flex-wrap" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Operations</div>
          <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>Comebacks — {windowLabel}</h2>
        </div>
        <div className="inline-flex rounded-full p-1" style={{ background: 'rgba(34,32,28,0.05)', border: `1px solid ${LINE}` }}>
          {(['this_week', 'rolling'] as const).map((k) => (
            <button key={k} onClick={() => setWin(k)} className="c2ui rounded-full px-3 py-1 text-[13px] font-semibold transition" style={win === k ? { background: '#fff', color: INK, boxShadow: '0 1px 4px rgba(40,34,26,0.12)' } : { color: INK2 }}>{k === 'this_week' ? 'This Week' : 'Rolling 7d'}</button>
          ))}
        </div>
      </div>
      <div className="px-6 py-5">
        <OpsHero
          kicker={`Revenue lost to comebacks · ${windowCopy}`}
          heroValue={usd(totals.lost)}
          heroLabel={`${numFmt(totals.jobs)} re-do jobs ate ${totals.hours.toFixed(1)} tech hours that could have been billable`}
          heroAccent={BAD}
          micros={[
            { label: 'Comeback jobs', value: numFmt(totals.jobs) },
            { label: 'Tech hours given away', value: totals.hours.toFixed(1) },
            { label: 'Est. labor cost', value: usd(totals.cost) },
          ]}
          footnote={<>Heuristic: authorized jobs over {windowCopy} where a tech logged ≥ 15 minutes but the customer was charged ≤ $20 (usually warranty re-dos), plus all jobs categorized as re-inspect. Revenue lost = comeback hours × that shop's billable revenue per tech hour. Ranked below — fewest revenue lost = #1.</>}
        />
        <div>
          {ranked.map((r, i) => {
            const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
            const fillPct = `${Math.max(4, (r.revenueLost / maxLost) * 100)}%`;
            return (
              <div key={r.shopNum} className="flex items-center gap-3 py-2" style={{ borderBottom: `1px solid ${LINE}` }} title={`Revenue per tech hour for this shop ≈ ${usd(r.revenuePerHour)}`}>
                <div className="w-5 text-right c2disp text-[13px]" style={{ color: i < 3 ? AMBER : FAINT }}>{i + 1}</div>
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta?.color }} />
                <div className="c2ui font-medium w-28 shrink-0 text-[13px]" style={{ color: INK }}>{r.shopName}</div>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.06)' }}><div className="h-full rounded-full" style={{ width: fillPct, background: meta?.color, opacity: 0.7 }} /></div>
                <div className="c2ui text-[12.5px] tabular-nums w-12 text-right" style={{ color: INK2 }} title="Comeback jobs">{r.comebackJobs}j</div>
                <div className="c2ui text-[12.5px] tabular-nums w-14 text-right" style={{ color: INK2 }} title="Tech hours">{r.comebackHours.toFixed(1)}hr</div>
                <div className="c2ui text-[12.5px] tabular-nums w-20 text-right" style={{ color: INK2 }} title="Est. labor cost">{usd(r.estLaborCost)}</div>
                <div className="c2disp tabular-nums w-24 text-right text-[14px]" style={{ color: BAD }} title="Revenue lost">{usd(r.revenueLost)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Shop Performance Table (MTD) ─────────────────────────────────────────────
// Per-shop month-to-date comparison: revenue vs prorated goal, cars, ARO,
// close rate, GP$/GP% (+ parts/labor), discounts, approved sales. Heat-gradient
// pills using the concept2 spectrum for cells with goals. Sortable. Edit Goals
// modal is exec-only (matches production).
import type { ChainKpi, ShopKpi } from '@/lib/metrics';
import { resolveRange, RangeKey } from '@/lib/dates';
import { DEFAULT_GOALS, GOALS_STORAGE_KEY as GOALS_KEY, ShopGoal, revenueGoalForRange, prorateRevenueGoal, saveGoals } from '@/lib/goals';

type SortKey = 'rank' | 'shop' | 'revenue' | 'cars' | 'aro' | 'closeRate' | 'gpDollars' | 'gpPct' | 'partsGpPct' | 'laborGpPct' | 'discounts';
function pillStyle(score: number): React.CSSProperties {
  const [r, g, b] = heatRGB(score);
  return { background: `rgba(${r},${g},${b},0.22)`, color: INK, boxShadow: `inset 0 0 0 1px rgba(${r},${g},${b},0.35)` };
}
function ShopPerformance({ isExec }: { isExec: boolean }) {
  const range: RangeKey = 'this_month';
  const [kpi, setKpi] = useState<ChainKpi | null>(null);
  const [goals, setGoals] = useState<GoalsByShop>({});
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  useEffect(() => { setGoals(loadGoals()); }, []);
  useEffect(() => { safe<any>(`/api/metrics?range=${range}`).then((d) => setKpi(d?.kpi ?? null)); }, []);
  const orderIndex = useMemo(() => new Map<string, number>(SHOPS.map((s, i) => [s.num as string, i])), []);
  const win = useMemo(() => resolveRange(range), []);
  const ratios = useMemo(() => {
    const out = new Map<string, { revRatio: number | null; gpPct: number; revGoal: number | undefined; revenue: number }>();
    if (!kpi) return out;
    for (const r of kpi.byShop) {
      const g = goals[r.shopNum];
      const rawGoal = revenueGoalForRange(g, range);
      const revGoal = rawGoal ? prorateRevenueGoal(rawGoal, range, win.start, win.end) : undefined;
      out.set(r.shopNum, { revenue: r.revenue, revGoal, revRatio: revGoal ? r.revenue / revGoal : null, gpPct: r.gpPct });
    }
    return out;
  }, [kpi, goals, win]);
  function toggleSort(k: SortKey) { if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir(k === 'shop' ? 'asc' : 'desc'); } }
  const rows: ShopKpi[] = useMemo(() => {
    if (!kpi) return [];
    const base = [...kpi.byShop];
    if (sortKey === 'shop') { base.sort((a, b) => (orderIndex.get(a.shopNum) ?? 99) - (orderIndex.get(b.shopNum) ?? 99)); return sortDir === 'desc' ? base.reverse() : base; }
    if (sortKey === 'rank') {
      base.sort((a, b) => { const ra = ratios.get(a.shopNum)?.revRatio; const rb = ratios.get(b.shopNum)?.revRatio; if (ra === null && rb === null) return 0; if (ra === null) return 1; if (rb === null) return -1; return sortDir === 'asc' ? (ra as number) - (rb as number) : (rb as number) - (ra as number); });
      return base;
    }
    base.sort((a, b) => { const va = (a as any)[sortKey] as number; const vb = (b as any)[sortKey] as number; return sortDir === 'asc' ? va - vb : vb - va; });
    return base;
  }, [kpi, sortKey, sortDir, orderIndex, ratios]);
  if (!kpi) return <div className="rounded-[26px] mb-4" style={{ height: 300, background: 'rgba(255,255,255,0.5)', border: `1px solid ${LINE}` }} />;
  const totalRevenue = kpi.totalRevenue;
  const totalCars = kpi.totalCars;
  const avgAro = totalCars ? totalRevenue / totalCars : 0;
  // Averages over shops WITH activity only — chainKpi now pads byShop to
  // all 8 shops, so the table always shows every shop. Without this filter
  // the averages would be diluted by zero rows (65% GP across 2 → 16% / 8).
  const activeShops = kpi.byShop.filter(r => r.revenue > 0 || r.cars > 0);
  const avgClose = activeShops.length ? activeShops.reduce((s, r) => s + r.closeRate, 0) / activeShops.length : 0;
  const totalGp = kpi.byShop.reduce((s, r) => s + r.gpDollars, 0);
  const avgGpPct = activeShops.length ? activeShops.reduce((s, r) => s + r.gpPct, 0) / activeShops.length : 0;
  const avgPartsGpPct = activeShops.length ? activeShops.reduce((s, r) => s + r.partsGpPct, 0) / activeShops.length : 0;
  const avgLaborGpPct = activeShops.length ? activeShops.reduce((s, r) => s + r.laborGpPct, 0) / activeShops.length : 0;
  const totalDiscounts = kpi.byShop.reduce((s, r) => s + r.discounts, 0);
  const arrow = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '';
  return (
    <div className="rounded-[26px] border mb-4" style={frostCard()}>
      <div className="px-6 pt-5 pb-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Operations</div>
          <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>Shop Performance Comparison — Month to Date</h2>
          <p className="c2ui text-[13px] mt-1" style={{ color: INK2 }}>Default rank = revenue vs prorated goal (highest first). Pills tint cool→warm by ratio.</p>
        </div>
        {isExec && <button onClick={() => setGoalsOpen(true)} className="c2ui inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-full px-3.5 py-1.5 transition" style={{ background: 'rgba(255,255,255,0.7)', border: `1px solid ${LINE}`, color: INK }}>Edit Goals</button>}
      </div>
      {/* Chain hero strip — gives the table an editorial lede: chain revenue
          as the headline number, then GP$/GP%/ARO/cars/close as supporting
          stats inline. Matches the diagnostic's pattern of "big number first,
          context follows" instead of just diving into a sortable grid. */}
      <div className="px-6 pt-5 pb-2">
        <div className="rounded-[22px] px-7 py-6" style={{
          // Concept-1 atmospheric wash on the chain-MTD hero strip — same
          // gradient as OpsHero so the page reads as a coherent visual
          // system. The chain revenue Fraunces number floats on the luminous
          // surface instead of a plain ivory box.
          background: 'linear-gradient(160deg, rgba(95,169,214,0.12), rgba(242,206,112,0.10) 55%, rgba(232,134,62,0.12))',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55), 0 1px 0 rgba(255,255,255,0.7) inset, 0 6px 18px -10px rgba(40,34,26,0.18)'
        }}>
          <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-x-8 gap-y-4 items-end">
            <div>
              <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: AMBER }}>Chain · month to date</div>
              <div className="c2disp tabular-nums leading-none mt-2.5" style={{ color: INK, fontSize: 44, letterSpacing: '-0.025em' }}>{usd(totalRevenue)}</div>
              <div className="c2ui text-[13px] mt-2" style={{ color: INK2 }}>{numFmt(totalCars)} cars serviced across {kpi.byShop.length} shops · ARO {usd(avgAro)}</div>
            </div>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3 md:justify-end md:border-l md:pl-8" style={{ borderColor: 'rgba(34,32,28,0.08)' }}>
              <div className="flex flex-col">
                <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 22, letterSpacing: '-0.005em' }}>{usd(totalGp)}</span>
                <span className="c2ui mt-1 text-[12.5px] uppercase tracking-[0.16em]" style={{ color: INK2 }}>Gross profit</span>
              </div>
              <div className="flex flex-col">
                <span className="c2disp tabular-nums" style={{ color: avgGpPct >= 0.58 ? GOOD : INK, fontSize: 22, letterSpacing: '-0.005em' }}>{pctR(avgGpPct, 1)}</span>
                <span className="c2ui mt-1 text-[12.5px] uppercase tracking-[0.16em]" style={{ color: INK2 }}>GP% · target 58%</span>
              </div>
              <div className="flex flex-col">
                <span className="c2disp tabular-nums" style={{ color: INK, fontSize: 22, letterSpacing: '-0.005em' }}>{pctR(avgClose, 1)}</span>
                <span className="c2ui mt-1 text-[12.5px] uppercase tracking-[0.16em]" style={{ color: INK2 }}>Close rate</span>
              </div>
              <div className="flex flex-col">
                <span className="c2disp tabular-nums" style={{ color: BAD, fontSize: 22, letterSpacing: '-0.005em' }}>{usd(totalDiscounts)}</span>
                <span className="c2ui mt-1 text-[12.5px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>Discounts</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="px-6 py-5 overflow-x-auto">
        <table className="w-full c2ui text-[13px]" style={{ minWidth: 920 }}>
          <thead><tr className="c2ui text-[12.5px] uppercase tracking-wide font-semibold" style={{ color: FAINT }}>
            {([['rank', '#'], ['shop', 'Shop'], ['revenue', 'Revenue'], ['cars', 'Cars'], ['aro', 'ARO'], ['closeRate', 'Close Rate'], ['gpDollars', 'GP$'], ['gpPct', 'GP%'], ['partsGpPct', 'Parts GP%'], ['laborGpPct', 'Labor GP%'], ['discounts', 'Discounts']] as [SortKey, string][]).map(([k, label]) => (
              <th key={k} onClick={() => toggleSort(k)} className="py-3 px-2 text-left cursor-pointer select-none">
                <span className="inline-flex items-center gap-1">{label}<span className="opacity-50">{arrow(k)}</span></span>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const g = goals[r.shopNum];
              const info = ratios.get(r.shopNum);
              const revGoal = info?.revGoal;
              const revScore = revGoal ? norm(info?.revRatio ?? 0, 0.8, 1.05) : 0.5;
              const gpScore = norm(r.gpPct, 0.5, 0.6);
              const aroScore = g?.aro ? norm(r.aro / g.aro, 0.8, 1.05) : 0.5;
              const closeScore = g?.closeRate ? norm(r.closeRate / g.closeRate, 0.8, 1.05) : 0.5;
              const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
              return (
                <tr key={r.shopNum} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="py-3 px-2 text-center" style={{ color: i < 3 ? AMBER : FAINT }}>{i + 1}</td>
                  <td className="py-3 px-2 font-medium whitespace-nowrap" style={{ color: INK }}>
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: meta?.color, boxShadow: `0 0 0 3px ${meta?.color}22` }} />{r.shopName}
                  </td>
                  <td className="py-3 px-2">
                    {revGoal ? <div className="c2disp tabular-nums font-semibold px-2 py-0.5 rounded inline-block" style={pillStyle(revScore)}>{usd(r.revenue)}</div> : <div className="c2disp tabular-nums font-semibold" style={{ color: INK }}>{usd(r.revenue)}</div>}
                    {revGoal && <div className="c2ui text-[12.5px] mt-0.5" style={{ color: FAINT }}>{((info?.revRatio ?? 0) * 100).toFixed(0)}% of {usd(revGoal)} prorated goal</div>}
                    {(r as any).approvedDollars !== undefined && <div className="c2ui text-[12.5px] mt-0.5" style={{ color: FAINT }}>Approved Sales: <span className="font-semibold tabular-nums" style={{ color: INK }}>{usd((r as any).approvedDollars)}</span></div>}
                  </td>
                  <td className="py-3 px-2 font-medium tabular-nums">{numFmt(r.cars)}</td>
                  <td className="py-3 px-2">
                    {g?.aro ? <div className="c2disp tabular-nums px-2 py-0.5 rounded inline-block" style={pillStyle(aroScore)}>{usd(r.aro)}</div> : <div className="c2disp tabular-nums" style={{ color: INK }}>{usd(r.aro)}</div>}
                    {g?.aro && <div className="c2ui text-[12.5px] mt-0.5" style={{ color: FAINT }}>goal {usd(g.aro)}</div>}
                  </td>
                  <td className="py-3 px-2">
                    {g?.closeRate ? <div className="c2disp tabular-nums px-2 py-0.5 rounded inline-block" style={pillStyle(closeScore)}>{pctR(r.closeRate, 1)}</div> : <div className="c2disp tabular-nums" style={{ color: INK }}>{pctR(r.closeRate, 1)}</div>}
                    {g?.closeRate && <div className="c2ui text-[12.5px] mt-0.5" style={{ color: FAINT }}>goal {pctR(g.closeRate, 0)}</div>}
                  </td>
                  <td className="py-3 px-2 font-medium tabular-nums">{usd(r.gpDollars)}</td>
                  <td className="py-3 px-2">
                    <div className="c2disp tabular-nums px-2 py-0.5 rounded inline-block" style={pillStyle(gpScore)}>{pctR(r.gpPct, 1)}</div>
                    {g?.gpPct && <div className="c2ui text-[12.5px] mt-0.5" style={{ color: FAINT }}>goal {pctR(g.gpPct, 0)}</div>}
                  </td>
                  <td className="py-3 px-2 tabular-nums">{pctR(r.partsGpPct, 1)}</td>
                  <td className="py-3 px-2 tabular-nums">{pctR(r.laborGpPct, 1)}</td>
                  <td className="py-3 px-2 tabular-nums">{usd(r.discounts)}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: `1px solid ${LINE}`, background: 'rgba(255,255,255,0.45)' }}>
              <td className="py-3 px-2" />
              <td className="py-3 px-2 font-semibold" style={{ color: INK }}>Total / Avg</td>
              <td className="py-3 px-2"><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Total</div><div className="font-semibold tabular-nums">{usd(totalRevenue)}</div></td>
              <td className="py-3 px-2"><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Total</div><div className="font-semibold tabular-nums">{numFmt(totalCars)}</div></td>
              <td className="py-3 px-2"><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Avg</div><div className="font-semibold tabular-nums">{usd(avgAro)}</div></td>
              <td className="py-3 px-2"><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Avg</div><div className="font-semibold tabular-nums">{pctR(avgClose, 1)}</div></td>
              <td className="py-3 px-2"><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Total</div><div className="font-semibold tabular-nums">{usd(totalGp)}</div></td>
              <td className="py-3 px-2"><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Avg</div><div className="font-semibold tabular-nums">{pctR(avgGpPct, 1)}</div></td>
              <td className="py-3 px-2"><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Avg</div><div className="font-semibold tabular-nums">{pctR(avgPartsGpPct, 1)}</div></td>
              <td className="py-3 px-2"><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Avg</div><div className="font-semibold tabular-nums">{pctR(avgLaborGpPct, 1)}</div></td>
              <td className="py-3 px-2"><div className="c2ui text-[12.5px]" style={{ color: FAINT }}>Total</div><div className="font-semibold tabular-nums">{usd(totalDiscounts)}</div></td>
            </tr>
          </tbody>
        </table>
      </div>
      {goalsOpen && <GoalsModal goals={goals} onClose={() => setGoalsOpen(false)} onSave={(g) => { setGoals(g); saveGoals(g); setGoalsOpen(false); }} />}
    </div>
  );
}

function GoalsModal({ goals, onClose, onSave }: { goals: GoalsByShop; onClose: () => void; onSave: (g: GoalsByShop) => void }) {
  const [draft, setDraft] = useState<GoalsByShop>(() => structuredClone(goals));
  function set(num: string, field: keyof ShopGoal, raw: string) {
    setDraft((d) => { const next = { ...d, [num]: { ...d[num] } }; const n = raw === '' ? undefined : Number(raw); if (n === undefined || Number.isNaN(n)) delete next[num][field]; else (next[num] as any)[field] = (field === 'closeRate' || field === 'gpPct' || field === 'noi') ? n / 100 : n; return next; });
  }
  const v = (num: string, field: keyof ShopGoal) => { const g = draft[num]?.[field]; if (g === undefined) return ''; return (field === 'closeRate' || field === 'gpPct' || field === 'noi') ? String(Math.round((g as number) * 1000) / 10) : String(g); };
  const fields: { key: keyof ShopGoal; label: string }[] = [
    { key: 'revenueWeekly', label: '$/Wk' }, { key: 'revenueMonthly', label: '$/Mo' }, { key: 'revenueQuarterly', label: '$/Qtr' },
    { key: 'aro', label: 'ARO $' }, { key: 'closeRate', label: 'Close %' }, { key: 'gpPct', label: 'GP %' }, { key: 'noi', label: 'NOI %' },
  ];
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(34,32,28,0.40)' }} onClick={onClose}>
      <div className="rounded-[26px] p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto" style={{ background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(20px)', boxShadow: '0 24px 60px -20px rgba(40,34,26,0.4)' }} onClick={(e) => e.stopPropagation()}>
        <h3 className="c2disp" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>Edit Shop Goals</h3>
        <p className="c2ui text-[12.5px] mt-1 mb-4" style={{ color: INK2 }}>Per-shop targets. Saved locally in this browser. Revenue goals drive cell coloring based on the current time range (weekly / monthly / quarterly).</p>
        <table className="w-full c2ui text-[13px]">
          <thead><tr className="c2ui text-[12.5px] uppercase tracking-wide" style={{ color: FAINT, borderBottom: `1px solid ${LINE}` }}><th className="py-2 px-2 text-left font-semibold">Shop</th>{fields.map((f) => <th key={f.key} className="py-2 px-2 text-left font-semibold">{f.label}</th>)}</tr></thead>
          <tbody>
            {SHOPS.map((s) => (
              <tr key={s.num} style={{ borderBottom: `1px solid ${LINE}` }}>
                <td className="py-2 px-2 font-medium whitespace-nowrap" style={{ color: INK }}>{s.num} {s.name}</td>
                {fields.map((f) => <td key={f.key} className="py-2 px-2"><input type="number" inputMode="decimal" value={v(s.num, f.key)} onChange={(e) => set(s.num, f.key, e.target.value)} className="c2ui w-24 px-2 py-1 rounded text-[13px]" style={{ border: `1px solid ${LINE}`, background: 'rgba(255,255,255,0.7)' }} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => { if (typeof window !== 'undefined') localStorage.removeItem(GOALS_KEY); setDraft(DEFAULT_GOALS); }} className="c2ui rounded-full px-4 py-2 text-[13px] font-semibold" style={{ border: `1px solid ${LINE}`, color: INK2, background: 'rgba(255,255,255,0.7)' }}>Reset to Defaults</button>
          <button onClick={onClose} className="c2ui rounded-full px-4 py-2 text-[13px] font-semibold" style={{ border: `1px solid ${LINE}`, color: INK2, background: 'rgba(255,255,255,0.7)' }}>Cancel</button>
          <button onClick={() => onSave(draft)} className="c2ui rounded-full px-4 py-2 text-[13px] font-semibold" style={{ background: INK, color: '#fff' }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Google Ratings (exec-only) ───────────────────────────────────────────────
interface GRReview { publishTime: string; rating: number; text: string; author: string }
interface GRWindowSlice { total: number; fiveStar: number; belowFive: number; reviews: GRReview[] }
interface GRRow { shopNum: string; shopName: string; rating: number | null; total: number; placeId?: string; windows: { rolling7d: GRWindowSlice; thisWeek: GRWindowSlice } }
const GR_EMPTY: GRWindowSlice = { total: 0, fiveStar: 0, belowFive: 0, reviews: [] };
function GoogleRatings() {
  const [rows, setRows] = useState<GRRow[] | null>(null);
  const [modal, setModal] = useState<{ shop: GRRow; filter: 'all' | '5' | '<5' } | null>(null);
  const [win, setWin] = useState<'rolling' | 'this_week'>('this_week');
  useEffect(() => {
    Promise.all([
      safe<any>('/api/extras?view=google-ratings'),
      safe<any>('/api/extras?view=zapier-reviews'),
    ]).then(([places, zapier]) => {
      const zByShop: Record<string, any> = {}; for (const s of (zapier?.shops || [])) zByShop[s.shopNum] = s;
      const pByShop: Record<string, any> = {}; for (const s of (places?.shops || [])) pByShop[s.shopNum] = s;
      const primary: any[] = places?.shops?.length ? places.shops : zapier?.shops || [];
      const merged: GRRow[] = primary.map((p: any) => {
        const z = zByShop[p.shopNum];
        const pl = pByShop[p.shopNum] || {};
        return {
          shopNum: p.shopNum, shopName: p.shopName,
          rating: pl.rating ?? null, total: pl.total ?? 0, placeId: pl.placeId,
          windows: { rolling7d: z?.windows?.rolling7d ?? GR_EMPTY, thisWeek: z?.windows?.thisWeek ?? GR_EMPTY },
        };
      });
      setRows(merged);
    });
  }, []);
  if (!rows) return <div className="rounded-[26px] mb-4" style={{ height: 360, background: 'rgba(255,255,255,0.5)', border: `1px solid ${LINE}` }} />;
  const slice = (r: GRRow) => win === 'rolling' ? r.windows.rolling7d : r.windows.thisWeek;
  const rankedByNew = [...rows].sort((a, b) => slice(b).fiveStar - slice(a).fiveStar);
  const rankedByRating = [...rows].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const windowLabel = win === 'this_week' ? 'This Week' : 'Rolling 7 Days';
  const gmbUrl = (placeId?: string) => placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : '#';
  return (
    <div className="rounded-[26px] border mb-4" style={frostCard()}>
      <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-3 flex-wrap" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Operations</div>
          <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>Google Reviews — {windowLabel}</h2>
          <p className="c2ui text-[13px] mt-1" style={{ color: INK2 }}>Left: cumulative Google rating per shop (Places API, refreshed daily). Right: new reviews in the selected window (live Zapier feed).</p>
        </div>
        <WinToggle value={win} onChange={setWin} />
      </div>
      <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-wide mb-2" style={{ color: FAINT }}>Current Google rating</div>
          {rankedByRating.map((r, i) => {
            const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
            return (
              <div key={r.shopNum} className="flex items-center gap-3 py-2" style={{ borderBottom: `1px solid ${LINE}` }}>
                <div className="w-5 text-right c2disp text-[13px]" style={{ color: i < 3 ? AMBER : FAINT }}>{i + 1}</div>
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta?.color }} />
                <div className="c2ui font-medium w-28 shrink-0 text-[13px]" style={{ color: INK }}>{r.shopName}</div>
                <div className="flex-1 c2ui text-[13px]" style={{ color: INK2 }}>{r.rating != null ? <><span className="c2disp tabular-nums" style={{ color: INK, fontSize: 17 }}>{r.rating.toFixed(2)}</span><span className="text-[#E08E1A]"> ★</span> · {numFmt(r.total)} reviews</> : <span style={{ color: FAINT }}>—</span>}</div>
                {r.placeId && <a href={gmbUrl(r.placeId)} target="_blank" rel="noreferrer" className="c2ui text-[13px]" style={{ color: AMBER }}>Maps →</a>}
              </div>
            );
          })}
        </div>
        <div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-wide mb-2" style={{ color: FAINT }}>New reviews · {windowLabel}</div>
          {rankedByNew.map((r, i) => {
            const w = slice(r);
            const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
            return (
              <div key={r.shopNum} className="flex items-center gap-3 py-2" style={{ borderBottom: `1px solid ${LINE}` }}>
                <div className="w-5 text-right c2disp text-[13px]" style={{ color: i < 3 ? AMBER : FAINT }}>{i + 1}</div>
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta?.color }} />
                <div className="c2ui font-medium w-28 shrink-0 text-[13px]" style={{ color: INK }}>{r.shopName}</div>
                <div className="flex-1 flex items-center gap-2 c2ui text-[13px]" style={{ color: INK2 }}>
                  <button onClick={() => w.fiveStar > 0 && setModal({ shop: r, filter: '5' })} className="c2disp tabular-nums" style={{ color: w.fiveStar > 0 ? GOOD : FAINT, fontSize: 16 }}>{w.fiveStar} <span className="text-[12.5px]">5★</span></button>
                  <button onClick={() => w.belowFive > 0 && setModal({ shop: r, filter: '<5' })} className="c2disp tabular-nums" style={{ color: w.belowFive > 0 ? BAD : FAINT, fontSize: 16 }}>{w.belowFive} <span className="text-[12.5px]">1–4★</span></button>
                </div>
                {w.total > 0 && <button onClick={() => setModal({ shop: r, filter: 'all' })} className="c2ui text-[13px]" style={{ color: AMBER }}>See all →</button>}
              </div>
            );
          })}
        </div>
      </div>
      {modal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(34,32,28,0.40)' }} onClick={() => setModal(null)}>
          <div className="rounded-[26px] max-w-lg w-full max-h-[80vh] overflow-y-auto p-6" style={{ background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(20px)', boxShadow: '0 24px 60px -20px rgba(40,34,26,0.4)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="c2disp" style={{ color: INK, fontSize: 22, letterSpacing: '-0.01em' }}>{modal.shop.shopName} — {modal.filter === '5' ? '5★ reviews' : modal.filter === '<5' ? 'Below-5★ reviews' : 'Recent reviews'}</h3>
                <p className="c2ui text-[13px] mt-0.5" style={{ color: INK2 }}>From the Zapier review feed (live, no truncation).</p>
              </div>
              <button onClick={() => setModal(null)} className="c2ui text-[20px] leading-none" style={{ color: INK2 }}>×</button>
            </div>
            {(() => {
              const all = slice(modal.shop).reviews.filter((r) => modal.filter === '5' ? r.rating === 5 : modal.filter === '<5' ? (r.rating > 0 && r.rating < 5) : true);
              if (all.length === 0) return <div className="c2ui text-[13px] py-6 text-center" style={{ color: INK2 }}>No reviews in this bucket.</div>;
              return all.map((r, i) => (
                <div key={i} className="py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="c2ui text-[13px] font-semibold" style={{ color: INK }}>{r.author}</div>
                    <div style={{ color: '#E08E1A' }}>{'★'.repeat(r.rating)}<span style={{ color: 'rgba(34,32,28,0.15)' }}>{'★'.repeat(5 - r.rating)}</span></div>
                    <div className="c2ui text-[12.5px] ml-auto" style={{ color: FAINT }}>{r.publishTime ? new Date(r.publishTime).toLocaleDateString() : ''}</div>
                  </div>
                  {r.text && <div className="c2ui text-[13px] whitespace-pre-line" style={{ color: INK2 }}>{r.text}</div>}
                </div>
              ));
            })()}
            <a href={gmbUrl(modal.shop.placeId)} target="_blank" rel="noreferrer" className="inline-block mt-4 c2ui text-[13px] font-medium" style={{ color: AMBER }}>View all on Google Maps →</a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── To-Do Recoveries Widget ─────────────────────────────────────────────────
// New trophy/operations widget: per-shop count of items checked off in the
// To Do queue (callbacks / rebooks / declined-jobs the manager marked
// "recovered"). Standard This Week / Rolling 7d toggle. Same OpsHero +
// ranked list shape as BookedRate / FBR / Comebacks. Wired into the Pending
// Trophies tally + Past Trophies Earned this Quarter via TT_CATEGORIES and
// QCATS, and into the Golden Mango ceremony via lib/goldenMango.ts.
interface TodoRecRow { shopNum: string; shopName: string; count: number }
function TodoRecoveriesWidget() {
  const [rows, setRows] = useState<TodoRecRow[] | null>(null);
  const [chainCount, setChainCount] = useState<number>(0);
  const [win, setWin] = useState<'rolling' | 'this_week'>('this_week');
  useEffect(() => {
    setRows(null);
    const window = win === 'this_week' ? 'this_week' : 'rolling_7d';
    safe<any>(`/api/extras?view=todo-recoveries&window=${window}`).then((d) => {
      setRows(d?.shops || []);
      setChainCount(d?.chain?.count ?? 0);
    });
  }, [win]);
  const winLabel = win === 'this_week' ? 'This Week' : 'Rolling 7 Days';
  const winCopy = win === 'this_week' ? '(Mon → today MT)' : '(last 7 days)';
  if (!rows) return <div className="rounded-[26px] mb-4" style={{ height: 260, background: 'rgba(255,255,255,0.5)', border: `1px solid ${LINE}` }} />;
  const ranked = [...rows].sort((a, b) => b.count - a.count);
  const maxCount = Math.max(...ranked.map((r) => r.count), 1);
  const leaderCount = ranked[0]?.count ?? 0;
  return (
    <div className="rounded-[26px] border mb-4" style={frostCard()}>
      <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-3 flex-wrap" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Operations</div>
          <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.015em' }}>To-Do Items Checked Off — {winLabel}</h2>
          <p className="c2ui text-[13px] mt-1" style={{ color: INK2 }}>Total per-shop count of recovered customers across the missed-callbacks, missed re-books, and declined-jobs queues {winCopy}. Marking a customer "recovered" in the To Do page increments this tally.</p>
        </div>
        <WinToggle value={win} onChange={setWin} />
      </div>
      <div className="px-6 py-5">
        <OpsHero
          kicker={`Chain recoveries · ${win === 'this_week' ? 'this week' : 'rolling 7d'}`}
          heroValue={numFmt(chainCount)}
          heroLabel={chainCount === 1 ? '1 customer recovered across all shops' : `${numFmt(chainCount)} customers recovered across all shops`}
          heroAccent={GOOD}
          micros={[
            { label: 'Top shop', value: leaderCount > 0 ? (ranked[0]?.shopName ?? '—') : '—' },
            { label: 'Top shop count', value: numFmt(leaderCount) },
            { label: 'Shops contributing', value: numFmt(ranked.filter((r) => r.count > 0).length) },
          ]}
          footnote={<>Counts come from the timestamped recovery log written when a manager clicks a callback / rebook / declined-job as "recovered." Items un-checked are removed from this count.</>}
        />
        <div>
          {ranked.map((r, i) => {
            const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
            const score = leaderCount > 0 ? norm(r.count / leaderCount, 0, 1) : 0;
            const fillPct = `${Math.max(2, (r.count / maxCount) * 100)}%`;
            return (
              <div key={r.shopNum} className="flex items-center gap-3 py-2" style={{ borderBottom: `1px solid ${LINE}` }}>
                <div className="w-5 text-right c2disp text-[13px]" style={{ color: i < 3 && r.count > 0 ? AMBER : FAINT }}>{i + 1}</div>
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta?.color }} />
                <div className="c2ui font-medium w-32 shrink-0 text-[13px]" style={{ color: INK }}>{r.shopName}</div>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.06)' }}>
                  <div className="h-full rounded-full" style={{ width: fillPct, background: heatBar(score) }} />
                </div>
                <div className="c2disp text-[14px] tabular-nums w-16 text-right px-2 py-0.5 rounded" style={{ background: r.count > 0 ? `${heatSolid(score)}22` : 'transparent', color: INK }}>{numFmt(r.count)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
