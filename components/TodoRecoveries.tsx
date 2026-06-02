'use client';

// To-Do Recoveries leaderboard — production widget. Per-shop count of items
// checked off in the To Do queue (callbacks / rebooks / declined-jobs the
// manager marked as "recovered"). Standard This Week / Rolling 7d toggle.
// Same row-per-shop card pattern as AppointmentBookedRate / FbrLeaderboard,
// styled to fit the production /employee page.
//
// The category is counted in Pending Trophies via components/TrophyTally.tsx
// and in the Golden Mango ceremony via lib/goldenMango.ts — this widget is
// the operations-floor view of the same data.

import { useEffect, useState } from 'react';
import { SHOP_BY_NUM } from '@/lib/shops';
import { TrophyIcon } from './Trophy';

interface Row { shopNum: string; shopName: string; count: number }
interface Snap { window: string; windowStartISO: string; windowEndISO: string; chain: { count: number }; shops: Row[] }

type WindowKind = 'rolling' | 'this_week';

function rateColor(count: number, leader: number): string {
  if (leader === 0) return '#E5DFCF';
  const r = count / leader;
  if (r >= 0.85) return '#5BAA59';
  if (r >= 0.60) return '#A8CE5A';
  if (r >= 0.35) return '#F5E580';
  if (r >= 0.10) return '#F4B65C';
  return '#C9412A';
}

export default function TodoRecoveries() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [windowKind, setWindowKind] = useState<WindowKind>('this_week');

  useEffect(() => {
    setSnap(null);
    const url = `/api/extras?view=todo-recoveries&window=${windowKind === 'this_week' ? 'this_week' : 'rolling_7d'}`;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (!cancelled) setSnap(d);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [windowKind]);

  if (!snap) return (
    <div className="rounded-2xl border border-mango-line bg-white p-5 mb-4 h-[260px] animate-pulse" />
  );

  const ranked = [...snap.shops].sort((a, b) => b.count - a.count);
  const leader = ranked[0]?.count ?? 0;
  const winCopy = windowKind === 'this_week' ? 'this week (Mon → today MT)' : 'the last 7 days';

  return (
    <div className="rounded-2xl border border-mango-line bg-white p-5 mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-lg font-semibold">To-Do Items Checked Off — {windowKind === 'this_week' ? 'This Week' : 'Rolling 7 Days'}</h2>
          <p className="text-[12.5px] text-mango-muted mt-1">
            Count of customers a manager marked "recovered" {winCopy} across the missed-callbacks, missed re-books, and declined-jobs queues. Counts in the Pending Trophies tally and the Golden Mango ceremony.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-mango-line bg-mango-bg p-0.5">
          {(['this_week', 'rolling'] as const).map((k) => (
            <button key={k} onClick={() => setWindowKind(k)} className="rounded-full px-3 py-1 text-[12px] font-semibold transition" style={windowKind === k ? { background: '#fff', color: '#0F1419', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' } : { color: '#6B7280' }}>{k === 'this_week' ? 'This Week' : 'Rolling 7d'}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-6 mb-4 text-[13px]">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-mango-muted">Chain recoveries</div>
          <div className="text-2xl font-bold tabular-nums text-mango-ink">{snap.chain.count}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-mango-muted">Shops contributing</div>
          <div className="text-2xl font-bold tabular-nums text-mango-ink">{ranked.filter((r) => r.count > 0).length} / {ranked.length}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-mango-muted">Top shop</div>
          <div className="text-base font-semibold tabular-nums text-mango-ink">{leader > 0 ? `${ranked[0]?.shopName} · ${leader}` : '—'}</div>
        </div>
      </div>
      <div>
        {ranked.map((r, i) => {
          const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
          const bg = rateColor(r.count, leader);
          const fill = leader === 0 ? '4%' : `${Math.min(100, Math.max(4, (r.count / leader) * 100))}%`;
          return (
            <div key={r.shopNum} className="flex items-center gap-3 py-2 border-b border-mango-line/60 last:border-0">
              <div className="w-5 text-mango-muted font-semibold text-sm text-right">{i + 1}</div>
              {i < 3 && r.count > 0 ? <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={16} /> : <div className="w-4" />}
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: meta?.color }} />
              <div className="font-medium text-sm w-32 shrink-0">{r.shopName}</div>
              <div className="flex-1 h-2.5 bg-mango-line/40 rounded-full overflow-hidden" title={`${r.count} item${r.count === 1 ? '' : 's'} checked off`}>
                <div className="h-full rounded-full" style={{ width: fill, background: bg }} />
              </div>
              <div className="text-sm font-bold tabular-nums w-12 text-right px-2 py-0.5 rounded" style={{ background: r.count > 0 ? bg : 'transparent', color: bg === '#5BAA59' || bg === '#C9412A' ? '#FFF' : '#0F1419' }}>{r.count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
