'use client';

// Call Conversion (week-to-date). Styled to match the other leaderboard cards
// on the page — row-per-shop with a colored bar fill, rank trophy, and a
// Revenue Lost column per shop computed from the missed-call count × shop ARO.

import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import { SHOP_BY_NUM } from '@/lib/shops';
import { usd } from '@/lib/format';
import { TrophyIcon } from './Trophy';

interface Snap {
  windowStart: string;
  windowEnd: string;
  computedAt: string;
  classifier: 'whatconverts_baseline' | 'claude_strict';
  shops: Array<{
    shopNum: string;
    shopName: string;
    totalCalls: number;
    eligible: number;
    booked: number;
    bookedRatePct: number;
  }>;
  chain: { eligible: number; booked: number; bookedRatePct: number };
}

function rateColor(rate: number): string {
  if (rate >= 40) return '#5BAA59';
  if (rate >= 30) return '#A8CE5A';
  if (rate >= 25) return '#F5E580';
  if (rate >= 15) return '#F4B65C';
  return '#C9412A';
}

export default function AppointmentBookedRate() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [aroByShop, setAroByShop] = useState<Record<string, number>>({});

  async function load() {
    const res = await fetch('/api/extras?view=booked-rate&strict=1', { cache: 'no-store' });
    const j = await res.json();
    setSnap(j);
  }
  useEffect(() => {
    load();
    fetch('/api/metrics?range=this_week').then(r => r.json()).then(d => {
      const map: Record<string, number> = {};
      for (const s of (d?.kpi?.byShop || [])) map[s.shopNum] = s.aro;
      setAroByShop(map);
    }).catch(() => {});
    const t = setInterval(load, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  if (!snap) return <div className="card animate-pulse h-[360px] mb-6" />;

  const sorted = [...snap.shops].sort((a, b) => b.bookedRatePct - a.bookedRatePct);
  // Chain revenue lost = sum of (missed × shopARO).
  const chainRevLost = sorted.reduce((s, x) => s + Math.max(0, x.eligible - x.booked) * (aroByShop[x.shopNum] || 0), 0);

  return (
    <div className="card mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Phone className="w-5 h-5 text-mango-info" />
        <h2 className="text-lg font-semibold">Call Conversion — week to date</h2>
      </div>
      <p className="text-xs text-mango-muted mb-4">
        Window: {snap.windowStart} → {snap.windowEnd} (resets Monday). Every call run through Claude
        (booking language + customer agreement). Auto-refreshes every 15 min.
        Revenue lost = unbooked calls × shop ARO this week.
      </p>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-mango-bg/50 rounded-lg p-3"><div className="text-xs text-mango-muted">Chain conversion</div><div className="text-2xl font-bold mt-0.5">{snap.chain.bookedRatePct.toFixed(1)}%</div></div>
        <div className="bg-mango-bg/50 rounded-lg p-3"><div className="text-xs text-mango-muted">Eligible calls WTD</div><div className="text-2xl font-bold mt-0.5">{snap.chain.eligible}</div></div>
        <div className="bg-mango-bg/50 rounded-lg p-3"><div className="text-xs text-mango-muted">Calls converted</div><div className="text-2xl font-bold mt-0.5">{snap.chain.booked}</div></div>
        <div className="bg-mango-red/10 rounded-lg p-3"><div className="text-xs text-mango-muted">Revenue lost (est.)</div><div className="text-2xl font-bold mt-0.5 text-mango-red">{chainRevLost ? usd(chainRevLost) : '—'}</div></div>
      </div>

      <div>
        {sorted.map((r, i) => {
          const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
          const fill = `${Math.min(100, Math.max(4, (r.bookedRatePct / 60) * 100))}%`;
          const bg = rateColor(r.bookedRatePct);
          const aro = aroByShop[r.shopNum] || 0;
          const missed = Math.max(0, r.eligible - r.booked);
          const revLost = missed * aro;
          return (
            <div key={r.shopNum} className="flex items-center gap-3 py-2 border-b border-mango-line/60 last:border-0">
              <div className="w-5 text-mango-muted font-semibold text-sm text-right">{i + 1}</div>
              {i < 3 ? <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={16} /> : <div className="w-4" />}
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: meta?.color }} />
              <div className="font-medium text-sm w-28 shrink-0">{r.shopName}</div>
              <div className="flex-1 h-2.5 bg-mango-line/40 rounded-full overflow-hidden" title={`${r.booked}/${r.eligible} calls converted`}>
                <div className="h-full rounded-full" style={{ width: fill, background: bg }} />
              </div>
              <div className="text-sm font-bold tabular-nums w-16 text-right px-2 py-0.5 rounded" style={{ background: bg, color: bg === '#5BAA59' || bg === '#C9412A' ? '#FFF' : '#0F1419' }}>{r.bookedRatePct.toFixed(1)}%</div>
              <div className="text-xs text-mango-muted tabular-nums w-16 text-right" title="Converted / Eligible">{r.booked}/{r.eligible}</div>
              <div className="text-sm font-bold tabular-nums w-24 text-right text-mango-red" title={`${missed} missed × ARO ${usd(aro)}`}>{aro ? usd(revLost) : '—'}</div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-mango-muted mt-3">
        Calls excluded from denominator: spam, wrong number, dropped/audio issues, or transcript &lt;30 chars.
      </p>
    </div>
  );
}
