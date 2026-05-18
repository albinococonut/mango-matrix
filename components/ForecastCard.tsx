'use client';

import { Target, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { usd } from '@/lib/format';
import type { ForecastResult } from '@/lib/metrics';

interface Props {
  forecast: ForecastResult & { runRateAnnualLast12MoActual?: number };
}

export default function ForecastCard({ forecast: f }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Target className="w-5 h-5 text-mango-info" />
        <h2 className="text-lg font-semibold">Forecast & Run Rate</h2>
      </div>

      <div className="text-xs font-semibold text-mango-muted uppercase tracking-wide">Last {f.windowDays} days</div>
      <div className="text-2xl font-bold mt-1">{usd(f.windowRevenue)}</div>
      <div className="text-xs text-mango-muted">{usd(f.windowDayAvg)}/day avg · {f.windowDays} days</div>

      <div className="my-4 border-t border-mango-line" />

      <div className="text-xs font-semibold text-mango-muted uppercase tracking-wide">Next 31 day projection</div>
      <div className="text-2xl font-bold mt-1">{usd(f.next31DayProjection)}</div>
      <div className={`text-xs font-medium flex items-center gap-1 ${f.next31ChangePct >= 0 ? 'text-mango-green' : 'text-mango-red'}`}>
        {f.next31ChangePct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {f.next31ChangePct >= 0 ? '+' : ''}{f.next31ChangePct.toFixed(1)}% vs current
      </div>
      <div className="text-xs text-mango-muted mt-1">{f.next31WorkingDays} working days × {usd(f.windowDayAvg)}/day</div>

      <div className="my-4 border-t border-mango-line" />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xl font-bold">{usd(f.monthly)}</div>
          <div className="text-xs text-mango-muted">Monthly</div>
        </div>
        <div>
          <div className="text-xl font-bold text-mango-muted">{usd(f.annual)}</div>
          <div className="text-xs text-mango-muted">Annual</div>
        </div>
      </div>

      <button
        onClick={() => setOpen(!open)}
        className="mt-5 pt-3 border-t border-mango-line w-full flex items-center justify-between text-sm font-medium text-mango-ink hover:text-mango-orange"
      >
        <span className="flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" /></svg>
          Shop-by-Shop Forecast
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
}
