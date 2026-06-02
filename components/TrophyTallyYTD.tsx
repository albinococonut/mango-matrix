'use client';

// Current-quarter Trophy Tally — aggregates each shop's gold/silver/bronze
// trophies across the weeks of the current calendar quarter, plus this week's
// snapshot categories (tech, re-books, comebacks, reviews, conversion).
//
// Without a persistent trophy log table, the quarterly window is approximated by:
//   - Revenue + GP%: weekly rankings from the heatmap, filtered to weeks
//     starting on or after the current quarter's first day.
//   - Top Tech / Re-Books / Comebacks / Reviews / Conversion: this week only —
//     we don't backfill these because the upstream APIs only expose the live
//     snapshot. Acceptable approximation since these change week-to-week.
//
// Tally marks render as 𝍢 (groups of 5) so a stack of 12 reads at a glance.

import { useEffect, useMemo, useState } from 'react';
import { Award } from 'lucide-react';
import { SHOPS } from '@/lib/shops';
import { historyWeeksSince } from '@/lib/trophyHistory';
import { TrophyIcon } from './Trophy';

type Category = 'revenue' | 'gp' | 'tech' | 'rebook' | 'comebacks' | 'reviews' | 'conversion';
const CATEGORY_LABEL: Record<Category, string> = {
  revenue: 'Revenue',
  gp: 'GP%',
  tech: 'Top Tech',
  rebook: 'Most Re-Books',
  comebacks: 'Fewest Comebacks',
  reviews: 'Most New 5★ Reviews',
  conversion: 'Highest Call Conversion',
};


// Return [year, quarterIndex 0-3, quarterLabel "Q2", quarterStartISO] for `now`.
function currentQuarter(now: Date) {
  const y = now.getUTCFullYear();
  const qIdx = Math.floor(now.getUTCMonth() / 3);
  const startMonth = qIdx * 3;
  const startDate = `${y}-${String(startMonth + 1).padStart(2, '0')}-01`;
  return { year: y, qIdx, label: `Q${qIdx + 1}`, startDate };
}

function TallyMarks({ count, color }: { count: number; color: string }) {
  if (count === 0) return (
    <svg width="34" height="10" viewBox="0 0 34 10" aria-label="no trophies" role="img" className="opacity-50">
      <path d="M1 5 Q5 1 9 5 T17 5 T25 5 T33 5" fill="none" stroke="#cbd0d6" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  if (count > 40) return <span className="font-bold tabular-nums" style={{ color }}>{count}</span>;
  const fives = Math.floor(count / 5);
  const rem = count % 5;
  // Classic tally: each full group = 4 upright strokes + a 5th diagonal slash
  // across them. Strokes stay full-size; the diagonal is what marks the five.
  const GroupFive = ({ k }: { k: number }) => (
    <svg key={k} width="26" height="20" viewBox="0 0 26 20" className="shrink-0" aria-hidden>
      {[3, 8, 13, 18].map((x, i) => (
        <line key={i} x1={x} y1="2" x2={x} y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      ))}
      <line x1="0" y1="18" x2="24" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
  const Partial = ({ n }: { n: number }) => (
    <svg width={n * 5 + 2} height="20" viewBox={`0 0 ${n * 5 + 2} 20`} className="shrink-0" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <line key={i} x1={3 + i * 5} y1="2" x2={3 + i * 5} y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      ))}
    </svg>
  );
  return (
    <span className="inline-flex items-center gap-1.5 leading-none" title={String(count)}>
      {Array.from({ length: fives }).map((_, i) => <GroupFive key={i} k={i} />)}
      {rem > 0 && <Partial n={rem} />}
    </span>
  );
}

export default function TrophyTallyYTD() {
  const [techs, setTechs] = useState<any[] | null>(null);
  const [fbr, setFbr] = useState<any[] | null>(null);
  const [comebacks, setComebacks] = useState<any[] | null>(null);
  const [reviews, setReviews] = useState<any[] | null>(null);
  const [conversion, setConversion] = useState<any[] | null>(null);
  // Current in-progress week's revenue + GP% per shop (history covers only
  // completed weeks; this adds the live week to the quarter accumulation).
  const [liveKpi, setLiveKpi] = useState<Array<{ shopNum: string; revenue: number; gpPct: number }>>([]);

  const q = useMemo(() => currentQuarter(new Date()), []);

  useEffect(() => {
    const safe = async <T,>(url: string): Promise<T | null> => {
      try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch { return null; }
    };
    // Pull enough weeks (13) to cover any quarter; we filter client-side to weeks ≥ quarter start.
    safe<any>('/api/tech-production?range=last_7_days').then(d => setTechs(d?.rows || []));
    safe<any>('/api/fbr?view=leaderboard').then(d => setFbr(d?.shops || []));
    safe<any>('/api/extras?view=comebacks&range=last_7_days').then(d => setComebacks(d?.shops || []));
    safe<any>('/api/extras?view=google-ratings').then(d => setReviews(d?.shops || []));
    safe<any>('/api/extras?view=booked-rate&strict=1').then(d => setConversion(d?.shops || []));
    safe<any>('/api/metrics?range=last_7_days').then(d => {
      const lk: Array<{ shopNum: string; revenue: number; gpPct: number }> = [];
      for (const s of (d?.kpi?.byShop || [])) {
        lk.push({ shopNum: s.shopNum, revenue: s.revenue, gpPct: s.gpPct });
      }
      setLiveKpi(lk);
    });
  }, []);

  // Compute per-shop tallies. `currentWeekRank` captures the most-recent rank
  // for each category so we can surface "closest to top 3" as leverage.
  const tallies = useMemo(() => {
    const out: Record<string, {
      gold: number; silver: number; bronze: number;
      perCategory: Record<Category, { g: number; s: number; b: number; currentWeekRank?: number; fieldSize?: number }>;
    }> = {};
    for (const s of SHOPS) {
      out[s.num] = { gold: 0, silver: 0, bronze: 0, perCategory: {
        revenue: { g: 0, s: 0, b: 0 }, gp: { g: 0, s: 0, b: 0 },
        tech: { g: 0, s: 0, b: 0 }, rebook: { g: 0, s: 0, b: 0 },
        comebacks: { g: 0, s: 0, b: 0 }, reviews: { g: 0, s: 0, b: 0 }, conversion: { g: 0, s: 0, b: 0 },
      } };
    }

    function awardWeekly(cat: Category, ranking: string[]) {
      ranking.slice(0, 3).forEach((shopNum, i) => {
        if (!out[shopNum]) return;
        const slot = i === 0 ? 'g' : i === 1 ? 's' : 'b';
        out[shopNum].perCategory[cat][slot]++;
        if (slot === 'g') out[shopNum].gold++;
        else if (slot === 's') out[shopNum].silver++;
        else out[shopNum].bronze++;
      });
    }
    function recordRanking(cat: Category, ranking: string[]) {
      ranking.forEach((shopNum, i) => {
        if (!out[shopNum]) return;
        out[shopNum].perCategory[cat].currentWeekRank = i + 1;
        out[shopNum].perCategory[cat].fieldSize = ranking.length;
      });
    }

    // All completed weeks of the quarter, from the committed backfill history.
    // Revenue / GP% / Top-Tech / Fewest-Comebacks accumulate every week.
    for (const hw of historyWeeksSince(q.startDate)) {
      awardWeekly('revenue', hw.rankings.revenue);
      awardWeekly('gp', hw.rankings.gp);
      awardWeekly('tech', hw.rankings.tech);
      awardWeekly('comebacks', hw.rankings.comebacks);
    }
    // Current in-progress week's revenue/GP also count toward the quarter.
    if (liveKpi.length) {
      const rev = [...liveKpi].sort((a, b) => b.revenue - a.revenue).map(x => x.shopNum);
      const gp = [...liveKpi].sort((a, b) => b.gpPct - a.gpPct).map(x => x.shopNum);
      awardWeekly('revenue', rev);
      awardWeekly('gp', gp);
      recordRanking('revenue', rev);
      recordRanking('gp', gp);
    }
    // Snapshot categories: trophy this week + record ranking
    function snapshot(cat: Category, ranking: string[]) {
      awardWeekly(cat, ranking);
      recordRanking(cat, ranking);
    }
    if (techs)      snapshot('tech',      [...techs].sort((a, b) => b.efficiency - a.efficiency).map(x => x.shopNum));
    if (fbr)        snapshot('rebook',    [...fbr].sort((a, b) => (b.fbr?.fbrPct ?? 0) - (a.fbr?.fbrPct ?? 0)).map(x => x.shopNum));
    if (comebacks)  snapshot('comebacks', [...comebacks].sort((a, b) => a.comebackJobs - b.comebackJobs).map(x => x.shopNum));
    // Skip the reviews category entirely while GBP totals are all 0 (API access
    // pending). Auto-resumes when any shop has a non-zero 5★ count.
    if (reviews && reviews.some((x: any) => (x.fiveStar ?? 0) > 0)) {
      snapshot('reviews', [...reviews].sort((a, b) => b.fiveStar - a.fiveStar).map(x => x.shopNum));
    }
    if (conversion) snapshot('conversion', [...conversion].sort((a, b) => b.bookedRatePct - a.bookedRatePct).map(x => x.shopNum));
    return out;
  }, [liveKpi, techs, fbr, comebacks, reviews, conversion, q.startDate]);

  function topCategories(t: typeof tallies[string]): string {
    const sorted = (Object.entries(t.perCategory) as [Category, any][])
      .map(([cat, p]) => ({ cat, weight: p.g * 3 + p.s * 2 + p.b }))
      .filter(x => x.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2);
    if (sorted.length === 0) return '—';
    return sorted.map(x => CATEGORY_LABEL[x.cat]).join(', ');
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Award className="w-5 h-5 text-mango-orange" />
        <h2 className="text-lg font-semibold">Past Trophies Earned this Quarter</h2>
      </div>
      <p className="text-sm text-mango-muted mt-0.5">
        Every trophy each shop has banked so far this quarter. The shop with the most is the quarter leader.
      </p>
      <p className="text-xs font-semibold text-mango-ink/70 mt-1.5 mb-4">
        {(Object.values(CATEGORY_LABEL) as string[]).join(' · ')}
      </p>
      <table className="w-full text-sm">
        <thead className="text-xs text-mango-muted">
          <tr className="border-b border-mango-line">
            <th className="py-2 px-2 text-left">Shop</th>
            <th className="py-2 px-2 text-left"><span className="inline-flex items-center gap-1.5"><TrophyIcon rank={1} size={16} /> Gold</span></th>
            <th className="py-2 px-2 text-left"><span className="inline-flex items-center gap-1.5"><TrophyIcon rank={2} size={16} /> Silver</span></th>
            <th className="py-2 px-2 text-left"><span className="inline-flex items-center gap-1.5"><TrophyIcon rank={3} size={16} /> Bronze</span></th>
            <th className="py-2 px-2 text-left">Often Trophies In</th>
          </tr>
        </thead>
        <tbody>
          {SHOPS.map(s => {
            const t = tallies[s.num];
            return (
              <tr key={s.num} className="border-b border-mango-line/60 hover:bg-mango-bg/40">
                <td className="py-2 px-2 font-medium whitespace-nowrap">
                  <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: s.color }} />
                  {s.name}
                </td>
                <td className="py-2 px-2"><TallyMarks count={t.gold} color="#B58900" /></td>
                <td className="py-2 px-2"><TallyMarks count={t.silver} color="#6B7280" /></td>
                <td className="py-2 px-2"><TallyMarks count={t.bronze} color="#9A5F33" /></td>
                <td className="py-2 px-2 text-xs">{topCategories(t)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-mango-muted/70 mt-4 pt-3 border-t border-mango-line/50">
        Each tally mark (𝍢 = 5) is one weekly trophy. Revenue and GP% accumulate every week of the quarter since {q.startDate}. Top Tech, Re-Books, Comebacks, Reviews, and Call Conversion reflect the most recent week only — those sources don’t expose week-by-week history, so they can’t be backfilled across the quarter. “Most 5★ Reviews” is paused until Google Business Profile API access is approved.
      </p>
    </div>
  );
}
