'use client';

// Trophy Tally — celebratory summary of who won each category this week.
// Fetches every category endpoint, computes gold/silver/bronze winners, and
// renders a card with clickable shop chips. Clicking a chip opens a modal
// showing exactly which categories that shop placed in.

import { useEffect, useMemo, useState } from 'react';
import { Award } from 'lucide-react';
import { SHOPS } from '@/lib/shops';
import { TrophyIcon } from './Trophy';

interface ShopMetrics { shopNum: string; shopName: string; revenue: number; gpPct: number }
interface TechRow { technicianId: number; shopNum: string; shopName: string; efficiency: number; billedHours: number }
interface FbrRow { shopNum: string; shopName: string; fbr: { fbrPct: number; forwardBookedROs: number; eligibleROs: number } }
interface ComebackRow { shopNum: string; shopName: string; comebackJobs: number }
interface GoogleRow { shopNum: string; shopName: string; fiveStar: number; recentTotal: number }
interface ConversionRow { shopNum: string; shopName: string; bookedRatePct: number }

type Category = 'revenue' | 'gp' | 'tech' | 'rebook' | 'comebacks' | 'reviews' | 'conversion';
const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'revenue',    label: 'Revenue' },
  { key: 'gp',         label: 'GP%' },
  { key: 'tech',       label: 'Top Tech' },
  { key: 'rebook',     label: 'Most Re-Books' },
  { key: 'comebacks',  label: 'Fewest Comebacks' },
  { key: 'reviews',    label: 'Most New 5★ Reviews' },
  { key: 'conversion', label: 'Highest Call Conversion' },
];

export default function TrophyTally() {
  const [metrics, setMetrics] = useState<ShopMetrics[] | null>(null);
  const [techs, setTechs] = useState<TechRow[] | null>(null);
  const [fbr, setFbr] = useState<FbrRow[] | null>(null);
  const [comebacks, setComebacks] = useState<ComebackRow[] | null>(null);
  const [reviews, setReviews] = useState<GoogleRow[] | null>(null);
  const [conversion, setConversion] = useState<ConversionRow[] | null>(null);
  const [selectedShop, setSelectedShop] = useState<string | null>(null);

  useEffect(() => {
    const safe = async <T,>(url: string): Promise<T | null> => {
      try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch { return null; }
    };
    safe<any>('/api/metrics?range=this_week').then(d => {
      if (!d?.kpi?.byShop) return;
      setMetrics(d.kpi.byShop.map((s: any) => ({ shopNum: s.shopNum, shopName: s.shopName, revenue: s.revenue, gpPct: s.gpPct })));
    });
    safe<any>('/api/tech-production?range=this_week').then(d => setTechs(d?.rows || []));
    safe<any>('/api/fbr?view=leaderboard').then(d => setFbr(d?.shops || []));
    safe<any>('/api/extras?view=comebacks&range=this_week').then(d => setComebacks(d?.shops || []));
    safe<any>('/api/extras?view=google-ratings').then(d => setReviews(d?.shops || []));
    safe<any>('/api/extras?view=booked-rate&strict=1').then(d => setConversion(d?.shops || []));
  }, []);

  const rankings = useMemo(() => {
    const r: Record<Category, string[]> = { revenue: [], gp: [], tech: [], rebook: [], comebacks: [], reviews: [], conversion: [] };
    if (metrics)    r.revenue   = [...metrics].sort((a, b) => b.revenue - a.revenue).map(x => x.shopNum);
    if (metrics)    r.gp        = [...metrics].sort((a, b) => b.gpPct - a.gpPct).map(x => x.shopNum);
    if (techs)      r.tech      = [...techs].sort((a, b) => b.efficiency - a.efficiency).map(x => x.shopNum);
    if (fbr)        r.rebook    = [...fbr].sort((a, b) => (b.fbr?.fbrPct ?? 0) - (a.fbr?.fbrPct ?? 0)).map(x => x.shopNum);
    if (comebacks)  r.comebacks = [...comebacks].sort((a, b) => a.comebackJobs - b.comebackJobs).map(x => x.shopNum);
    if (reviews)    r.reviews   = [...reviews].sort((a, b) => b.fiveStar - a.fiveStar).map(x => x.shopNum);
    if (conversion) r.conversion = [...conversion].sort((a, b) => b.bookedRatePct - a.bookedRatePct).map(x => x.shopNum);
    return r;
  }, [metrics, techs, fbr, comebacks, reviews, conversion]);

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
      <div className="card mb-6 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #FFF7E6 0%, #FFFFFF 60%, #FFF1F4 100%)' }}>
        <div className="absolute inset-0 pointer-events-none opacity-60" style={{
          backgroundImage: 'radial-gradient(circle at 12% 18%, #F5C51844 0 6px, transparent 7px), radial-gradient(circle at 88% 22%, #EC489944 0 5px, transparent 6px), radial-gradient(circle at 25% 82%, #10B98144 0 4px, transparent 5px), radial-gradient(circle at 76% 80%, #3B82F644 0 5px, transparent 6px), radial-gradient(circle at 50% 12%, #F9731644 0 4px, transparent 5px)',
          backgroundSize: 'cover',
        }} />
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <Award className="w-9 h-9 text-mango-orange drop-shadow" />
            <div>
              <h2 className="text-2xl font-bold tracking-tight">🏆 Trophy Tally — This Week</h2>
              <p className="text-sm text-mango-muted mt-0.5">
                🥇 Gold · 🥈 Silver · 🥉 Bronze across Revenue · GP% · Top Tech · Most Re-Books · Fewest Comebacks · Most 5★ Reviews · Highest Call Conversion. <span className="text-mango-orange font-medium">Click any shop to see what they won.</span>
              </p>
            </div>
          </div>
          {/* Top 3 — big spotlight cards in a 3-up grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
            {summary.slice(0, 3).map((s, rank) => {
              const total = s.gold + s.silver + s.bronze;
              const borderColor = rank === 0 ? '#F5C518' : rank === 1 ? '#9CA3AF' : '#C2814B';
              const isFirst = rank === 0;
              return (
                <button key={s.shop.num} onClick={() => setSelectedShop(s.shop.num)}
                  className="group relative flex flex-col items-stretch gap-3 p-4 bg-white/90 backdrop-blur rounded-2xl hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
                  style={{
                    border: `3px solid ${borderColor}`,
                    boxShadow: isFirst
                      ? '0 0 0 1px rgba(245,197,24,0.5), 0 8px 30px rgba(245,197,24,0.35)'
                      : rank === 1
                        ? '0 4px 14px rgba(156,163,175,0.25)'
                        : '0 4px 14px rgba(194,129,75,0.25)',
                  }}>
                  {/* #1-only: animated diagonal sparkle band + corner sparkles */}
                  {isFirst && (
                    <>
                      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                        <div className="absolute -inset-y-4 -left-1/4 w-1/2 opacity-60" style={{
                          background: 'linear-gradient(115deg, transparent 0%, rgba(255,235,150,0.55) 40%, rgba(255,255,255,0.85) 50%, rgba(255,235,150,0.55) 60%, transparent 100%)',
                          filter: 'blur(2px)',
                          transform: 'skewX(-12deg)',
                          animation: 'trophy-shimmer 3.5s ease-in-out infinite',
                        }} />
                      </div>
                      <div className="absolute top-1.5 right-2 text-xl select-none pointer-events-none animate-pulse" title="Champion this week">✨</div>
                      <div className="absolute bottom-1.5 left-2 text-base select-none pointer-events-none" style={{ animation: 'sparkle-twinkle 2s ease-in-out infinite 0.7s' }}>✨</div>
                      <div className="absolute top-1.5 left-12 text-xs select-none pointer-events-none" style={{ animation: 'sparkle-twinkle 2.2s ease-in-out infinite 1.4s' }}>✨</div>
                    </>
                  )}
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
                    <div className="text-xs text-mango-muted">This week's trophies</div>
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
