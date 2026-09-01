'use client';

// Trophy Tally — celebratory summary of who won each category this week.
// Fetches every category endpoint, computes gold/silver/bronze winners, and
// renders a card with clickable shop chips. Clicking a chip opens a modal
// showing exactly which categories that shop placed in.

import { useEffect, useMemo, useState } from 'react';
import { Award } from 'lucide-react';
import { toZonedTime } from 'date-fns-tz';
import { SHOPS } from '@/lib/shops';
import { TrophyIcon } from './Trophy';

/**
 * Trophy phase by clock:
 *   - "awarded":  Mon 6:00 PM MT → Tue 7:30 AM MT (~13.5 h celebration
 *                 window after the weekly awards ceremony)
 *   - "pending":  Tue 7:30 AM MT → next Mon 6:00 PM MT (most of the
 *                 week — competition is open, trophies accumulating)
 * The page polls this every minute so it flips at the boundary without a
 * manual refresh.
 */
function trophyPhase(now: Date = new Date()): 'pending' | 'awarded' {
  const mt = toZonedTime(now, 'America/Denver');
  const dow = mt.getDay();      // 0=Sun, 1=Mon, 2=Tue, 5=Fri, 6=Sat
  const minutes = mt.getHours() * 60 + mt.getMinutes();
  // Awarded window: Fri 6 PM → Tue 7:30 AM MT (trophy ceremony is Friday evening)
  if (dow === 5 && minutes >= 18 * 60) return 'awarded'; // Fri 6 PM onward
  if (dow === 6) return 'awarded';                        // All Saturday
  if (dow === 0) return 'awarded';                        // All Sunday
  if (dow === 1) return 'awarded';                        // All Monday
  if (dow === 2 && minutes < 7 * 60 + 30) return 'awarded'; // Tue before 7:30 AM
  // Competing window: Tue 7:30 AM → Fri 6 PM
  return 'pending';
}

interface ShopMetrics { shopNum: string; shopName: string; revenue: number; gpPct: number }
interface TechRow { technicianId: number; shopNum: string; shopName: string; efficiency: number; billedHours: number }
interface FbrRow { shopNum: string; shopName: string; fbr: { fbrPct: number; forwardBookedROs: number; eligibleROs: number } }
interface ComebackRow { shopNum: string; shopName: string; comebackJobs: number }
interface GoogleRow { shopNum: string; shopName: string; fiveStar: number; recentTotal: number }
interface ConversionRow { shopNum: string; shopName: string; bookedRatePct: number }

type Category = 'revenue' | 'gp' | 'tech' | 'rebook' | 'comebacks' | 'reviews' | 'conversion' | 'todo' | 'sales_eff';
// Pending Trophies uses Mon→today MT only. Re-Books and Call Conversion are
// now fetched from dedicated week-to-date endpoints (cron-derived from the
// SAME trailing-7 raw fetches, no extra Tekmetric/WhatConverts cost). Reviews
// stay excluded until Google Business Profile API access is wired up — the
// current Google Places v1 data is too unreliable for trophy awards.
const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'revenue',         label: 'Revenue' },
  { key: 'gp',              label: 'GP%' },
  { key: 'tech',            label: 'Top Tech' },
  { key: 'rebook',          label: 'Most Re-Books' },
  { key: 'comebacks',       label: 'Fewest Comebacks' },
  { key: 'conversion',      label: 'Highest Call Conversion' },
  { key: 'todo',            label: 'Most To-Do Items Checked Off' },
  { key: 'sales_eff',       label: 'Sales Effectiveness' },
];
interface TodoRecRow { shopNum: string; shopName: string; count: number }
interface SalesEffRow { shopNum: string; shopName: string; avgScore: number; totalGraded: number }

export default function TrophyTally() {
  const [metrics, setMetrics] = useState<ShopMetrics[] | null>(null);
  const [techs, setTechs] = useState<TechRow[] | null>(null);
  const [fbr, setFbr] = useState<FbrRow[] | null>(null);
  const [comebacks, setComebacks] = useState<ComebackRow[] | null>(null);
  const [reviews, setReviews] = useState<GoogleRow[] | null>(null);
  const [conversion, setConversion] = useState<ConversionRow[] | null>(null);
  const [todoRec, setTodoRec] = useState<TodoRecRow[] | null>(null);
  const [salesEff, setSalesEff] = useState<SalesEffRow[] | null>(null);
  const [selectedShop, setSelectedShop] = useState<string | null>(null);
  // Phase ticks each minute so the page flips at the 7:30 AM / 6 PM Mon
  // boundaries without a manual refresh.
  const [phase, setPhase] = useState<'pending' | 'awarded'>(() => trophyPhase());
  useEffect(() => {
    const id = setInterval(() => setPhase(trophyPhase()), 60_000);
    return () => clearInterval(id);
  }, []);
  const isAwarded = phase === 'awarded';

  useEffect(() => {
    const safe = async <T,>(url: string): Promise<T | null> => {
      try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch { return null; }
    };
    safe<any>('/api/metrics?range=this_week').then(d => {
      if (!d?.kpi?.byShop) return;
      setMetrics(d.kpi.byShop.map((s: any) => ({ shopNum: s.shopNum, shopName: s.shopName, revenue: s.revenue, gpPct: s.gpPct })));
    });
    safe<any>('/api/tech-production?range=this_week').then(d => setTechs(d?.rows || []));
    // WTD endpoints: Mon→today subset of the same trailing-7 raw fetches.
    // Existing trailing-7 endpoints (`view=leaderboard`, `&strict=1`) are
    // still used elsewhere in the dashboard and are untouched.
    safe<any>('/api/fbr?view=leaderboard_wtd').then(d => setFbr(d?.shops || []));
    safe<any>('/api/extras?view=comebacks&range=this_week').then(d => setComebacks(d?.shops || []));
    safe<any>('/api/extras?view=google-ratings').then(d => setReviews(d?.shops || []));
    safe<any>('/api/extras?view=booked-rate&wtd=1').then(d => setConversion(d?.shops || []));
    safe<any>('/api/extras?view=todo-recoveries&window=this_week').then(d => setTodoRec(d?.shops || []));
    safe<any>('/api/extras?view=sales-effectiveness').then(d => setSalesEff(d?.shops || []));
  }, []);

  const rankings = useMemo(() => {
    const r: Record<Category, string[]> = { revenue: [], gp: [], tech: [], rebook: [], comebacks: [], reviews: [], conversion: [], todo: [], sales_eff: [] };
    if (metrics)    r.revenue   = [...metrics].sort((a, b) => b.revenue - a.revenue).map(x => x.shopNum);
    if (metrics)    r.gp        = [...metrics].sort((a, b) => b.gpPct - a.gpPct).map(x => x.shopNum);
    if (techs)      r.tech      = [...techs].sort((a, b) => b.efficiency - a.efficiency).map(x => x.shopNum);
    if (fbr)        r.rebook    = [...fbr].sort((a, b) => (b.fbr?.fbrPct ?? 0) - (a.fbr?.fbrPct ?? 0)).map(x => x.shopNum);
    if (comebacks)  r.comebacks = [...comebacks].sort((a, b) => a.comebackJobs - b.comebackJobs).map(x => x.shopNum);
    // Only award the reviews trophy when we actually have review totals. While
    // GBP API access is pending (all fiveStar = 0) the category is skipped
    // entirely; it auto-resumes the moment any shop has a non-zero total.
    if (reviews && reviews.some(x => (x.fiveStar ?? 0) > 0)) {
      r.reviews = [...reviews].sort((a, b) => b.fiveStar - a.fiveStar).map(x => x.shopNum);
    }
    if (conversion) r.conversion = [...conversion].sort((a, b) => b.bookedRatePct - a.bookedRatePct).map(x => x.shopNum);
    // To-Do recoveries — rank DESC by count, drop shops with 0 so a fully
    // empty cohort doesn't back into bronze.
    if (todoRec) r.todo = [...todoRec].filter(x => (x.count ?? 0) > 0).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).map(x => x.shopNum);
    if (salesEff) r.sales_eff = [...salesEff].filter(x => (x.totalGraded ?? 0) > 0).sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0)).map(x => x.shopNum);
    return r;
  }, [metrics, techs, fbr, comebacks, reviews, conversion, todoRec, salesEff]);

  const trophies = useMemo(() => {
    const out: Record<string, { gold: number; silver: number; bronze: number; by: Partial<Record<Category, 1 | 2 | 3>> }> = {};
    for (const s of SHOPS) out[s.num] = { gold: 0, silver: 0, bronze: 0, by: {} };
    for (const cat of CATEGORIES) {
      rankings[cat.key].slice(0, 3).forEach((shopNum, i) => {
        if (!out[shopNum]) return;
        const rank = (i + 1) as 1 | 2 | 3;
        out[shopNum].by[cat.key] = rank;
        if (rank === 1) out[shopNum].gold++;
        else if (rank === 2) out[shopNum].silver++;
        else out[shopNum].bronze++;
      });
    }
    return out;
  }, [rankings]);

  const summary = useMemo(() => SHOPS
    .map(s => ({ shop: s, ...trophies[s.num] }))
    .filter(x => x.gold + x.silver + x.bronze > 0)
    .sort((a, b) => (b.gold * 100 + b.silver * 10 + b.bronze) - (a.gold * 100 + a.silver * 10 + a.bronze)),
  [trophies]);

  if (summary.length === 0) return null;

  return (
    <>
      <div className="card mb-8 relative overflow-hidden"
        style={{ background: 'linear-gradient(140deg,#FFFCF4 0%,#FDF6E7 55%,#FCF1DC 100%)', boxShadow: 'inset 0 0 0 1px rgba(201,162,39,0.22), 0 1px 3px rgba(31,41,55,0.04)' }}>
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: 'linear-gradient(90deg, transparent, #C9A227, transparent)' }} />
        <div className="relative">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-full"
              style={{ background: 'rgba(201,162,39,0.12)', boxShadow: 'inset 0 0 0 1px rgba(201,162,39,0.28)' }}>
              <Award className="w-[18px] h-[18px]" style={{ color: '#C9A227' }} />
            </span>
            <div>
              <h2 className="section-h">{isAwarded ? 'Awarded' : 'Pending'} Trophies · This Week</h2>
              <p className="section-sub mt-0.5">
                {isAwarded
                  ? 'Trophies for the week are locked in. New week begins Tuesday 7:30 AM MT.'
                  : 'This week (Mon → today), finishing 1st / 2nd / 3rd in a category earns a 🥇/🥈/🥉 — most trophies leads.'}
              </p>
            </div>
          </div>
          <p className="text-[11px] font-medium text-mango-faint mb-2">
            Counted this week: {CATEGORIES.map(c => c.label).join(' · ')}
            <span className="text-mango-faint/70"> · (5★ Reviews paused — Google Business Profile API access pending)</span>
          </p>
          {/* Top 3 — big spotlight cards in a 3-up grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
            {summary.slice(0, 3).map((s, rank) => {
              const total = s.gold + s.silver + s.bronze;
              const rankColor = rank === 0 ? '#F5C518' : rank === 1 ? '#9CA3AF' : '#C2814B';
              return (
                <button key={s.shop.num} onClick={() => setSelectedShop(s.shop.num)}
                  className="group relative flex flex-col items-stretch gap-3 p-4 rounded-2xl hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
                  style={
                    isAwarded
                      // AWARDED look: solid border, full saturation, stronger
                      // rank tint — feels "locked in" / celebratory.
                      ? {
                          background: '#FFFFFF',
                          border: `1.5px solid ${rankColor}`,
                          boxShadow: `0 2px 6px rgba(31,41,55,0.05), 0 0 0 3px ${rankColor}1A`,
                        }
                      // PENDING look: not awarded yet — desaturated/greyed with
                      // only a faint hint of the rank color so it's still
                      // identifiable, soft dashed border, no celebration FX.
                      : {
                          background: '#FBFAF7',
                          border: `1.5px dashed ${rankColor}80`,
                          boxShadow: '0 1px 2px rgba(31,41,55,0.04)',
                          filter: 'saturate(0.7)',
                        }
                  }>
                  {/* rank tint wash — stronger when awarded, faint when pending */}
                  <div className="absolute inset-0 pointer-events-none rounded-2xl"
                    style={{ background: isAwarded ? `${rankColor}22` : `${rankColor}14` }} />
                  {/* status indicator — spinner+Pending OR static check+Awarded */}
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10">
                    {isAwarded ? (
                      <>
                        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold text-white"
                          style={{ background: rankColor }}>✓</span>
                        <span className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: rankColor }}>Awarded</span>
                      </>
                    ) : (
                      <>
                        <span className="trophy-spin inline-block w-3.5 h-3.5 rounded-full"
                          style={{ border: `2px solid ${rankColor}55`, borderTopColor: rankColor }} />
                        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-mango-faint">Pending</span>
                      </>
                    )}
                  </div>
                  <div className="relative flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full ring-2 ring-white shrink-0" style={{ background: s.shop.color }} />
                    <div className="text-left flex-1 min-w-0">
                      <div className="font-bold text-base leading-tight truncate">{s.shop.name}</div>
                      <div className="text-[10px] text-mango-muted uppercase tracking-wide">{total} {total === 1 ? 'trophy' : 'trophies'}</div>
                    </div>
                  </div>
                  <div className="relative flex items-center justify-center gap-2">
                    {s.gold > 0 && (
                      <span className="inline-flex items-center gap-1 text-2xl font-extrabold tabular-nums px-3 py-1.5 rounded-lg shadow-sm" style={{ background: 'linear-gradient(180deg, #FEF3C7 0%, #FDE68A 100%)' }}>
                        <TrophyIcon rank={1} size={30} />{s.gold}
                      </span>
                    )}
                    {s.silver > 0 && (
                      <span className="inline-flex items-center gap-1 text-xl font-bold tabular-nums px-2.5 py-1.5 rounded-lg" style={{ background: '#F3F4F6' }}>
                        <TrophyIcon rank={2} size={22} />{s.silver}
                      </span>
                    )}
                    {s.bronze > 0 && (
                      <span className="inline-flex items-center gap-1 text-xl font-bold tabular-nums px-2.5 py-1.5 rounded-lg" style={{ background: '#FBEAD8' }}>
                        <TrophyIcon rank={3} size={22} />{s.bronze}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Honorable mentions: rank 4+ as a compact horizontal list */}
          {summary.length > 3 && (
            <div className="mt-4 pt-4 border-t border-mango-line/60">
              <div className="text-[11px] text-mango-muted uppercase tracking-wide font-semibold mb-2">Honorable mentions</div>
              <div className="flex flex-wrap gap-2">
                {summary.slice(3).map(s => (
                  <button
                    key={s.shop.num}
                    onClick={() => setSelectedShop(s.shop.num)}
                    className="group flex items-center gap-2 px-3 py-1.5 bg-white/80 hover:bg-white rounded-full border border-mango-line/70 hover:border-mango-orange/50 transition-colors text-sm cursor-pointer"
                    title="Click to see categories"
                  >
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: s.shop.color }} />
                    <span className="font-medium">{s.shop.name}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-mango-muted">
                      {s.gold > 0 && <><TrophyIcon rank={1} size={12} />{s.gold}</>}
                      {s.silver > 0 && <><TrophyIcon rank={2} size={12} />{s.silver}</>}
                      {s.bronze > 0 && <><TrophyIcon rank={3} size={12} />{s.bronze}</>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-mango-muted/70 mt-5 pt-3 border-t border-mango-line/50">
            Board order uses a weighted score: gold = 100, silver = 10, bronze = 1. Click any shop to see exactly which categories it placed in. “Most 5★ Reviews” is paused while Google Business Profile API access is pending and returns automatically once review totals are available.
          </p>
          <style jsx>{`
            @keyframes trophy-shimmer {
              0%   { transform: translateX(-50%) skewX(-12deg); }
              60%  { transform: translateX(380%)  skewX(-12deg); }
              100% { transform: translateX(380%)  skewX(-12deg); }
            }
            @keyframes sparkle-twinkle {
              0%, 100% { opacity: 0.3; transform: scale(0.7); }
              50%      { opacity: 1;   transform: scale(1.15); }
            }
            .trophy-spin { animation: trophy-spin 0.9s linear infinite; }
            @keyframes trophy-spin { to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) { .trophy-spin { animation: none; } }
          `}</style>
        </div>
      </div>

      {selectedShop && (() => {
        const s = summary.find(x => x.shop.num === selectedShop);
        if (!s) return null;
        const items = (Object.entries(s.by) as [Category, 1 | 2 | 3][])
          .map(([cat, rank]) => ({ cat, rank }))
          .sort((a, b) => a.rank - b.rank);
        return (
          <div className="fixed inset-0 bg-mango-ink/40 flex items-center justify-center z-50 p-4" onClick={() => setSelectedShop(null)}>
            <div className="bg-white rounded-card shadow-card p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="inline-block w-4 h-4 rounded-full ring-2 ring-mango-line" style={{ background: s.shop.color }} />
                  <div>
                    <div className="text-xl font-bold">{s.shop.name}</div>
                    <div className="text-xs text-mango-muted">Pending trophies this week</div>
                  </div>
                </div>
                <button onClick={() => setSelectedShop(null)} className="text-mango-muted hover:text-mango-ink text-2xl leading-none">×</button>
              </div>
              <div className="space-y-2">
                {items.map(({ cat, rank }) => {
                  const label = CATEGORIES.find(c => c.key === cat)?.label || cat;
                  const rankLabel = rank === 1 ? '#1 — Gold' : rank === 2 ? '#2 — Silver' : '#3 — Bronze';
                  return (
                    <div key={cat} className="flex items-center gap-3 p-3 bg-mango-bg/50 rounded-lg">
                      <TrophyIcon rank={rank} size={28} />
                      <div className="flex-1">
                        <div className="font-semibold text-sm">{label}</div>
                        <div className="text-xs text-mango-muted">{rankLabel}</div>
                      </div>
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
