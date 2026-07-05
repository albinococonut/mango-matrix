'use client';

// THE GOLDEN MANGO — weekly shop championship. Redesigned as a calm, premium
// championship banner: soft warm tint, restrained gold accents, clean
// hierarchy, polished segmented countdown. No neon, particles, or confetti —
// "competitive operations excellence", not arcade UI. Champion is locked by
// the cron every Friday 6 PM Mountain (lib/goldenMango.ts) and frozen.

import { useEffect, useState } from 'react';
import { Trophy, Crown } from 'lucide-react';
import { SHOPS } from '@/lib/shops';

interface Champion {
  periodStart: string; crownedAt: string; shopNum: string; shopName: string;
  score: number; medals: { gold: number; silver: number; bronze: number };
  revenue: number; gpPct: number; cars: number; rankMovement: number | null;
  defendingSince: string; isNewChampion: boolean; isTie?: boolean; tiedShopNames?: string[];
}

const GOLD = '#C9A227';
const GOLD_SOFT = 'rgba(201,162,39,0.28)';

function fmtUsd(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
  catch { return iso.slice(0, 10); }
}

function useCountdown(targetISO: string | null) {
  const [p, setP] = useState<{ d: number; h: number; m: number; s: number } | null>(null);
  useEffect(() => {
    if (!targetISO) return;
    const tick = () => {
      const ms = new Date(targetISO).getTime() - Date.now();
      if (ms <= 0) { setP({ d: 0, h: 0, m: 0, s: 0 }); return; }
      setP({
        d: Math.floor(ms / 86400000),
        h: Math.floor((ms % 86400000) / 3600000),
        m: Math.floor((ms % 3600000) / 60000),
        s: Math.floor((ms % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetISO]);
  return p;
}

function TimeBlock({ n, label, live }: { n: number; label: string; live?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`min-w-[3.1rem] rounded-xl px-3 py-2 text-[1.4rem] font-semibold tabular-nums text-mango-ink ${live ? 'gm-tick' : ''}`}
        style={{ background: 'rgba(201,162,39,0.10)', boxShadow: `inset 0 0 0 1px ${GOLD_SOFT}` }}
      >
        {String(n).padStart(2, '0')}
      </div>
      <span className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-mango-faint">{label}</span>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={`tabular-nums ${strong ? 'text-mango-ink' : 'text-mango-ink/80'}`}
        style={{ fontSize: 'clamp(1.15rem, 2.4vw, 1.6rem)', fontWeight: 600, letterSpacing: '-0.01em' }}>
        {value}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-mango-faint">{label}</span>
    </div>
  );
}


export default function GoldenMangoHero() {
  const [data, setData] = useState<{ champion: Champion | null; nextCrownAt: string } | null>(null);
  const cd = useCountdown(data?.nextCrownAt ?? null);

  const fetchOnce = () => fetch('/api/extras?view=golden-mango', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => { setData(d); return d; })
    .catch(() => null);

  useEffect(() => { fetchOnce(); }, []);

  // When the countdown crosses zero (Friday 6 PM MT), the cron is racing to
  // crown the new champion. Poll every 15 seconds until either (a) the
  // server returns a fresher nextCrownAt (meaning a new period was locked),
  // or (b) we've polled 20 times (5 min cap — generous given the sync chain
  // hoist that puts update-golden-mango first). Without this, employees
  // watching the page at the boundary would sit on the old data forever
  // until a manual refresh.
  const reachedZero = cd && cd.d === 0 && cd.h === 0 && cd.m === 0 && cd.s === 0;
  useEffect(() => {
    if (!reachedZero || !data) return;
    const startedAt = data.nextCrownAt;
    let polls = 0;
    const id = setInterval(async () => {
      polls++;
      if (polls > 20) { clearInterval(id); return; }
      const fresh = await fetchOnce();
      if (fresh?.nextCrownAt && fresh.nextCrownAt !== startedAt) {
        clearInterval(id);  // new period locked — countdown will reset on next render
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [reachedZero, data?.nextCrownAt]);

  const champ = data?.champion ?? null;
  const move = (() => {
    if (!champ) return null;
    if (champ.rankMovement === null) return { txt: 'New', cls: 'text-mango-info' };
    if (champ.rankMovement > 0) return { txt: `▲ ${champ.rankMovement}`, cls: 'text-mango-green' };
    if (champ.rankMovement === 0) return { txt: 'Holding', cls: 'text-mango-muted' };
    return { txt: `▼ ${Math.abs(champ.rankMovement)}`, cls: 'text-mango-red' };
  })();
  const title = champ?.isTie ? (champ.tiedShopNames || [champ.shopName]).join('  ·  ') : champ?.shopName;

  return (
    <section
      data-fs-section
      className="relative w-full overflow-hidden mb-8"
      style={{
        borderRadius: 24,
        background: 'linear-gradient(140deg, #FFFCF4 0%, #FDF6E7 55%, #FCF1DC 100%)',
        boxShadow: `inset 0 0 0 1px ${GOLD_SOFT}, 0 1px 3px rgba(31,41,55,0.04)`,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />

      <div className="relative px-6 sm:px-10 py-8 sm:py-10">
        {/* Eyebrow */}
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full"
            style={{ background: 'rgba(201,162,39,0.12)', boxShadow: `inset 0 0 0 1px ${GOLD_SOFT}` }}>
            <Trophy className="w-[18px] h-[18px]" style={{ color: GOLD }} strokeWidth={2} />
          </span>
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.22em]" style={{ color: GOLD }}>
              The Golden Mango
            </div>
            <div className="text-[11px] text-mango-faint">This week’s champion · locked Fridays 6 PM MT</div>
          </div>
        </div>

        {champ ? (
          <div className="mt-3">
            {/* STATS LEFT, GOLDEN MANGO TROPHY RIGHT. Tightened gap from
                the eyebrow + items-start anchors the title to the top of
                the row (instead of vertically centering it against the
                tall trophy column). Trophy column gets an extra lift on
                lg+ so it sits flush in the upper-right corner of the
                section, next to the eyebrow. */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 lg:gap-12 items-start">
              {/* LEFT: title + stats */}
              <div className="min-w-0">
                {champ.isTie && (
                  <div className="text-[12px] font-semibold uppercase tracking-[0.16em] mb-1.5" style={{ color: GOLD }}>
                    Shared Title
                  </div>
                )}
                <h1 className="font-semibold text-mango-ink leading-[1.05] tracking-[-0.02em]"
                  style={{ fontSize: 'clamp(2rem, 5vw, 3.4rem)' }}>
                  {title}
                </h1>

                <div className="mt-5 flex flex-wrap items-end gap-x-9 gap-y-4">
                  <Stat label="Weekly Score" value={String(champ.score)} strong />
                  <div className="flex flex-col">
                    <span className="flex items-center gap-3 text-[1.15rem] font-semibold tabular-nums">
                      <span title="Gold" style={{ color: GOLD }}>● {champ.medals.gold}</span>
                      <span title="Silver" style={{ color: '#A8AEB8' }}>● {champ.medals.silver}</span>
                      <span title="Bronze" style={{ color: '#B98A57' }}>● {champ.medals.bronze}</span>
                    </span>
                    <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-mango-faint">Medals</span>
                  </div>
                  {move && (
                    <div className="flex flex-col">
                      <span className={`text-[1.15rem] font-semibold ${move.cls}`}>{move.txt}</span>
                      <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-mango-faint">vs last week</span>
                    </div>
                  )}
                </div>

                <div className="mt-7 flex flex-wrap gap-x-10 gap-y-4 pt-5"
                  style={{ borderTop: `1px solid ${GOLD_SOFT}` }}>
                  <Stat label="Revenue" value={champ.revenue > 0 ? fmtUsd(champ.revenue) : '—'} />
                  <Stat label="GP %" value={champ.gpPct > 0 ? `${(champ.gpPct * 100).toFixed(1)}%` : '—'} />
                  <Stat label="Cars Serviced" value={champ.cars > 0 ? String(champ.cars) : '—'} />
                  <Stat label="Defending Since" value={fmtDate(champ.defendingSince)} />
                </div>
              </div>

              {/* RIGHT: the Golden Mango trophy art. PNG sits on a soft
                  radial gold glow so it pops against the warm background.
                  On large screens, lifted ~80px to park it in the upper-
                  right corner of the section, next to the eyebrow. On
                  mobile (stacked layout), no lift. */}
              <div className="relative shrink-0 flex items-center justify-center self-start lg:-mt-20">
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: 'radial-gradient(circle, rgba(244,180,0,0.28) 0%, rgba(201,162,39,0.10) 45%, transparent 70%)',
                    filter: 'blur(8px)',
                  }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/the-golden-mango.png"
                  alt="The Golden Mango trophy"
                  className="relative block object-contain"
                  style={{
                    width: 'clamp(220px, 26vw, 340px)',
                    height: 'auto',
                    filter: 'drop-shadow(0 18px 26px rgba(124,72,12,0.28))',
                  }}
                />
              </div>
            </div>

            {/* HERO PHOTO — full-width banner of the winning shop, placed
                between the stats/trophy row and the Next Crown row. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/shop-photos/${encodeURIComponent(`${champ.shopNum} team photo.jpg`)}`}
              alt={`${champ.shopName} team`}
              className="block w-full object-cover rounded-2xl mt-10"
              style={{
                aspectRatio: '16 / 7',
                maxHeight: 460,
                boxShadow: `0 0 0 3px ${GOLD_SOFT}, 0 20px 40px rgba(124,72,12,0.22), inset 0 0 0 1px rgba(255,255,255,0.5)`,
              }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />

            {/* Next Crown — full-width row below the photo. */}
            <div className="mt-10 pt-7 flex flex-wrap items-start gap-x-10 gap-y-5"
              style={{ borderTop: `1px solid ${GOLD_SOFT}` }}>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-mango-faint mb-3">
                  Next Crown
                </div>
                <div className="flex items-start gap-2.5">
                  <TimeBlock n={cd?.d ?? 0} label="Days" />
                  <TimeBlock n={cd?.h ?? 0} label="Hrs" />
                  <TimeBlock n={cd?.m ?? 0} label="Min" />
                  <TimeBlock n={cd?.s ?? 0} label="Sec" live />
                </div>
              </div>
              <p className="text-[12px] leading-relaxed text-mango-muted max-w-xl flex-1 min-w-[260px]">
                Awarded to the shop with the most <span className="text-mango-ink font-medium">gold</span> finishes
                across the weekly categories — Revenue, GP%, Top Tech, Re-Books, Comebacks, Reviews &amp; Call
                Conversion. Ties break by silver, then bronze. Defended all week.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-8 flex flex-col items-center text-center">
            {/* Big elegant crown — restrained gold, soft glow + gentle
                sparkles, consistent with the calm premium aesthetic. */}
            <div className="gm-crown relative inline-flex items-center justify-center mb-6">
              <span className="gm-crown-glow" aria-hidden />
              <Crown className="gm-crown-icon relative" strokeWidth={1.5}
                style={{ width: 96, height: 96, color: GOLD }} />
              <span className="gm-spark gm-spark-1" aria-hidden />
              <span className="gm-spark gm-spark-2" aria-hidden />
              <span className="gm-spark gm-spark-3" aria-hidden />
              <span className="gm-spark gm-spark-4" aria-hidden />
            </div>
            <h1 className="font-semibold text-mango-ink leading-tight tracking-[-0.02em]"
              style={{ fontSize: 'clamp(1.7rem, 4vw, 2.8rem)' }}>
              Crown loading…
            </h1>
            <p className="mt-2.5 text-[13px] text-mango-muted max-w-md">
              The current champion is being computed. The Golden Mango is locked every Friday at 6:00 PM Mountain — refresh in a moment.
            </p>
            <div className="mt-7 flex items-start gap-2.5">
              <TimeBlock n={cd?.d ?? 0} label="Days" />
              <TimeBlock n={cd?.h ?? 0} label="Hrs" />
              <TimeBlock n={cd?.m ?? 0} label="Min" />
              <TimeBlock n={cd?.s ?? 0} label="Sec" live />
            </div>

            <div className="mt-10 w-full">
              <div className="text-[13px] font-semibold uppercase tracking-[0.18em] mb-4" style={{ color: GOLD }}>
                Who will it be?
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
                {SHOPS.map((s) => (
                  <div key={s.num} className="flex flex-col items-center text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/shop-photos/${encodeURIComponent(`${s.num} team photo.jpg`)}`}
                      alt={`${s.name} team`}
                      className="w-16 h-16 rounded-full object-cover mb-2"
                      style={{ boxShadow: `0 0 0 2px ${GOLD_SOFT}, 0 2px 8px rgba(124,72,12,0.18)` }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                    />
                    <span className="text-[12px] font-medium text-mango-ink leading-tight">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .gm-tick { transition: background 0.4s ease; }
        @keyframes gm-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.82; } }
        .gm-tick { animation: gm-pulse 2s ease-in-out infinite; }

        .gm-crown { width: 150px; height: 130px; }
        .gm-crown-icon {
          filter: drop-shadow(0 6px 14px rgba(201,162,39,0.35));
          animation: gm-crown-float 5s ease-in-out infinite;
        }
        @keyframes gm-crown-float {
          0%,100% { transform: translateY(0) rotate(-0.5deg); }
          50% { transform: translateY(-6px) rotate(0.5deg); }
        }
        .gm-crown-glow {
          position: absolute;
          width: 150px; height: 150px; border-radius: 9999px;
          background: radial-gradient(circle, rgba(244,180,0,0.30) 0%, rgba(201,162,39,0.12) 45%, transparent 70%);
          animation: gm-glow-breathe 5s ease-in-out infinite;
        }
        @keyframes gm-glow-breathe {
          0%,100% { transform: scale(0.92); opacity: 0.75; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        .gm-spark {
          position: absolute; border-radius: 9999px; background: #FFE9A8;
          box-shadow: 0 0 6px 1px rgba(244,180,0,0.65);
          opacity: 0; animation: gm-twinkle 3.4s ease-in-out infinite;
        }
        .gm-spark-1 { width: 7px; height: 7px; top: 6px;  right: 26px; animation-delay: 0s;   }
        .gm-spark-2 { width: 5px; height: 5px; top: 30px; left: 16px;  animation-delay: 0.9s; }
        .gm-spark-3 { width: 6px; height: 6px; bottom: 22px; right: 14px; animation-delay: 1.7s; }
        .gm-spark-4 { width: 4px; height: 4px; bottom: 8px;  left: 38px;  animation-delay: 2.5s; }
        @keyframes gm-twinkle {
          0%, 70%, 100% { opacity: 0; transform: scale(0.4); }
          12%, 22% { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .gm-crown-icon, .gm-crown-glow, .gm-spark, .gm-tick { animation: none; }
        }
      `}</style>
    </section>
  );
}
