'use client';

// 12-week FBR heatmap per brief Section 8 Component 2.

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Grid3x3 } from 'lucide-react';
import { pct } from '@/lib/format';

interface HeatmapShop {
  shopNum: string;
  shopName: string;
  weeks: Array<{ weekStart: string; fbrPct: number }>;
}

const TARGET = 0.60;

function cellColor(rate: number, ramping: boolean) {
  if (ramping) return '#DBEAFE';
  if (rate >= TARGET) return `rgba(25, 162, 104, ${0.25 + Math.min(0.65, (rate - TARGET) * 1.5)})`;
  if (rate >= TARGET - 0.10) return `rgba(229, 142, 19, ${0.30 + Math.min(0.45, (TARGET - rate) * 2)})`;
  return `rgba(224, 82, 75, ${0.30 + Math.min(0.55, (TARGET - 0.10 - rate) * 2)})`;
}

export default function FBRHeatmap() {
  const [rows, setRows] = useState<HeatmapShop[] | null>(null);
  useEffect(() => {
    fetch('/api/fbr?view=heatmap_12w').then((r) => r.json()).then((d) => setRows(d.shops || []));
  }, []);

  if (!rows) return <div className="card animate-pulse h-[260px] mb-6" />;
  const weekStarts = rows[0]?.weeks.map((w) => w.weekStart) ?? [];

  return (
    <div className="card mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Grid3x3 className="w-5 h-5 text-mango-info" />
        <h2 className="text-lg font-semibold">Re-Book at Checkout — 12-Week Heatmap</h2>
      </div>
      <p className="text-xs text-mango-muted mb-4">Cells colored by weekly Re-Book rate. Green = at-or-above 60% target. Amber = within 10pp. Red = below.</p>

      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: '2px' }}>
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-mango-muted px-2 py-1">Shop</th>
              {weekStarts.map((w, i) => (
                <th key={i} className="text-[10px] font-medium text-mango-muted px-1 min-w-[36px]">
                  {format(new Date(w), 'M/d')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.shopNum}>
                <td className="px-2 py-1 text-sm font-medium whitespace-nowrap">{r.shopName}</td>
                {r.weeks.map((w, i) => (
                  <td
                    key={i}
                    className="px-0 py-0 text-center text-[10px] font-medium"
                    style={{ background: cellColor(w.fbrPct, false), borderRadius: 4, minWidth: 36, height: 26 }}
                    title={`${r.shopName} · ${format(new Date(w.weekStart), 'MMM d')} · ${pct(w.fbrPct)}`}
                  >
                    {Math.round(w.fbrPct * 100)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
