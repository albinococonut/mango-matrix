'use client';

import { useEffect, useState } from 'react';
import { Repeat } from 'lucide-react';
import { SHOP_BY_NUM } from '@/lib/shops';
import { usd, num } from '@/lib/format';
import { TrophyIcon } from './Trophy';

interface Row {
  shopNum: string;
  shopName: string;
  comebackJobs: number;
  comebackHours: number;
  estLaborCost: number;
  revenueLost: number;
  revenuePerHour: number;
  ros: number;
}

export default function Comebacks() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [windowLabel, setWindowLabel] = useState<string>('');
  useEffect(() => {
    fetch('/api/extras?view=comebacks&range=last_week').then(r => r.json()).then(d => {
      setRows(d?.shops || []);
      setWindowLabel(d?.window?.label || '');
    });
  }, []);

  if (!rows) return <div className="card animate-pulse h-[260px] mb-6" />;

  // Fewest revenue lost = #1 (impact-weighted; better than raw count).
  const ranked = [...rows].sort((a, b) => a.revenueLost - b.revenueLost);
  const totals = rows.reduce((acc, r) => ({
    jobs: acc.jobs + r.comebackJobs,
    hours: acc.hours + r.comebackHours,
    cost: acc.cost + r.estLaborCost,
    lost: acc.lost + r.revenueLost,
  }), { jobs: 0, hours: 0, cost: 0, lost: 0 });
  const maxLost = Math.max(...ranked.map(r => r.revenueLost), 1);

  return (
    <div className="card mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Repeat className="w-5 h-5 text-mango-red" />
        <h2 className="text-lg font-semibold">Comebacks — {windowLabel || 'last week'}</h2>
      </div>
      <p className="text-xs text-mango-muted mb-4">
        Heuristic: authorized jobs where a tech logged ≥ 15 minutes but the customer was charged ≤ $20 (usually warranty re-dos).
        Ranked by <b>revenue lost</b> (impact, not raw count). Revenue lost = comeback hours × that shop's billable revenue per
        tech hour (labor + parts ÷ total labor hours from authorized jobs).
      </p>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-mango-bg/50 rounded-lg p-3"><div className="text-xs text-mango-muted">Comeback jobs</div><div className="text-2xl font-bold mt-0.5">{num(totals.jobs)}</div></div>
        <div className="bg-mango-bg/50 rounded-lg p-3"><div className="text-xs text-mango-muted">Tech hours given away</div><div className="text-2xl font-bold mt-0.5">{totals.hours.toFixed(1)}</div></div>
        <div className="bg-mango-bg/50 rounded-lg p-3"><div className="text-xs text-mango-muted">Est. labor cost lost</div><div className="text-2xl font-bold mt-0.5">{usd(totals.cost)}</div></div>
        <div className="bg-mango-red/10 rounded-lg p-3"><div className="text-xs text-mango-muted">Revenue lost (est.)</div><div className="text-2xl font-bold mt-0.5 text-mango-red">{usd(totals.lost)}</div></div>
      </div>

      <div>
        {ranked.map((r, i) => {
          const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
          const fillPct = `${Math.max(4, (r.revenueLost / maxLost) * 100)}%`;
          return (
            <div key={r.shopNum} className="flex items-center gap-3 py-2 border-b border-mango-line/60 last:border-0" title={`Revenue per tech hour for this shop ≈ ${usd(r.revenuePerHour)}`}>
              <div className="w-5 text-mango-muted font-semibold text-sm text-right">{i + 1}</div>
              {i < 3 ? <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={16} /> : <div className="w-4" />}
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: meta?.color }} />
              <div className="font-medium text-sm w-28 shrink-0">{r.shopName}</div>
              <div className="flex-1 h-2.5 bg-mango-line/40 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: fillPct, background: meta?.color, opacity: 0.7 }} />
              </div>
              <div className="text-xs text-mango-muted tabular-nums w-12 text-right" title="Comeback jobs">{r.comebackJobs}j</div>
              <div className="text-xs text-mango-muted tabular-nums w-14 text-right" title="Tech hours">{r.comebackHours.toFixed(1)}hr</div>
              <div className="text-xs text-mango-muted tabular-nums w-20 text-right" title="Est. labor cost">{usd(r.estLaborCost)}</div>
              <div className="text-sm font-bold tabular-nums w-24 text-right text-mango-red" title="Revenue lost">{usd(r.revenueLost)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
