'use client';

import { DollarSign, Car, Receipt, Target } from 'lucide-react';
import { usd, num, pct } from '@/lib/format';
import type { ChainKpi } from '@/lib/metrics';

function Kpi({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: any;
  label: string;
  value: string;
  tone?: 'default' | 'highlight';
}) {
  return (
    <div className={`card ${tone === 'highlight' ? 'ring-2 ring-mango-orange/30' : ''}`}>
      <div className="kpi-label">
        <Icon className={`w-4 h-4 ${tone === 'highlight' ? 'text-mango-orange' : 'text-mango-muted'}`} />
        <span className={tone === 'highlight' ? 'text-mango-orange font-semibold' : ''}>{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

export default function KpiCards({ kpi }: { kpi: ChainKpi | null }) {
  if (!kpi) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card h-[110px] animate-pulse" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Kpi icon={DollarSign} label="Total Revenue (ex-tax)" value={usd(kpi.totalRevenue)} tone="highlight" />
      <Kpi icon={Car} label="Total Cars" value={num(kpi.totalCars)} />
      <Kpi icon={Receipt} label="Average ARO" value={usd(kpi.averageAro)} />
      <Kpi icon={Target} label="Close Rate" value={pct(kpi.closeRate)} />
    </div>
  );
}
