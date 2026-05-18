'use client';

import { useState } from 'react';
import { AlertCircle, ChevronDown, Store } from 'lucide-react';
import { num, pct } from '@/lib/format';
import type { OpportunityResult } from '@/lib/metrics';

export default function RevenueOpportunityCard({ data }: { data: OpportunityResult | null }) {
  const [open, setOpen] = useState(false);
  if (!data) return <div className="card animate-pulse h-[300px]" />;
  const fillPct = data.targetRate ? (data.closeRate / data.targetRate) * 100 : 0;
  const gap = data.targetRate - data.closeRate;
  const additional = Math.round(data.jobsPresented * gap);
  return (
    <div className="card bg-amber-50/60 border border-amber-200">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="w-5 h-5 text-mango-amber" />
        <h2 className="text-lg font-semibold">Revenue Opportunity</h2>
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div>
          <div className="text-3xl font-bold">{pct(data.closeRate)}</div>
          <div className="text-xs text-mango-muted mt-1">Your Close Rate</div>
        </div>
        <div>
          <div className="text-3xl font-bold text-mango-muted">{pct(data.targetRate, 0)}</div>
          <div className="text-xs text-mango-muted mt-1">Top Shop Target</div>
        </div>
        <div>
          <div className="text-3xl font-bold">{num(data.jobsNotApproved)}</div>
          <div className="text-xs text-mango-muted mt-1">Jobs Not Approved</div>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex justify-between text-xs text-mango-muted mb-1.5">
          <span>{num(data.jobsApproved)} approved</span>
          <span>{num(data.jobsPresented)} presented</span>
        </div>
        <div className="relative h-2.5 bg-mango-line rounded-full overflow-hidden">
          <div className="h-full bg-mango-orange rounded-full" style={{ width: `${Math.min(100, fillPct)}%` }} />
          <div className="absolute top-0 h-full w-px bg-mango-ink" style={{ left: '75%' }} />
        </div>
        <div className="text-right text-xs text-mango-muted mt-1">Target: {pct(data.targetRate, 0)}</div>
      </div>

      {gap > 0 && (
        <p className="mt-4 text-sm text-mango-red font-medium">
          Closing {pct(gap)} more work would mean ~{additional} additional jobs approved.
        </p>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="mt-5 pt-3 border-t border-amber-200 w-full flex items-center justify-between text-sm font-medium text-mango-ink hover:text-mango-orange"
      >
        <span className="flex items-center gap-1.5"><Store className="w-4 h-4" /> Shop-by-Shop Close Rates</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-1">
          {data.byShop.map((s) => (
            <div key={s.shopNum} className="flex items-center justify-between py-1.5 text-sm border-t border-amber-100">
              <span>{s.shopName}</span>
              <div className="flex items-center gap-3">
                <span className="text-mango-muted text-xs">{num(s.approved)} / {num(s.presented)}</span>
                <span className={`font-semibold ${s.closeRate >= 0.75 ? 'text-mango-green' : s.closeRate >= 0.60 ? 'text-mango-amber' : 'text-mango-red'}`}>
                  {pct(s.closeRate)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
