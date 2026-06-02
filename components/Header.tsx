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
  const ctl =
    'appearance-none bg-white/80 border border-mango-line rounded-full text-[13px] font-medium ' +
    'text-mango-ink focus:outline-none focus:ring-2 focus:ring-mango-info/25 focus:border-mango-info/40 ' +
    'cursor-pointer transition hover:border-mango-faint';
  return (
    <header className="sticky top-3 z-30 mb-7 flex justify-end">
      <div className="glass-bar inline-flex items-center gap-2 flex-wrap rounded-full px-2 py-1.5 shadow-soft">
        <div className="relative">
          <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-mango-faint pointer-events-none" />
          <select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className={`${ctl} pl-9 pr-8 py-2.5 min-h-[44px]`}>
            {RANGES.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mango-faint pointer-events-none" />
        </div>
        {range === 'custom' && setCustomStart && setCustomEnd && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={customStart || ''} onChange={(e) => setCustomStart(e.target.value)}
              className={`${ctl} px-3 py-2.5 min-h-[44px]`} />
            <span className="text-mango-faint text-sm">→</span>
            <input type="date" value={customEnd || ''} onChange={(e) => setCustomEnd(e.target.value)}
              className={`${ctl} px-3 py-2.5 min-h-[44px]`} />
          </div>
        )}
        <div className="relative">
          <Store className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-mango-faint pointer-events-none" />
          <select value={shop} onChange={(e) => setShop(e.target.value as ShopNum | 'all')} className={`${ctl} pl-9 pr-8 py-2.5 min-h-[44px]`}>
            <option value="all">All Shops</option>
            {SHOPS.map((s) => (<option key={s.num} value={s.num}>{s.name}</option>))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mango-faint pointer-events-none" />
        </div>
      </div>
    </header>
  );
}
