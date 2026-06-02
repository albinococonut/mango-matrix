'use client';

// Missed Rebooks — the customers who came in this rolling 7-day window
// but did NOT book a future appointment. Surfaced as an expansion under
// each shop row on the Re-Book leaderboard. Mirrors the
// MissedCallbacks pattern: cache-only read, single shared fetch across
// render sites, simple sortable list.

import { useEffect, useState } from 'react';
import { Phone, Car } from 'lucide-react';

interface Row {
  roId: number;
  customerId: number;
  customerName: string;
  phone?: string;
  vehicle?: string;
  postedDate: string;
}

interface ShopBlock {
  shopNum: string;
  shopName: string;
  computedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  customers: Row[];
  pending?: true;
}

interface Response { shops: ShopBlock[] }

let _cached: Response | null = null;
let _error: string | null = null;
let _subscribers: Array<() => void> = [];
let _inflight: Promise<void> | null = null;

async function loadOnce(force = false): Promise<void> {
  if (_inflight && !force) return _inflight;
  _inflight = (async () => {
    try {
      const r = await fetch('/api/extras?view=missed-rebooks', { cache: 'no-store' });
      if (!r.ok) {
        _error = `HTTP ${r.status} loading missed rebooks`;
        _subscribers.forEach(fn => fn());
        return;
      }
      const d = await r.json();
      if (!d || typeof d !== 'object' || !Array.isArray(d.shops)) {
        _error = `unexpected response shape (no shops array)`;
        _subscribers.forEach(fn => fn());
        return;
      }
      _error = null;
      _cached = d;
      _subscribers.forEach(fn => fn());
    } catch (e: any) {
      _error = e?.message || 'network error';
      _subscribers.forEach(fn => fn());
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

function useMissedRebooks(): { data: Response | null; error: string | null } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(x => x + 1);
    _subscribers.push(fn);
    if (!_cached && !_error) loadOnce();
    else force(1);
    return () => { _subscribers = _subscribers.filter(s => s !== fn); };
  }, []);
  return { data: _cached, error: _error };
}

export function MissedRebooksShopList({ shopNum }: { shopNum: string }) {
  const { data, error } = useMissedRebooks();
  const [sortKey, setSortKey] = useState<'date' | 'name'>('date');
  if (error) return <div className="text-xs text-mango-red py-3">Couldn't load customer list: {error}</div>;
  if (!data) return <div className="text-xs text-mango-muted italic py-3">Loading customer list…</div>;
  const shop = data.shops.find(s => s.shopNum === shopNum);
  if (!shop) return null;
  if (shop.pending) return <div className="text-xs text-mango-muted italic py-3">Warming — list appears after the next FBR cron tick (every 15 min).</div>;
  const customers = Array.isArray(shop.customers) ? shop.customers : [];
  if (customers.length === 0) return <div className="text-xs text-mango-green py-3">Every eligible customer this week rebooked ✓</div>;

  const rows = customers.slice();
  if (sortKey === 'name') rows.sort((a, b) => a.customerName.localeCompare(b.customerName));
  else rows.sort((a, b) => (b.postedDate || '').localeCompare(a.postedDate || ''));

  return (
    <div className="bg-mango-bg/30 rounded-lg p-3 mt-2 mb-3">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="text-xs text-mango-muted">
          {rows.length} customer{rows.length === 1 ? '' : 's'} this week didn't rebook · window {shop.windowStart} → {shop.windowEnd}
        </div>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as 'date' | 'name')} className="border border-mango-line rounded-md px-2 py-1 text-xs bg-white">
          <option value="date">Sort: most recent</option>
          <option value="name">Sort: name A→Z</option>
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-mango-muted">
            <tr className="border-b border-mango-line/60">
              <th className="text-left py-1.5 px-2">Customer</th>
              <th className="text-left py-1.5 px-2">Phone</th>
              <th className="text-left py-1.5 px-2">Vehicle</th>
              <th className="text-right py-1.5 px-2">Visit date</th>
              <th className="text-right py-1.5 px-2 w-32">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              // Tekmetric occasionally returns phone as a number rather than
              // a string; coerce defensively before regex-stripping so a
              // single oddball row doesn't crash the entire FBR section.
              const phoneStr = r.phone == null ? '' : String(r.phone);
              const telHref = phoneStr ? `tel:${phoneStr.replace(/[^0-9+]/g, '')}` : undefined;
              return (
                <tr key={r.roId} className="border-b border-mango-line/40 hover:bg-white/60">
                  <td className="py-2 px-2 font-medium text-mango-ink">{r.customerName}</td>
                  <td className="py-2 px-2 text-mango-ink/85 tabular-nums">{phoneStr || '—'}</td>
                  <td className="py-2 px-2 text-mango-ink/85">
                    <span className="inline-flex items-center gap-1.5">
                      <Car className="w-3.5 h-3.5 text-mango-muted" />
                      {r.vehicle || '—'}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right text-xs text-mango-muted tabular-nums">{r.postedDate ? r.postedDate.slice(0, 10) : '—'}</td>
                  <td className="py-2 px-2 text-right">
                    {telHref ? (
                      <a href={telHref} className="inline-flex items-center gap-1 bg-mango-orange text-white text-xs font-semibold px-2.5 py-1 rounded-md hover:bg-mango-orange/90">
                        <Phone className="w-3 h-3" /> Call
                      </a>
                    ) : (
                      <span className="text-xs text-mango-muted italic">no phone</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
