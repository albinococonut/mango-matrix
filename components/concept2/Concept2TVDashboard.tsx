'use client';

// Concept2TVDashboard — the wall-mounted single-screen Mango Matrix in the
// concept2 design language. Parallel of components/TVDashboard.tsx (which
// stays as the production TV); this file inherits its exact pixel-lock and
// scale-to-fit math, every data fetch, and every tile composition. The
// CHROME is rebuilt with concept2's editorial vocabulary:
//   • atmospheric cream gradient surface (vs flat #faf9f7)
//   • frosted ivory tiles with a single hair-thin gold-thread accent
//   • Fraunces serif for shop names + hero numbers (via --font-display)
//   • Inter for UI labels (via --font-ui)
//   • restrained gold accents on the hero and on tile eyebrows
//   • high-contrast dark ink (#221F1A) on cream so 10–12 ft legibility is
//     preserved — the serif Fraunces at TV sizes (32–80 px) reads
//     beautifully across a shop floor; concept2's small-screen styling
//     (subtle 14 px copy) is intentionally NOT pulled forward here
//
// Pixel-locked at 1920×1080. The scale-to-fit transform fills any 16:9 TV
// (55", 65", 75", 85") without media queries.
//
// Layout (CSS Grid, 12px gap, 16px padding):
//
//   ┌───────────────────────────────────────────────────────┐
//   │ HERO — Golden Mango champion (full width, ~148 px)    │
//   ├──────────────┬─────────────────┬──────────────────────┤
//   │ Progress to  │ Call Conversion │ Re-Books             │
//   │ Goal         │                 │                      │
//   ├──────────────┼─────────────────┼──────────────────────┤
//   │ Pending      │ Tech            │ Comebacks ◷ Ratings  │
//   │ Trophies     │ Production      │ (split tile)         │
//   └──────────────┴─────────────────┴──────────────────────┘
//
// Auto-refreshes every 60 s. Live clock + last-updated timestamp in
// the bottom-right corner of the hero strip.

import React, { useEffect, useMemo, useState } from 'react';
import { Trophy, Award, Phone, Wrench, Repeat, RotateCcw, Target } from 'lucide-react';
import { TechCard } from '@/components/TechProduction';
import { SHOPS, SHOP_BY_NUM } from '@/lib/shops';
import { DEFAULT_GOALS, weeklyMinuteProrationRatio, revenueBandColor } from '@/lib/goals';
import { TrophyIcon } from '@/components/Trophy';

const GOLD = '#C9A227';
const GOLD_SOFT = 'rgba(201,162,39,0.28)';
// Concept2 chromatic anchors. INK is the deep editorial dark; INK2 is the
// secondary; FAINT is the muted UI label color. CREAM is the page wash.
const C2_INK = '#221F1A';
const C2_INK2 = '#3F3A33';
const C2_FAINT = 'rgba(34,32,28,0.55)';
const C2_LINE = 'rgba(34,32,28,0.10)';
// Font family hooks — these reference the CSS variables app/concept2/layout.tsx
// defines (Fraunces + Inter via next/font/google). Falls back to system
// stacks if the variable isn't on the rendering tree (e.g. preview screenshot).
const FF_DISPLAY = 'var(--font-display), Georgia, "Times New Roman", serif';
const FF_UI = 'var(--font-ui), -apple-system, system-ui, sans-serif';

// ---- Data shapes (loose — we only access what we render) -----------------

interface Champion {
  shopNum: string; shopName: string; score: number;
  medals: { gold: number; silver: number; bronze: number };
  revenue: number; gpPct: number; cars: number;
  defendingSince: string; isTie?: boolean; tiedShopNames?: string[];
}
interface ShopKpi { shopNum: string; shopName: string; revenue: number; gpPct: number; cars: number }
interface BookedRateShop { shopNum: string; shopName: string; bookedRatePct: number; bookedCalls?: number; totalCalls?: number }
// `techName` matches the field name returned by /api/tech-production (see
// app/api/tech-production/route.ts → rowsWithNames). The previous
// `technicianName` was always undefined so the UI fell back to "Tech #<id>".
interface TechRow { technicianId: number; techName?: string; shopNum: string; shopName: string; efficiency: number; billedHours: number; jobs: number }
interface FbrShop { shopNum: string; shopName: string; fbr: { fbrPct: number; forwardBookedROs: number; eligibleROs: number } }
interface ComebackShop { shopNum: string; shopName: string; comebackJobs: number; revenueLost?: number }

// ---- Helpers -------------------------------------------------------------

const usd0 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdK = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : usd0(n);
const pct = (n: number | null | undefined, digits = 0) => n == null ? '—' : `${(n * 100).toFixed(digits)}%`;
const pctDirect = (n: number | null | undefined, digits = 0) => n == null ? '—' : `${n.toFixed(digits)}%`;

function shopColor(num: string): string {
  return SHOP_BY_NUM[num as keyof typeof SHOP_BY_NUM]?.color || '#999';
}

function useCountdown(targetISO: string | null) {
  const [p, setP] = useState<{ d: number; h: number; m: number; s: number } | null>(null);
  useEffect(() => {
    if (!targetISO) return;
    const tick = () => {
      const ms = new Date(targetISO).getTime() - Date.now();
      if (ms <= 0) { setP({ d: 0, h: 0, m: 0, s: 0 }); return; }
      setP({
        d: Math.floor(ms / 86_400_000),
        h: Math.floor((ms % 86_400_000) / 3_600_000),
        m: Math.floor((ms % 3_600_000) / 60_000),
        s: Math.floor((ms % 60_000) / 1000),
      });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [targetISO]);
  return p;
}

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

// ---- Main component ------------------------------------------------------

export default function Concept2TVDashboard() {
  // -- data state
  const [championWrapper, setChampionWrapper] = useState<{ champion: Champion | null; nextCrownAt: string } | null>(null);
  const [metrics, setMetrics] = useState<{ kpi: { byShop: ShopKpi[] } } | null>(null);
  const [bookedRate, setBookedRate] = useState<{ shops: BookedRateShop[]; chain?: { bookedRatePct: number } } | null>(null);
  const [techs, setTechs] = useState<{ rows: TechRow[] } | null>(null);
  const [fbr, setFbr] = useState<{ shops: FbrShop[]; chain?: { fbrPct: number } } | null>(null);
  const [comebacks, setComebacks] = useState<{ shops: ComebackShop[] } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // -- fetch all data sources, refresh every 60 s
  useEffect(() => {
    let alive = true;
    const safe = async <T,>(url: string, ms = 25000): Promise<T | null> => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        try {
          const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
          if (!r.ok) return null;
          return await r.json();
        } finally { clearTimeout(timer); }
      } catch { return null; }
    };
    const refetch = async () => {
      const [gm, met, br, tk, fr, cb] = await Promise.all([
        safe<any>('/api/extras?view=golden-mango'),
        safe<any>('/api/metrics?range=this_week'),
        // Same endpoints the regular dashboard's AppointmentBookedRate
        // + FBRLeaderboard default to — these caches ARE populated. The
        // WTD-only variants (?wtd=1 / leaderboard_wtd) have a separate
        // cache that's been empty since Memorial Day.
        safe<any>('/api/extras?view=booked-rate&strict=1'),
        safe<any>('/api/tech-production?range=this_week'),
        safe<any>('/api/fbr?view=leaderboard'),
        safe<any>('/api/extras?view=comebacks&range=this_week'),
      ]);
      if (!alive) return;
      if (gm) setChampionWrapper(gm);
      if (met) setMetrics(met);
      if (br) setBookedRate(br);
      if (tk) setTechs(tk);
      if (fr) setFbr(fr);
      if (cb) setComebacks(cb);
      setLastUpdated(new Date());
    };
    refetch();
    const id = window.setInterval(refetch, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // -- scale-to-fit + center. The .tv-root is locked at 1920×1080. We
  //    scale to the tighter dimension AND translate to center the visual
  //    output in the viewport — without translation the scaled element
  //    sits in the top-left and looks like there's a giant blank gutter
  //    on the right/bottom when the browser isn't a perfect 16:9.
  useEffect(() => {
    const scaleTv = () => {
      const root = document.querySelector('.tv-root') as HTMLElement | null;
      if (!root) return;
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      const offsetX = Math.max(0, (window.innerWidth  - 1920 * scale) / 2);
      const offsetY = Math.max(0, (window.innerHeight - 1080 * scale) / 2);
      root.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    };
    scaleTv();
    window.addEventListener('resize', scaleTv);
    return () => window.removeEventListener('resize', scaleTv);
  }, []);

  const champion = championWrapper?.champion ?? null;
  const nextCrownAt = championWrapper?.nextCrownAt ?? null;

  return (
    <div style={{
      width: '100vw', height: '100vh', overflow: 'hidden',
      // Concept2 atmospheric wash — the same warm cream → gold-tint → blue-
      // tint gradient that lives behind every concept2 page, scaled up for
      // a TV. Renders as ambient color around the letterboxed 1920×1080
      // content when the host screen isn't a perfect 16:9.
      background: 'radial-gradient(120% 90% at 30% 10%, #FBFAF8 0%, #F5F4F1 45%, #EFEDE9 100%)',
      fontFamily: FF_UI,
      color: C2_INK,
    }}>
      <div className="tv-root" style={{
        width: 1920, height: 1080, transformOrigin: 'top left',
        // The .tv-root surface is a soft cream-on-cream gradient so tiles
        // (white-frosted) read as elevated panels floating on a warm bed
        // rather than white-on-white. Matches concept2 page surfaces.
        background: 'linear-gradient(160deg, #FBFAF8 0%, #F5F4F1 60%, #EEECE8 100%)',
        boxSizing: 'border-box', padding: 16, gap: 14,
        display: 'grid',
        gridTemplateRows: '160px 1fr 1fr',
        gridTemplateColumns: '1fr 1fr 1fr',
        gridTemplateAreas: `
          "hero hero hero"
          "left-top center-top right-top"
          "left-bot center-bot right-bot"
        `,
        fontFamily: FF_UI,
        color: C2_INK,
      }}>
        <HeroStrip champion={champion} nextCrownAt={nextCrownAt} lastUpdated={lastUpdated} />
        <ProgressToGoalTile area="left-top" metrics={metrics} />
        <CallConversionTile area="center-top" bookedRate={bookedRate} />
        <ReBooksTile area="right-top" fbr={fbr} />
        <PendingTrophiesTile area="left-bot" metrics={metrics} techs={techs} fbr={fbr} comebacks={comebacks} bookedRate={bookedRate} />
        <TechProductionTile area="center-bot" techs={techs} />
        <ComebacksAndRatingsTile area="right-bot" comebacks={comebacks} />
      </div>
    </div>
  );
}

// ===========================================================================
// HERO — Golden Mango champion
// ===========================================================================

function HeroStrip({ champion, nextCrownAt, lastUpdated }: {
  champion: Champion | null; nextCrownAt: string | null; lastUpdated: Date | null;
}) {
  const cd = useCountdown(nextCrownAt);
  const clock = useClock();
  const title = champion?.isTie ? (champion.tiedShopNames || [champion.shopName]).join(' · ') : champion?.shopName;

  // Champion shop photo path. The files are named "{num} team photo.jpg"
  // (with a literal space), so encodeURIComponent for safety in the URL.
  const championPhoto = champion?.shopNum
    ? `/shop-photos/${encodeURIComponent(`${champion.shopNum} team photo.jpg`)}`
    : null;

  // Per the TV-header redesign: hide eyebrow, countdown, clock+date,
  // and medal-tally dots. Promote "THE GOLDEN MANGO" to a large brand
  // title. Trophy is intentionally taller than the hero so its base
  // clips out the bottom (dramatic "bigger than the frame" effect).
  // Suppress unused-symbol warnings for things we still import but no
  // longer render on TV.
  void cd; void clock; void lastUpdated; void GOLD_SOFT;

  return (
    <div style={{
      gridArea: 'hero',
      borderRadius: 22,
      // Concept2 hero — a softly luminous ivory-to-warm-gold wash, deeper
      // than the page cream so the hero feels like a stage. Triple shadow:
      // 1 px inset gold thread, 1 px inset white highlight (depth),
      // outer drop-shadow for lift. Reads as a piece of editorial chrome.
      background: 'linear-gradient(140deg, #FEFEFE 0%, #F9F8F5 55%, #F3F1EC 100%)',
      boxShadow:
        'inset 0 0 0 1px rgba(201,162,39,0.32), ' +
        'inset 0 1px 0 rgba(255,255,255,0.75), ' +
        '0 18px 48px -28px rgba(40,34,26,0.22), ' +
        '0 2px 6px -2px rgba(40,34,26,0.06)',
      padding: '0 32px 0 0',           // photo fills left edge flush
      display: 'grid',
      gridTemplateColumns: 'auto auto 1fr',
      alignItems: 'center',
      gap: 28,
      position: 'relative',
      // overflow: visible so the trophy's stand can clip out the bottom
      overflow: 'visible',
    }}>
      {/* Top gold thread — concept2 signature accent. */}
      <div style={{ position: 'absolute', insetInline: 0, top: 0, height: 2, background: `linear-gradient(90deg, transparent 4%, ${GOLD} 50%, transparent 96%)`, borderTopLeftRadius: 22, borderTopRightRadius: 22 }} />

      {/* Champion shop photo — portrait container, full hero height, NO crop.
          object-fit:contain shows the entire photo; the cream background fills
          any letterbox bands when the photo's aspect ratio doesn't match. */}
      <div style={{
        width: 220, height: '100%', borderRadius: '22px 0 0 22px', overflow: 'hidden',
        background: '#F5F4F1',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
        boxShadow: 'inset -1px 0 0 rgba(34,32,28,0.06)',
      }}>
        {championPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={championPhoto} alt={`${champion?.shopName ?? 'Champion'} team`}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/logo.png" alt="Mango" style={{ height: 80, width: 'auto', opacity: 0.4 }} />
        )}
      </div>

      {/* Golden Mango trophy — sized so just an 8px peek clips below the
          hero (tasteful "bigger than the frame" effect without obscuring
          the section titles in the row below). */}
      <div style={{
        alignSelf: 'end',
        position: 'relative',
        marginBottom: -8,
        marginLeft: 4,
        zIndex: 2,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/the-golden-mango.png" alt="The Golden Mango Trophy"
          style={{
            height: 155, width: 'auto', display: 'block',
            filter: 'drop-shadow(0 4px 8px rgba(201,162,39,0.35))',
          }} />
      </div>

      {/* Right 2/3 of the hero: LEFT = brand eyebrow + champion serif
          name. RIGHT = 4 metric tiles in shop-aware concept2 panels.
          Faint gold divider between. */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minWidth: 0, paddingTop: 10, paddingBottom: 10 }}>
        {/* LEFT: editorial eyebrow + Fraunces champion name. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flexShrink: 0, justifyContent: 'center' }}>
          <div style={{
            fontFamily: FF_UI,
            fontSize: 14, fontWeight: 700, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: GOLD, lineHeight: 1.1,
          }}>
            The Golden Mango
          </div>
          {champion ? (
            // Fraunces serif — the same display face every concept2
            // headline uses. At 72 px on a TV it reads as an editorial
            // cover-line: confident, named, no decoration. lineHeight:1
            // keeps it tight against the eyebrow; whiteSpace:nowrap +
            // outer overflow:visible give descenders (g, p, y) room.
            <div style={{
              fontFamily: FF_DISPLAY,
              fontSize: 72, fontWeight: 500, color: C2_INK, lineHeight: 1,
              letterSpacing: '-0.025em', whiteSpace: 'nowrap',
              marginTop: 2,
            }}>
              {title}
            </div>
          ) : (
            <div style={{
              fontFamily: FF_DISPLAY,
              fontSize: 56, fontWeight: 500, color: '#9A8F7F',
              letterSpacing: '-0.025em', marginTop: 4,
            }}>
              Crown loading…
            </div>
          )}
        </div>

        {/* Divider — concept2 hair-thin gold thread, vertical. */}
        <div style={{
          width: 1, height: 110,
          background: 'linear-gradient(transparent, rgba(201,162,39,0.42), transparent)',
          flexShrink: 0, margin: '0 36px 0 52px', alignSelf: 'center',
        }} />

        {/* RIGHT: 4 metric tiles — concept2 frosted panels with Fraunces
            tabular numbers and Inter caps labels. Color coding kept (the
            chromatic anchors a wall viewer reads from distance) but
            saturation pulled down so the panels feel like ivory tiles
            tinted by the metric, not bold colored cards. */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
          <div style={{
            fontFamily: FF_UI,
            fontSize: 13, fontWeight: 700, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: GOLD,
            lineHeight: 1, marginBottom: 4, opacity: 0.7,
          }}>
            This Week · {title ?? '—'}
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', width: '100%' }}>
            {champion && [
              { value: String(champion.score),                            label: 'Score',   color: '#A07E18', bg: 'rgba(201,162,39,0.10)', border: 'rgba(201,162,39,0.30)' },
              { value: usd0(champion.revenue),                            label: 'Revenue', color: '#2F6E3A', bg: 'rgba(91,170,89,0.10)',  border: 'rgba(91,170,89,0.30)'  },
              { value: `${(champion.gpPct * 100).toFixed(1)}%`,           label: 'GP%',     color: '#21527A', bg: 'rgba(95,169,214,0.12)', border: 'rgba(95,169,214,0.32)' },
              { value: String(champion.cars),                             label: 'Cars',    color: '#5B3B86', bg: 'rgba(139,90,193,0.10)', border: 'rgba(139,90,193,0.30)' },
            ].map(m => (
              <div key={m.label} style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                padding: '14px 22px', borderRadius: 14,
                background: m.bg,
                boxShadow: `inset 0 0 0 1px ${m.border}, inset 0 1px 0 rgba(255,255,255,0.65)`,
                gap: 6,
              }}>
                <span style={{ fontFamily: FF_DISPLAY, fontSize: 34, fontWeight: 600, color: m.color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', lineHeight: 1 }}>{m.value}</span>
                <span style={{ fontFamily: FF_UI, fontSize: 11, fontWeight: 700, letterSpacing: '0.20em', textTransform: 'uppercase', color: C2_FAINT, lineHeight: 1, marginTop: 2 }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Stat helper was used by the old stats row (Score / Revenue / GP% / Cars
// inline). Replaced by the colored tiles in HeroStrip's RIGHT panel.
// Keeping the function around as a no-op export would invite drift — just
// delete it. Removed.

function formatRelative(d: Date): string {
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return `${Math.floor(diffSec / 3600)}h ago`;
}

// ===========================================================================
// Shared tile wrapper
// ===========================================================================

function Tile({ area, icon, title, children, headerRight }: {
  area: string; icon: React.ReactNode; title: string;
  children: React.ReactNode; headerRight?: React.ReactNode;
}) {
  return (
    <section style={{
      gridArea: area,
      // Concept2 tile: warm white-ivory frosted surface, double inset shadow
      // (1 px line + 1 px highlight) + soft drop-shadow for lift. Matches
      // the kit's frostCard() pattern on the rest of concept2.
      background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(253,250,242,0.86))',
      borderRadius: 18,
      boxShadow:
        'inset 0 0 0 1px rgba(34,32,28,0.08), ' +
        'inset 0 1px 0 rgba(255,255,255,0.85), ' +
        '0 18px 36px -22px rgba(40,34,26,0.20), ' +
        '0 2px 4px -2px rgba(40,34,26,0.06)',
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Hair-thin gold thread at the top — concept2 signature accent that
          links every tile back to the hero. Subtle enough not to distract,
          present enough that a viewer reads them as a series. */}
      <div style={{
        position: 'absolute', insetInline: 18, top: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${GOLD}66 50%, transparent)`,
      }} />
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: GOLD, display: 'inline-flex', opacity: 0.85 }}>{icon}</span>
          <h3 style={{
            fontFamily: FF_DISPLAY,
            fontSize: 22, fontWeight: 500, letterSpacing: '-0.015em',
            color: C2_INK, margin: 0, lineHeight: 1,
          }}>
            {title}
          </h3>
        </div>
        {headerRight}
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </section>
  );
}

// ===========================================================================
// LEFT TOP — Progress to Goal (revenue % vs weekly goal)
// ===========================================================================

function ProgressToGoalTile({ area, metrics }: { area: string; metrics: { kpi: { byShop: ShopKpi[] } } | null }) {
  const rows = useMemo(() => {
    if (!metrics?.kpi?.byShop) return [];
    return metrics.kpi.byShop.map(s => {
      const goal = DEFAULT_GOALS[s.shopNum]?.revenueWeekly ?? 0;
      const proration = goal > 0 ? weeklyMinuteProrationRatio(s.shopNum) : 1;
      const proratedGoal = goal * proration;
      const ratio = proratedGoal > 0 ? s.revenue / proratedGoal : null;
      return { shop: s, goal, ratio };
    }).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  }, [metrics]);

  return (
    <Tile area={area} icon={<Target size={20} />} title="Progress to Goal · This Week">
      {rows.length === 0 ? <Loading /> : (
        <Ranked rows={rows.slice(0, 8)} renderRow={(r, i) => (
          <RankedRow
            i={i}
            shopNum={r.shop.shopNum}
            shopName={r.shop.shopName}
            primary={<span style={{ color: revenueBandColor(r.ratio) }}>{pct(r.ratio, 0)}</span>}
            secondary={`${usdK(r.shop.revenue)} of ${usdK(r.goal)}`}
          />
        )} />
      )}
    </Tile>
  );
}

// ===========================================================================
// CENTER TOP — Call Conversion (booked-rate WTD)
// ===========================================================================

function CallConversionTile({ area, bookedRate }: { area: string; bookedRate: { shops: BookedRateShop[]; chain?: { bookedRatePct: number }; warming?: boolean } | null }) {
  const rows = useMemo(() => {
    if (!bookedRate?.shops) return [];
    return [...bookedRate.shops].sort((a, b) => b.bookedRatePct - a.bookedRatePct);
  }, [bookedRate]);
  const chainPct = bookedRate?.chain?.bookedRatePct ?? null;
  const warming = !!bookedRate?.warming;

  return (
    <Tile area={area} icon={<Phone size={20} />} title="Call Conversion"
      headerRight={chainPct != null && !warming && (
        <span style={{ fontFamily: FF_DISPLAY, fontSize: 26, fontWeight: 600, color: C2_INK, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.015em' }}>
          {chainPct.toFixed(0)}% <span style={{ fontSize: 11, color: '#9A8F7F', fontWeight: 600 }}>chain</span>
        </span>
      )}>
      {rows.length === 0 ? (
        <Loading message={
          bookedRate == null ? 'Loading…'
          : warming ? 'Warming up — next cron tick will populate (every 15 min).'
          : 'No data this week yet.'
        } />
      ) : (
        <Ranked rows={rows.slice(0, 8)} renderRow={(s, i) => (
          <RankedRow
            i={i}
            shopNum={s.shopNum}
            shopName={s.shopName}
            primary={<span style={{ color: s.bookedRatePct >= 70 ? '#1A8754' : s.bookedRatePct >= 55 ? '#A37700' : '#B23A48' }}>
              {s.bookedRatePct.toFixed(0)}%
            </span>}
            secondary={typeof s.bookedCalls === 'number' && typeof s.totalCalls === 'number' ? `${s.bookedCalls} / ${s.totalCalls} calls` : undefined}
          />
        )} />
      )}
    </Tile>
  );
}

// ===========================================================================
// RIGHT TOP — Re-Books (fbr leaderboard WTD)
// ===========================================================================

function ReBooksTile({ area, fbr }: { area: string; fbr: { shops: FbrShop[]; chain?: { fbrPct: number }; warming?: boolean } | null }) {
  const rows = useMemo(() => {
    if (!fbr?.shops) return [];
    return [...fbr.shops].sort((a, b) => (b.fbr?.fbrPct ?? 0) - (a.fbr?.fbrPct ?? 0));
  }, [fbr]);
  const chainPct = fbr?.chain?.fbrPct ?? null;
  const warming = !!fbr?.warming;

  return (
    <Tile area={area} icon={<Repeat size={20} />} title="Re-Books"
      headerRight={chainPct != null && !warming && (
        <span style={{ fontFamily: FF_DISPLAY, fontSize: 26, fontWeight: 600, color: C2_INK, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.015em' }}>
          {(chainPct * 100).toFixed(0)}% <span style={{ fontSize: 11, color: '#9A8F7F', fontWeight: 600 }}>chain</span>
        </span>
      )}>
      {rows.length === 0 ? (
        <Loading message={
          fbr == null ? 'Loading…'
          : warming ? 'Warming up — next cron tick will populate (every 15 min).'
          : 'No data this week yet.'
        } />
      ) : (
        <Ranked rows={rows.slice(0, 8)} renderRow={(s, i) => (
          <RankedRow
            i={i}
            shopNum={s.shopNum}
            shopName={s.shopName}
            primary={<span style={{ color: s.fbr?.fbrPct >= 0.35 ? '#1A8754' : s.fbr?.fbrPct >= 0.20 ? '#A37700' : '#B23A48' }}>
              {((s.fbr?.fbrPct ?? 0) * 100).toFixed(0)}%
            </span>}
            secondary={`${s.fbr?.forwardBookedROs ?? 0} of ${s.fbr?.eligibleROs ?? 0}`}
          />
        )} />
      )}
    </Tile>
  );
}

// ===========================================================================
// LEFT BOTTOM — Pending Trophies (compact: top 3 + honorable mentions)
// ===========================================================================

function PendingTrophiesTile({ area, metrics, techs, fbr, comebacks, bookedRate }: {
  area: string;
  metrics: { kpi: { byShop: ShopKpi[] } } | null;
  techs: { rows: TechRow[] } | null;
  fbr: { shops: FbrShop[] } | null;
  comebacks: { shops: ComebackShop[] } | null;
  bookedRate: { shops: BookedRateShop[] } | null;
}) {
  // Award gold/silver/bronze across categories, identical scoring to TrophyTally.
  const summary = useMemo(() => {
    const tally: Record<string, { gold: number; silver: number; bronze: number }> = {};
    for (const s of SHOPS) tally[s.num] = { gold: 0, silver: 0, bronze: 0 };
    const award = (ranking: string[]) => {
      ranking.slice(0, 3).forEach((shopNum, i) => {
        if (!tally[shopNum]) return;
        if (i === 0) tally[shopNum].gold++;
        else if (i === 1) tally[shopNum].silver++;
        else tally[shopNum].bronze++;
      });
    };
    if (metrics?.kpi?.byShop) {
      award([...metrics.kpi.byShop].sort((a, b) => b.revenue - a.revenue).map(x => x.shopNum));
      award([...metrics.kpi.byShop].sort((a, b) => b.gpPct - a.gpPct).map(x => x.shopNum));
    }
    if (techs?.rows) award([...techs.rows].sort((a, b) => b.efficiency - a.efficiency).map(x => x.shopNum));
    if (fbr?.shops) award([...fbr.shops].sort((a, b) => (b.fbr?.fbrPct ?? 0) - (a.fbr?.fbrPct ?? 0)).map(x => x.shopNum));
    if (comebacks?.shops) award([...comebacks.shops].sort((a, b) => a.comebackJobs - b.comebackJobs).map(x => x.shopNum));
    if (bookedRate?.shops) award([...bookedRate.shops].sort((a, b) => b.bookedRatePct - a.bookedRatePct).map(x => x.shopNum));
    return SHOPS
      .map(s => ({ shop: s, ...tally[s.num] }))
      .filter(x => x.gold + x.silver + x.bronze > 0)
      .sort((a, b) => (b.gold * 100 + b.silver * 10 + b.bronze) - (a.gold * 100 + a.silver * 10 + a.bronze));
  }, [metrics, techs, fbr, comebacks, bookedRate]);

  return (
    <Tile area={area} icon={<Award size={20} />} title="Pending Trophies · This Week">
      {summary.length === 0 ? <Loading /> : (
        // One row per shop with medals, spread evenly to fill the tile.
        // Big medal-count chips so even from across the room the leaderboard
        // is legible. Previous design wasted ~40% of the tile on bordered
        // top-3 cards + tiny chips for everyone else.
        <ul style={{
          listStyle: 'none', padding: 0, margin: 0,
          display: 'flex', flexDirection: 'column',
          flex: 1, minHeight: 0, justifyContent: 'space-between',
        }}>
          {summary.map((s, i) => {
            const totalScore = s.gold * 100 + s.silver * 10 + s.bronze;
            return (
              <li key={s.shop.num} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                height: 42,
                borderBottom: i < summary.length - 1 ? '1px solid #F0EDE6' : 'none',
              }}>
                <span style={{ width: 22, textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#9A8F7F', fontVariantNumeric: 'tabular-nums' }}>
                  {i + 1}
                </span>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.shop.color }} />
                <span style={{ flex: 1, fontSize: 18, fontWeight: 600, color: '#1F2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.shop.name}
                </span>
                {/* Medal counts — only render the buckets the shop earned, so
                    the row stays clean for low-trophy shops. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {s.gold > 0 && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', borderRadius: 6,
                      background: 'linear-gradient(180deg, #FEF3C7 0%, #FDE68A 100%)',
                      fontSize: 18, fontWeight: 800, color: '#1F2937',
                    }}>
                      <TrophyIcon rank={1} size={16} />{s.gold}
                    </span>
                  )}
                  {s.silver > 0 && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      padding: '3px 7px', borderRadius: 6,
                      background: '#F3F4F6',
                      fontSize: 16, fontWeight: 700, color: '#1F2937',
                    }}>
                      <TrophyIcon rank={2} size={14} />{s.silver}
                    </span>
                  )}
                  {s.bronze > 0 && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      padding: '3px 7px', borderRadius: 6,
                      background: '#FBEAD8',
                      fontSize: 16, fontWeight: 700, color: '#1F2937',
                    }}>
                      <TrophyIcon rank={3} size={14} />{s.bronze}
                    </span>
                  )}
                </div>
                {/* Composite score so the ordering is legible */}
                <span style={{ minWidth: 36, textAlign: 'right', fontSize: 13, color: '#9A8F7F', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {totalScore}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Tile>
  );
}

// ===========================================================================
// CENTER BOTTOM — Tech Production (top 5 techs)
// ===========================================================================

function TechProductionTile({ area, techs }: { area: string; techs: { rows: TechRow[] } | null }) {
  const top = useMemo(() => {
    if (!techs?.rows) return [];
    return [...techs.rows].sort((a, b) => b.efficiency - a.efficiency).slice(0, 6);
  }, [techs]);

  // 3 cols × 2 rows of the COMPACT TechCard variant. Compact keeps every
  // component of the dashboard card (frame, rank medallion, power-level
  // stars, themed art window with mango/rays/sparkles, name plate, stat
  // block) — just with smaller art (108px tall, 76px mango) so the card's
  // natural height (~195px) fits each grid cell without a transform.
  return (
    <Tile area={area} icon={<Wrench size={20} />} title="Top Techs · This Week">
      {top.length === 0 ? <Loading /> : (
        <div style={{
          display: 'grid',
          // `minmax(0, 1fr)` — not `1fr` — so columns/rows shrink below the
          // cards' intrinsic content size. Without the minmax, the 3rd
          // column was pushing off the right edge of the tile because each
          // card's min-content was larger than the per-column allowance.
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
          gap: 6,
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}>
          {top.map((t, i) => (
            <TechCard key={t.technicianId} r={t} rank={i + 1} onClick={() => {}} variant="compact" />
          ))}
        </div>
      )}
    </Tile>
  );
}

// ===========================================================================
// RIGHT BOTTOM — Comebacks (top half) + Google Ratings (bottom half)
// ===========================================================================

function ComebacksAndRatingsTile({ area, comebacks }: {
  area: string;
  comebacks: { shops: ComebackShop[] } | null;
}) {
  // Show ALL shops that had a comeback this week, ranked by REVENUE LOST
  // (worst first). The previous count-only ranking told you nothing about
  // impact — one $40 oil-change comeback ≠ one $1,200 brake comeback.
  const rows = useMemo(() => {
    if (!comebacks?.shops) return [];
    return [...comebacks.shops]
      .filter(s => (s.comebackJobs || 0) > 0)
      .sort((a, b) => (b.revenueLost ?? 0) - (a.revenueLost ?? 0));
  }, [comebacks]);
  const cbTotal = comebacks?.shops?.reduce((s, x) => s + x.comebackJobs, 0) ?? 0;
  const cbRevLost = comebacks?.shops?.reduce((s, x) => s + (x.revenueLost ?? 0), 0) ?? 0;

  return (
    <Tile area={area} icon={<RotateCcw size={20} />} title="Comebacks · This Week"
      headerRight={(
        <span style={{ fontFamily: FF_DISPLAY, fontSize: 26, fontWeight: 600, color: C2_INK, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.015em' }}>
          {usdK(cbRevLost)} <span style={{ fontSize: 11, color: '#9A8F7F', fontWeight: 600 }}>lost · {cbTotal} jobs</span>
        </span>
      )}>
      {comebacks == null ? <Loading /> : rows.length === 0 ? (
        <Loading message="No comebacks this week ✓" />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, justifyContent: 'space-between' }}>
          {rows.map((s, i) => (
            <li key={s.shopNum} style={{
              display: 'flex', alignItems: 'center', gap: 12, height: 38,
              // Drop the trailing rule on the last row so the list doesn't
              // look like it has more entries scrolled below.
              borderBottom: i < rows.length - 1 ? '1px solid #F0EDE6' : 'none',
            }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: shopColor(s.shopNum) }} />
              <span style={{ flex: 1, fontSize: 20, fontWeight: 600, color: '#1F2937' }}>{s.shopName}</span>
              <span style={{ fontSize: 13, color: '#9A8F7F', fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' }}>
                {s.comebackJobs} {s.comebackJobs === 1 ? 'job' : 'jobs'}
              </span>
              <span style={{
                fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: (s.revenueLost ?? 0) >= 1000 ? '#B23A48' : (s.revenueLost ?? 0) >= 500 ? '#A37700' : '#6B7280',
                minWidth: 90, textAlign: 'right',
              }}>
                {usdK(s.revenueLost ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

// ===========================================================================
// Shared building blocks
// ===========================================================================

function Loading({ message = 'Loading…' }: { message?: string }) {
  return <div style={{ color: '#C9C2B5', fontSize: 14, fontStyle: 'italic', padding: 12 }}>{message}</div>;
}

function Ranked<T>({ rows, renderRow }: { rows: T[]; renderRow: (r: T, i: number) => React.ReactNode }) {
  // justify-content: space-between spreads rows evenly to fill the tile
  // height instead of bunching them at the top with a big blank gutter
  // below. Combined with a flex: 1 list item, each row gets equal space.
  return (
    <ul style={{
      listStyle: 'none', padding: 0, margin: 0,
      display: 'flex', flexDirection: 'column',
      flex: 1, minHeight: 0,
      justifyContent: 'space-between',
    }}>
      {rows.map((r, i) => (
        <li key={i} style={{
          borderBottom: i < rows.length - 1 ? `1px solid ${C2_LINE}` : 'none',
          flex: 1,
          display: 'flex', alignItems: 'center',
        }}>
          {renderRow(r, i)}
        </li>
      ))}
    </ul>
  );
}

function RankedRow({ i, shopNum, shopName, primary, secondary }: {
  i: number; shopNum: string; shopName: string;
  primary: React.ReactNode; secondary?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 42 }}>
      <span style={{ fontFamily: FF_UI, width: 22, textAlign: 'right', fontSize: 15, fontWeight: 700, color: C2_FAINT, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
      {i < 3 && <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={18} />}
      {!(i < 3) && <span style={{ width: 18 }} />}
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: shopColor(shopNum), boxShadow: `0 0 0 3px ${shopColor(shopNum)}22` }} />
      <span style={{ fontFamily: FF_DISPLAY, flex: 1, fontSize: 22, fontWeight: 500, color: C2_INK, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {shopName}
      </span>
      <span style={{ fontFamily: FF_DISPLAY, fontSize: 30, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.015em', minWidth: 84, textAlign: 'right' }}>
        {primary}
      </span>
      {secondary && (
        <span style={{ fontFamily: FF_UI, fontSize: 13, color: C2_FAINT, minWidth: 118, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {secondary}
        </span>
      )}
    </div>
  );
}

// Reduce unused-import noise (Trophy icon from lucide is unused at this depth).
void Trophy;
