'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Repeat } from 'lucide-react';
import { SHOP_BY_NUM } from '@/lib/shops';
import { usd, num } from '@/lib/format';
import { TrophyIcon } from './Trophy';
import { WindowToggle } from './AppointmentBookedRate';

interface ComebackTicket {
  roId: number;
  shopId: number;
  roNumber: number;
  postedDate: string;
  jobName: string;
  hours: number;
  estLaborCost: number;
  revenueLost: number;
  reason: 'reinspect' | 'heuristic';
}

interface Row {
  shopNum: string;
  shopName: string;
  comebackJobs: number;
  comebackHours: number;
  estLaborCost: number;
  revenueLost: number;
  revenuePerHour: number;
  ros: number;
  tickets?: ComebackTicket[];
}

type WindowKind = 'rolling' | 'this_week';

export default function Comebacks() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [windowKind, setWindowKind] = useState<WindowKind>('this_week');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    const range = windowKind === 'this_week' ? 'this_week' : 'last_7_days';
    let cancelled = false;
    fetch(`/api/extras?view=comebacks&range=${range}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setRows(d?.shops || []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [windowKind]);

  const windowLabel = windowKind === 'this_week' ? 'This Week' : 'Rolling 7 Days';
  const windowCopy  = windowKind === 'this_week' ? 'this week (Mon → today MT)' : 'the last 7 days';

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
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <Repeat className="w-5 h-5 text-mango-red" />
          <h2 className="text-lg font-semibold">Comebacks — {windowLabel}</h2>
        </div>
        <WindowToggle value={windowKind} onChange={setWindowKind} />
      </div>
      <p className="text-xs text-mango-muted mb-4">
        Heuristic: authorized jobs over {windowCopy} where a tech logged ≥ 15 minutes but the customer was charged ≤ $20 (usually warranty re-dos), and all jobs categorized as re-inspect.
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
          const isOpen = expanded === r.shopNum;
          const tickets = r.tickets ?? [];
          return (
            <div key={r.shopNum} className="border-b border-mango-line/60 last:border-0">
              {/* Shop summary row — click to expand ticket list */}
              <button
                className="w-full flex items-center gap-3 py-2 hover:bg-mango-bg/30 transition rounded text-left"
                onClick={() => setExpanded(isOpen ? null : r.shopNum)}
                title={`Revenue per tech hour for this shop ≈ ${usd(r.revenuePerHour)}`}
                aria-expanded={isOpen}
              >
                <div className="w-5 text-mango-muted font-semibold text-sm text-right">{i + 1}</div>
                {i < 3 ? <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={16} /> : <div className="w-4" />}
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: meta?.color }} />
                <div className="font-medium text-sm w-28 shrink-0">{r.shopName}</div>
                <div className="flex-1 h-2.5 bg-mango-line/40 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: fillPct, background: meta?.color, opacity: 0.7 }} />
                </div>
                <div className="text-xs text-mango-muted tabular-nums w-12 text-right">{r.comebackJobs}j</div>
                <div className="text-xs text-mango-muted tabular-nums w-14 text-right">{r.comebackHours.toFixed(1)}hr</div>
                <div className="text-xs text-mango-muted tabular-nums w-20 text-right">{usd(r.estLaborCost)}</div>
                <div className="text-sm font-bold tabular-nums w-24 text-right text-mango-red">{usd(r.revenueLost)}</div>
                {tickets.length > 0 && (
                  <ChevronDown className={`w-4 h-4 text-mango-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                )}
                {tickets.length === 0 && <div className="w-4 shrink-0" />}
              </button>

              {/* Expandable ticket list */}
              {isOpen && tickets.length > 0 && (
                <div className="ml-12 mb-2 rounded-lg overflow-hidden border border-mango-line/60">
                  <div className="grid text-[10px] font-semibold uppercase tracking-wide text-mango-muted px-3 py-1.5 bg-mango-bg/50" style={{ gridTemplateColumns: '1fr 2fr auto auto auto auto' }}>
                    <span>RO #</span>
                    <span>Job</span>
                    <span className="text-right">Date</span>
                    <span className="text-right">Hrs</span>
                    <span className="text-right">Cost</span>
                    <span className="text-right">Rev Lost</span>
                  </div>
                  {tickets.map((t, ti) => {
                    const roUrl = `https://shop.tekmetric.com/admin/shop/${t.shopId}/repair-orders/${t.roId}`;
                    const dateStr = t.postedDate ? new Date(t.postedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
                    return (
                      <div key={`${t.roId}-${ti}`}
                        className="grid items-center px-3 py-2 text-sm border-t border-mango-line/40 hover:bg-mango-bg/30 transition"
                        style={{ gridTemplateColumns: '1fr 2fr auto auto auto auto' }}>
                        {/* RO number — links directly to Tekmetric */}
                        <a href={roUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-mango-orange hover:text-mango-orange/80 font-semibold tabular-nums"
                          onClick={e => e.stopPropagation()}>
                          #{t.roNumber}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <span className="text-mango-ink truncate pr-2" title={t.jobName}>{t.jobName}</span>
                        <span className="text-mango-muted tabular-nums text-right text-xs">{dateStr}</span>
                        <span className="text-mango-muted tabular-nums text-right text-xs">{t.hours.toFixed(1)}</span>
                        <span className="text-mango-muted tabular-nums text-right text-xs">{usd(t.estLaborCost)}</span>
                        <span className="text-mango-red font-semibold tabular-nums text-right text-xs">{usd(t.revenueLost)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
