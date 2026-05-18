'use client';

import { useEffect, useState } from 'react';
import { Wrench, ChevronDown, BarChart3, Table2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { num, pct } from '@/lib/format';
import { SHOP_BY_NUM } from '@/lib/shops';
import { TrophyIcon } from './Trophy';

interface TechRow {
  technicianId: number;
  techName?: string;
  shopNum: string;
  shopName: string;
  billedHours: number;
  jobs: number;
  efficiency: number;
}

export default function TechProduction() {
  const [rows, setRows] = useState<TechRow[] | null>(null);
  const [windowLabel, setWindowLabel] = useState<string>('');
  const [workingHours, setWorkingHours] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<'table' | 'chart'>('table');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        // Always show this-week per spec; 100% efficiency = 40 hrs in a full Mon-Fri week.
        const res = await fetch('/api/tech-production?range=this_week');
        if (!res.ok) { if (!cancelled) setError(`Server returned ${res.status}`); return; }
        const d = await res.json();
        if (cancelled) return;
        if (d.error) { setError(d.error); return; }
        setRows(d.rows || []);
        setWindowLabel(d.windowLabel || 'This week');
        setWorkingHours(d.workingHours || 0);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Network error');
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const TOP_N = 10;
  const display = showAll ? rows : rows?.slice(0, TOP_N);

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Wrench className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Tech Production — week to date</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-mango-line rounded-lg overflow-hidden">
            <button onClick={() => setMode('table')} className={`p-1.5 ${mode === 'table' ? 'bg-mango-info text-white' : ''}`}><Table2 className="w-4 h-4" /></button>
            <button onClick={() => setMode('chart')} className={`p-1.5 ${mode === 'chart' ? 'bg-mango-info text-white' : ''}`}><BarChart3 className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
      <p className="text-xs text-mango-muted mb-4">
        100% efficiency = 8 hrs × {workingHours / 8 || 5} working days ({workingHours.toFixed(0)} hours) this week.
        Hours come from authorized job labor hours on revenue-realized ROs.
      </p>

      {error ? (
        <div className="p-4 bg-mango-red/10 border border-mango-red/30 rounded-md text-sm">
          <div className="font-semibold text-mango-red mb-1">Couldn't load Tech Production</div>
          <div className="text-mango-muted">{error}</div>
        </div>
      ) : !rows ? (
        <div className="h-[300px] animate-pulse bg-mango-bg rounded-md" />
      ) : mode === 'table' ? (
        <table className="w-full text-sm">
          <thead className="text-xs font-medium text-mango-muted">
            <tr className="border-b border-mango-line">
              <th className="py-2 px-2 text-left">#</th>
              <th className="py-2 px-2 text-left">Technician</th>
              <th className="py-2 px-2 text-left">Shop</th>
              <th className="py-2 px-2 text-right">Billed Hrs</th>
              <th className="py-2 px-2 text-right">Jobs</th>
              <th className="py-2 px-2 text-right">Efficiency</th>
            </tr>
          </thead>
          <tbody>
            {display?.map((r, i) => {
              const c = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM]?.color;
              return (
                <tr key={`${r.technicianId}-${r.shopNum}`} className="border-b border-mango-line/60 hover:bg-mango-bg/50">
                  <td className="py-2 px-2 text-mango-muted">
                    <span className="inline-flex items-center gap-1.5">{i + 1}{i < 3 && <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={14} />}</span>
                  </td>
                  <td className="py-2 px-2 font-medium">{r.techName || `Tech ${r.technicianId}`}</td>
                  <td className="py-2 px-2"><span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: c }} />{r.shopName}</td>
                  <td className="py-2 px-2 text-right font-medium">{r.billedHours.toFixed(1)}</td>
                  <td className="py-2 px-2 text-right">{num(r.jobs)}</td>
                  <td className={`py-2 px-2 text-right font-medium ${r.efficiency >= 1.0 ? 'text-mango-green' : r.efficiency >= 0.75 ? '' : 'text-mango-amber'}`}>
                    {pct(r.efficiency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div style={{ width: '100%', height: Math.max(280, (display?.length || 0) * 26 + 40) }}>
          <ResponsiveContainer>
            <BarChart
              data={(display || []).map(r => ({
                name: r.techName || `Tech ${r.technicianId}`,
                billedHours: Number(r.billedHours.toFixed(1)),
                efficiency: r.efficiency,
                shopColor: SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM]?.color || '#94A3B8',
                shopName: r.shopName,
              }))}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            >
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(val: any, _key, ctx: any) => [`${val} hrs · ${pct(ctx.payload.efficiency)} eff`, ctx.payload.shopName]}
              />
              <Bar dataKey="billedHours" radius={[0, 4, 4, 0]}>
                {(display || []).map((r, i) => (
                  <Cell key={i} fill={SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM]?.color || '#94A3B8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {rows && rows.length > TOP_N && (
        <button onClick={() => setShowAll(!showAll)} className="mt-4 w-full pt-3 border-t border-mango-line text-sm font-medium hover:text-mango-orange flex items-center justify-center gap-1.5">
          {showAll ? `Show top ${TOP_N}` : `Show all ${rows.length} technicians`}
          <ChevronDown className={`w-4 h-4 transition-transform ${showAll ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}
