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

interface Heatmap {
  weeks: string[];
  shops: Array<{
    shopNum: string; shopName: string;
    cells: ({ revenue: number; gpPct: number } | null)[];
  }>;
}

// Return [year, quarterIndex 0-3, quarterLabel "Q2", quarterStartISO] for `now`.
function currentQuarter(now: Date) {
  const y = now.getUTCFullYear();
  const qIdx = Math.floor(now.getUTCMonth() / 3);
  const startMonth = qIdx * 3;
  const startDate = `${y}-${String(startMonth + 1).padStart(2, '0')}-01`;
  return { year: y, qIdx, label: `Q${qIdx + 1}`, startDate };
}

function TallyMarks({ count, color }: { count: number; color: string }) {
  if (count === 0) return <span className="text-mango-muted text-xs">—</span>;
  if (count > 25) return <span className="font-bold tabular-nums" style={{ color }}>{count}</span>;
  const fives = Math.floor(count / 5);
  const rem = count % 5;
  return (
    <span className="inline-flex items-center gap-1 leading-none" style={{ color }}>
      {Array.from({ length: fives }).map((_, i) => (
        <span key={`f${i}`} className="font-bold text-base tracking-tight" title={`${(i + 1) * 5}`}>𝍢</span>
      ))}
      {rem > 0 && (
        <span className="font-bold text-base tracking-tighter">{'|'.repeat(rem)}</span>
      )}
    </span>
  );
}

export default function TrophyTallyYTD() {
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);
  const [techs, setTechs] = useState<any[] | null>(null);
  const [fbr, setFbr] = useState<any[] | null>(null);
  const [comebacks, setComebacks] = useState<any[] | null>(null);
  const [reviews, setReviews] = useState<any[] | null>(null);
  const [conversion, setConversion] = useState<any[] | null>(null);

  const q = useMemo(() => currentQuarter(new Date()), []);

  useEffect(() => {
    const safe = async <T,>(url: string): Promise<T | null> => {
      try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch { return null; }
    };
    // Pull enough weeks (13) to cover any quarter; we filter client-side to weeks ≥ quarter start.
    safe<any>('/api/shop-performance-heatmap?weeks=13').then(d => d?.shops && setHeatmap(d));
    safe<any>('/api/tech-production?range=this_week').then(d => setTechs(d?.rows || []));
    safe<any>('/api/fbr?view=leaderboard').then(d => setFbr(d?.shops || []));
    safe<any>('/api/extras?view=comebacks&range=this_week').then(d => setComebacks(d?.shops || []));
    safe<any>('/api/extras?view=google-ratings').then(d => setReviews(d?.shops || []));
    safe<any>('/api/extras?view=booked-rate&strict=1').then(d => setConversion(d?.shops || []));
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

    // Revenue + GP%: only weeks within current quarter
    if (heatmap) {
      heatmap.weeks.forEach((wkISO, wi) => {
        if (wkISO < q.startDate) return; // out of quarter
        const rev = heatmap.shops
          .map(s => ({ n: s.shopNum, v: s.cells[wi]?.revenue ?? null }))
          .filter(x => x.v !== null)
          .sort((a, b) => (b.v as number) - (a.v as number))
          .map(x => x.n);
        const gp = heatmap.shops
          .map(s => ({ n: s.shopNum, v: s.cells[wi]?.gpPct ?? null }))
          .filter(x => x.v !== null)
          .sort((a, b) => (b.v as number) - (a.v as number))
          .map(x => x.n);
        if (rev.length) awardWeekly('revenue', rev);
        if (gp.length) awardWeekly('gp', gp);
        // Record most-recent (last) week's ranking for leverage calc
        if (wi === heatmap.weeks.length - 1) {
          if (rev.length) recordRanking('revenue', rev);
          if (gp.length) recordRanking('gp', gp);
        }
      });
    }
    // Snapshot categories: trophy this week + record ranking
    function snapshot(cat: Category, ranking: string[]) {
      awardWeekly(cat, ranking);
      recordRanking(cat, ranking);
    }
    if (techs)      snapshot('tech',      [...techs].sort((a, b) => b.efficiency - a.efficiency).map(x => x.shopNum));
    if (fbr)        snapshot('rebook',    [...fbr].sort((a, b) => (b.fbr?.fbrPct ?? 0) - (a.fbr?.fbrPct ?? 0)).map(x => x.shopNum));
    if (comebacks)  snapshot('comebacks', [...comebacks].sort((a, b) => a.comebackJobs - b.comebackJobs).map(x => x.shopNum));
    if (reviews)    snapshot('reviews',   [...reviews].sort((a, b) => b.fiveStar - a.fiveStar).map(x => x.shopNum));
    if (conversion) snapshot('conversion', [...conversion].sort((a, b) => b.bookedRatePct - a.bookedRatePct).map(x => x.shopNum));
    return out;
  }, [heatmap, techs, fbr, comebacks, reviews, conversion, q.startDate]);

  function topCategories(t: typeof tallies[string]): string {
    const sorted = (Object.entries(t.perCategory) as [Category, any][])
      .map(([cat, p]) => ({ cat, weight: p.g * 3 + p.s * 2 + p.b }))
      .filter(x => x.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2);
    if (sorted.length === 0) return '—';
    return sorted.map(x => CATEGORY_LABEL[x.cat]).join(', ');
  }

  // Highest Leverage = category where this shop is CLOSEST to a trophy but not
  // yet in the top 3 — the smallest single push that would buy a medal next
  // week. Ignore categories where they're already top 3 (no leverage —
  // they're winning), and ignore categories with no current ranking data.
  function highestLeverage(t: typeof tallies[string]): string {
    const candidates = (Object.entries(t.perCategory) as [Category, any][])
      .filter(([, p]) => typeof p.currentWeekRank === 'number' && p.currentWeekRank > 3)
      .sort((a, b) => (a[1].currentWeekRank ?? 99) - (b[1].currentWeekRank ?? 99));
    if (candidates.length === 0) {
      // Either all medals secured this week, or no data yet
      const anyRank = (Object.values(t.perCategory) as any[]).some(p => typeof p.currentWeekRank === 'number');
      return anyRank ? 'All medals secured 🏆' : '—';
    }
    const [cat, p] = candidates[0];
    const positionsFromBronze = (p.currentWeekRank as number) - 3;
    return `${CATEGORY_LABEL[cat]} (#${p.currentWeekRank} → +${positionsFromBronze} for bronze)`;
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Award className="w-5 h-5 text-mango-orange" />
        <h2 className="text-lg font-semibold">Current Quarter {q.year} Tally — {q.label}</h2>
      </div>
      <p className="text-xs text-mango-muted mb-4">
        Weeks since {q.startDate} for Revenue + GP%, plus this week for Top Tech / Re-Books / Comebacks / Reviews / Call Conversion.
        Each tally mark = one weekly trophy. <span className="italic">Highest Leverage</span> = the category where the shop is closest to a trophy this week — the smallest push to medal next week.
      </p>
      <table className="w-full text-sm">
        <thead className="text-xs text-mango-muted">
          <tr className="border-b border-mango-line">
            <th className="py-2 px-2 text-left">Shop</th>
            <th className="py-2 px-2 text-left"><span className="inline-flex items-center gap-1.5"><TrophyIcon rank={1} size={16} /> Gold</span></th>
            <th className="py-2 px-2 text-left"><span className="inline-flex items-center gap-1.5"><TrophyIcon rank={2} size={16} /> Silver</span></th>
            <th className="py-2 px-2 text-left"><span className="inline-flex items-center gap-1.5"><TrophyIcon rank={3} size={16} /> Bronze</span></th>
            <th className="py-2 px-2 text-left">Often Trophies In</th>
            <th className="py-2 px-2 text-left">Highest Leverage</th>
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
                <td className="py-2 px-2 text-xs text-mango-orange">{highestLeverage(t)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
