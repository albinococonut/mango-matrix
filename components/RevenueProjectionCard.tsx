'use client';

import { TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { usd } from '@/lib/format';

interface Props {
  next14Days: number;
  perDayAvg: number;
  capacityConstrained: boolean;
  dailyTechCapacity: number;
  approvedPipeline: number;
  daysOfApprovedWork: number;
  techCount: number;
  techHoursPerDay: number;
  laborRatePerHour: number;
  runRateMonthly: number;
  runRateAnnualProjected: number;
  runRateAnnualLast12MoActual: number;
  whatsDriving: string[];
  openROCount: number;
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, max ? (value / max) * 100 : 0);
  return (
    <div className="h-2 bg-mango-line rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function RevenueProjectionCard(p: Props) {
  const capColor = p.capacityConstrained ? '#3B82F6' : '#19A268';
  const pipelineColor = '#19A268';
  return (
    <div className="card mb-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Revenue Projection</h2>
        </div>
        <span className="text-sm text-mango-muted">Next 14 days</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div>
          <div className="text-4xl font-bold tracking-tight">{usd(p.next14Days)}</div>
          <div className="text-sm text-mango-muted mt-1">{usd(p.perDayAvg)}/day avg</div>
          {p.capacityConstrained && (
            <span className="pill-amber mt-3">
              <AlertTriangle className="w-3 h-3 mr-1" /> Capacity-Constrained
            </span>
          )}
          <p className="mt-3 text-sm text-mango-ink/80">
            You have {usd(p.approvedPipeline)} of approved work waiting ({p.openROCount} open ROs), but techs can only produce {usd(p.dailyTechCapacity)}/day. {p.capacityConstrained ? 'Consider adding tech capacity.' : ''}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-mango-muted">Daily Tech Capacity</span>
              <span className="font-semibold">{usd(p.dailyTechCapacity)}</span>
            </div>
            <Bar value={p.dailyTechCapacity} max={Math.max(p.dailyTechCapacity, p.approvedPipeline / Math.max(p.daysOfApprovedWork, 1))} color={capColor} />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-mango-muted">Approved Pipeline</span>
              <span className="font-semibold">{usd(p.approvedPipeline)}</span>
            </div>
            <Bar value={p.approvedPipeline} max={p.approvedPipeline} color={pipelineColor} />
          </div>
          <div className="text-sm">
            <span className="font-semibold">{p.daysOfApprovedWork}</span>
            <span className="text-mango-muted"> days of approved work in pipeline</span>
          </div>
          <div className="text-xs text-mango-muted">
            {p.techCount} techs · {p.techHoursPerDay} hrs/day · ${p.laborRatePerHour}/hr
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-mango-muted flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" /> Run Rates
          </h3>
          <div>
            <div className="text-2xl font-bold">{usd(p.runRateMonthly)}</div>
            <div className="text-xs text-mango-muted">Monthly</div>
          </div>
          <div>
            <div className="text-xl font-semibold text-mango-muted">{usd(p.runRateAnnualProjected)}</div>
            <div className="text-xs text-mango-muted">Annual (Projected)</div>
          </div>
          {p.runRateAnnualLast12MoActual > 0 && (
            <div>
              <div className="text-xl font-semibold text-mango-green">{usd(p.runRateAnnualLast12MoActual)}</div>
              <div className="text-xs text-mango-muted">Annual (Last 12 Mo. Actual)</div>
            </div>
          )}
        </div>
      </div>

      {p.whatsDriving.length > 0 && (
        <div className="mt-6 pt-4 border-t border-mango-line">
          <div className="text-xs font-semibold text-mango-muted uppercase tracking-wide mb-3">What's Driving This</div>
          <ul className="space-y-2 text-sm">
            {p.whatsDriving.map((d, i) => {
              const positive = d.includes('above');
              const Icon = positive ? CheckCircle2 : AlertTriangle;
              const cls = positive ? 'text-mango-green' : 'text-mango-red';
              return (
                <li key={i} className={`flex gap-2 ${cls}`}>
                  <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{d}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
