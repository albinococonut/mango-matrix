'use client';

import { Calendar, ChevronDown, Store } from 'lucide-react';
import type { RangeKey } from '@/lib/dates';
import { SHOPS, ShopNum } from '@/lib/shops';

const RANGES: { value: RangeKey; label: string }[] = [
  { value: 'this_week',      label: 'This Week' },
  { value: 'last_week',      label: 'Last Week' },
  { value: 'this_month',     label: 'This Month' },
  { value: 'last_month',     label: 'Last Month' },
  { value: 'this_quarter',   label: 'This Quarter' },
  { value: 'last_quarter',   label: 'Last Quarter' },
  { value: 'this_year',      label: 'This Year' },
  { value: 'last_year',      label: 'Last Year' },
  { value: 'last_30_days',   label: 'Last 30 Days' },
  { value: 'last_60_days',   label: 'Last 60 Days' },
  { value: 'last_90_days',   label: 'Last 90 Days' },
  { value: 'last_365_days',  label: 'Last 365 Days' },
  { value: 'custom',         label: 'Custom' },
];

export default function Header({
  range,
  setRange,
  shop,
  setShop,
  customStart,
  setCustomStart,
  customEnd,
  setCustomEnd,
}: {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  shop: ShopNum | 'all';
  setShop: (s: ShopNum | 'all') => void;
  customStart?: string;
  setCustomStart?: (v: string) => void;
  customEnd?: string;
  setCustomEnd?: (v: string) => void;
}) {
  return (
    <header className="flex items-center justify-end mb-6 flex-wrap gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKey)}
            className="appearance-none pl-9 pr-9 py-2 bg-white border border-mango-line rounded-lg text-sm font-medium focus:outline-none focus:border-mango-orange cursor-pointer"
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
        </div>
        {range === 'custom' && setCustomStart && setCustomEnd && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart || ''}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2 py-2 bg-white border border-mango-line rounded-lg text-sm focus:outline-none focus:border-mango-orange"
            />
            <span className="text-mango-muted text-sm">→</span>
            <input
              type="date"
              value={customEnd || ''}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2 py-2 bg-white border border-mango-line rounded-lg text-sm focus:outline-none focus:border-mango-orange"
            />
          </div>
        )}
        <div className="relative">
          <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
          <select
            value={shop}
            onChange={(e) => setShop(e.target.value as ShopNum | 'all')}
            className="appearance-none pl-9 pr-9 py-2 bg-white border border-mango-line rounded-lg text-sm font-medium focus:outline-none focus:border-mango-orange cursor-pointer"
          >
            <option value="all">All Shops</option>
            {SHOPS.map((s) => (
              <option key={s.num} value={s.num}>{s.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mango-muted pointer-events-none" />
        </div>
      </div>
    </header>
  );
}
