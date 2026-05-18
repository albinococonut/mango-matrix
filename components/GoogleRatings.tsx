'use client';

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { SHOP_BY_NUM } from '@/lib/shops';
import { TrophyIcon } from './Trophy';

interface Review {
  publishTime: string;
  rating: number;
  text: string;
  author: string;
}
interface Row {
  shopNum: string;
  shopName: string;
  rating: number | null;
  total: number;
  recentTotal: number;
  fiveStar: number;
  belowFive: number;
  placeId?: string;
  reviews?: Review[];
}

function gmbUrl(placeId?: string) {
  if (!placeId) return '#';
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

function ReviewsModal({ shop, filter, onClose }: { shop: Row; filter: 'all' | '5' | '<5'; onClose: () => void }) {
  const reviews = (shop.reviews || []).filter(r => {
    if (filter === '5') return r.rating === 5;
    if (filter === '<5') return r.rating > 0 && r.rating < 5;
    return true;
  });
  const title = filter === '5' ? '5★ reviews' : filter === '<5' ? 'Below-5★ reviews' : 'Recent reviews';
  return (
    <div className="fixed inset-0 bg-mango-ink/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-card shadow-card p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold">{shop.shopName} — {title}</h3>
            <p className="text-xs text-mango-muted mt-0.5">
              Google's API returns up to 5 reviews ranked by "relevance," not date — counts may undercount actual 7-day activity.
            </p>
          </div>
          <button onClick={onClose} className="text-mango-muted hover:text-mango-ink text-xl leading-none">×</button>
        </div>
        {reviews.length === 0 ? (
          <div className="text-sm text-mango-muted py-6 text-center">No reviews in this bucket.</div>
        ) : reviews.map((r, i) => (
          <div key={i} className="border-b border-mango-line/60 last:border-0 py-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-sm font-semibold">{r.author}</div>
              <div className="text-mango-amber">{'★'.repeat(r.rating)}<span className="text-mango-line">{'★'.repeat(5 - r.rating)}</span></div>
              <div className="text-xs text-mango-muted ml-auto">{r.publishTime ? new Date(r.publishTime).toLocaleDateString() : ''}</div>
            </div>
            {r.text && <div className="text-sm text-mango-ink/80 whitespace-pre-line">{r.text}</div>}
          </div>
        ))}
        <a href={gmbUrl(shop.placeId)} target="_blank" rel="noreferrer" className="inline-block mt-4 text-sm text-mango-orange hover:underline">
          View all on Google Maps →
        </a>
      </div>
    </div>
  );
}

export default function GoogleRatings() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [modal, setModal] = useState<{ shop: Row; filter: 'all' | '5' | '<5' } | null>(null);

  const [source, setSource] = useState<'gbp' | 'places' | null>(null);
  async function load() {
    // Prefer the Google Business Profile data if available — that's the real,
    // un-truncated review feed. Fall back to the Places API summary otherwise.
    try {
      const r = await fetch('/api/gbp/reviews-summary');
      if (r.ok) {
        const j = await r.json();
        if (j.connected && j.locations?.length) {
          // Merge GBP locations into our shop rows by shop_num.
          const byShop: Record<string, any> = {};
          for (const loc of j.locations) {
            const num = loc.shopNum;
            if (!num) continue;
            const cur = byShop[num] || { shopNum: num, shopName: SHOP_BY_NUM[num as keyof typeof SHOP_BY_NUM]?.name || loc.title, rating: 0, total: 0, recentTotal: 0, fiveStar: 0, belowFive: 0, reviews: [] };
            // Aggregate (covers shops with multiple GBP locations)
            cur.total += loc.totalReviews;
            cur.recentTotal += loc.last7Days.total;
            cur.fiveStar += loc.last7Days.fiveStar;
            cur.belowFive += loc.last7Days.belowFive;
            // Weighted average rating
            if (loc.averageRating !== null) {
              cur.rating = ((cur.rating || 0) * (cur.total - loc.totalReviews) + loc.averageRating * loc.totalReviews) / cur.total;
            }
            byShop[num] = cur;
          }
          setRows(Object.values(byShop));
          setSource('gbp');
          return;
        }
      }
    } catch {}
    // Fallback to Places.
    const r2 = await fetch('/api/extras?view=google-ratings');
    const d = await r2.json();
    setRows(d?.shops || []);
    setSource('places');
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 15 * 60 * 1000); // auto-refresh every 15 min
    return () => clearInterval(t);
  }, []);

  if (!rows) return <div className="card animate-pulse h-[400px] mb-6" />;

  const byRating = [...rows].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const byRecent = [...rows].sort((a, b) => (b.fiveStar - a.fiveStar) || (b.recentTotal - a.recentTotal));

  // Identical row styling for both panels (vertical spacing + text size).
  function leftRow(r: Row, i: number) {
    const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
    return (
      <div key={r.shopNum} className="flex items-center gap-3 py-2 border-b border-mango-line/60 last:border-0 h-10">
        <div className="w-5 text-mango-muted font-semibold text-sm text-right">{i + 1}</div>
        {i < 3 ? <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={14} /> : <div className="w-3.5" />}
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: meta?.color }} />
        <a href={gmbUrl(r.placeId)} target="_blank" rel="noreferrer"
          className="flex-1 font-medium text-sm hover:text-mango-orange hover:underline">{r.shopName}</a>
        <div className="text-base font-bold tabular-nums w-12 text-right">{r.rating !== null ? r.rating.toFixed(1) : '—'}</div>
        <div className="text-xs text-mango-muted w-20 text-right tabular-nums">{r.total.toLocaleString()} reviews</div>
      </div>
    );
  }
  function rightRow(r: Row, i: number) {
    const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
    return (
      <div key={r.shopNum} className="flex items-center gap-3 py-2 border-b border-mango-line/60 last:border-0 h-10">
        <div className="w-5 text-mango-muted font-semibold text-sm text-right">{i + 1}</div>
        {i < 3 ? <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={14} /> : <div className="w-3.5" />}
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: meta?.color }} />
        <a href={gmbUrl(r.placeId)} target="_blank" rel="noreferrer"
          className="flex-1 font-medium text-sm hover:text-mango-orange hover:underline">{r.shopName}</a>
        <button onClick={() => setModal({ shop: r, filter: '5' })} className="text-sm font-semibold text-mango-green tabular-nums hover:underline w-10 text-right" title="Show 5★ reviews">{r.fiveStar} ★5</button>
        <button onClick={() => setModal({ shop: r, filter: '<5' })} className="text-sm font-semibold text-mango-red tabular-nums hover:underline w-8 text-right" title="Show below-5★ reviews">{r.belowFive} ↓</button>
        <button onClick={() => setModal({ shop: r, filter: 'all' })} className="text-xs text-mango-muted tabular-nums hover:underline w-12 text-right">{r.recentTotal} total</button>
      </div>
    );
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Star className="w-5 h-5 text-mango-amber" />
        <h2 className="text-lg font-semibold">Google Ratings — This Week</h2>
      </div>
      <p className="text-xs text-mango-muted mb-4">
        Click a shop name to open its Google Maps page. Click any review count to see what was written. Auto-refreshes every 15 min.
        {source === 'gbp' && <> · <span className="text-mango-green font-medium">Source: Business Profile API (full review history)</span></>}
        {source === 'places' && <> · <span className="text-mango-amber font-medium">Source: Places API (5 most-relevant reviews only — connect Business Profile in <a className="underline" href="/admin/gbp">admin</a> for accurate 7-day counts)</span></>}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-mango-bg/40 rounded-lg p-3">
          <div className="text-xs font-semibold text-mango-muted mb-2 uppercase tracking-wide">Current Google rating</div>
          {byRating.map(leftRow)}
        </div>
        <div className="bg-mango-amber/5 rounded-lg p-3">
          <div className="text-xs font-semibold text-mango-muted mb-2 uppercase tracking-wide">New reviews (last 7 days)</div>
          {byRecent.map(rightRow)}
        </div>
      </div>

      {modal && <ReviewsModal shop={modal.shop} filter={modal.filter} onClose={() => setModal(null)} />}
    </div>
  );
}
