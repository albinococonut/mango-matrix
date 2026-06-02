'use client';

// Reviews leaderboard. Two panels side-by-side:
//
//   LEFT  — "Current Google rating" per shop. Cumulative ★ rating + total
//           review count + clickable Google Maps link. Sourced from
//           Google Places API (once-a-day cron writes the cache).
//
//   RIGHT — "New reviews" in a window (rolling 7d ↔ this week toggle).
//           Sourced from the Zapier review webhook — each new review
//           POSTs to /api/webhooks/review-ingest as it lands, so windowed
//           counts are real-time and accurate (Places only ever returns
//           5 relevance-sorted reviews per shop, so windows there are
//           unreliable).
//
// Two sources, merged client-side. Cumulative totals only Places knows;
// new-event windows only Zapier knows.

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { SHOP_BY_NUM } from '@/lib/shops';
import { TrophyIcon } from './Trophy';
import { WindowToggle } from './AppointmentBookedRate';

type WindowKind = 'rolling' | 'this_week';
interface Review {
  publishTime: string;
  rating: number;
  text: string;
  author: string;
}
interface WindowSlice {
  total: number;
  fiveStar: number;
  belowFive: number;
  reviews: Review[];
}
interface Row {
  shopNum: string;
  shopName: string;
  rating: number | null;
  total: number;
  placeId?: string;
  windows: { rolling7d: WindowSlice; thisWeek: WindowSlice };
}

const EMPTY_SLICE: WindowSlice = { total: 0, fiveStar: 0, belowFive: 0, reviews: [] };

function gmbUrl(placeId?: string) {
  if (!placeId) return '#';
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

function ReviewsModal({ shop, filter, windowReviews, onClose }: { shop: Row; filter: 'all' | '5' | '<5'; windowReviews: Review[]; onClose: () => void }) {
  const reviews = windowReviews.filter(r => {
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
              From the Zapier review feed (live, no truncation).
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
  const [windowKind, setWindowKind] = useState<WindowKind>('this_week');

  async function load() {
    // Places gives us cumulative rating + total + placeId. Zapier gives us
    // accurate windowed counts (rolling-7d, this-week). Merge by shopNum.
    const [placesRes, zapierRes] = await Promise.all([
      fetch('/api/extras?view=google-ratings').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/extras?view=zapier-reviews').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    const zapierByShop: Record<string, any> = {};
    for (const s of (zapierRes?.shops || [])) zapierByShop[s.shopNum] = s;
    const placesByShop: Record<string, any> = {};
    for (const s of (placesRes?.shops || [])) placesByShop[s.shopNum] = s;

    // Build the merged row set. Use placesRes.shops as the primary index
    // (it includes every shop, even those Zapier doesn't know about yet).
    // If for some reason places came back empty, fall back to zapier's list.
    const primary: any[] = placesRes?.shops?.length ? placesRes.shops : zapierRes?.shops || [];
    const merged: Row[] = primary.map((p: any) => {
      const z = zapierByShop[p.shopNum];
      const places = placesByShop[p.shopNum] || {};
      return {
        shopNum: p.shopNum,
        shopName: p.shopName,
        rating: places.rating ?? null,
        total: places.total ?? 0,
        placeId: places.placeId,
        windows: z?.windows || { rolling7d: EMPTY_SLICE, thisWeek: EMPTY_SLICE },
      };
    });
    setRows(merged);
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 15 * 60 * 1000); // auto-refresh every 15 min
    return () => clearInterval(t);
  }, []);

  if (!rows) return <div className="card animate-pulse h-[400px] mb-6" />;

  const windowSlice = (r: Row): WindowSlice =>
    windowKind === 'this_week' ? r.windows.thisWeek : r.windows.rolling7d;

  const byRating = [...rows].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const byRecent = [...rows].sort((a, b) => {
    const ws = windowSlice(a); const wb = windowSlice(b);
    return (wb.fiveStar - ws.fiveStar) || (wb.total - ws.total);
  });

  const windowLabel = windowKind === 'this_week' ? 'This Week' : 'Rolling 7 Days';
  const windowCopy  = windowKind === 'this_week' ? 'this week (Mon → today MT)' : 'last 7 days';

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
        <div className="text-xs text-mango-muted w-16 text-right tabular-nums">{r.total.toLocaleString()}</div>
      </div>
    );
  }

  function rightRow(r: Row, i: number) {
    const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
    const w = windowSlice(r);
    return (
      <div key={r.shopNum} className="flex items-center gap-3 py-2 border-b border-mango-line/60 last:border-0 h-10">
        <div className="w-5 text-mango-muted font-semibold text-sm text-right">{i + 1}</div>
        {i < 3 ? <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={14} /> : <div className="w-3.5" />}
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: meta?.color }} />
        <a href={gmbUrl(r.placeId)} target="_blank" rel="noreferrer"
          className="flex-1 font-medium text-sm hover:text-mango-orange hover:underline">{r.shopName}</a>
        <button onClick={() => setModal({ shop: r, filter: '5' })} className="text-sm font-semibold text-mango-green tabular-nums hover:underline w-10 text-right" title="Show 5★ reviews">{w.fiveStar}</button>
        <button onClick={() => setModal({ shop: r, filter: '<5' })} className="text-sm font-semibold text-mango-amber tabular-nums hover:underline w-12 text-right" title="Show 1–4★ reviews">{w.belowFive}</button>
        <button onClick={() => setModal({ shop: r, filter: 'all' })} className="text-xs text-mango-muted tabular-nums hover:underline w-12 text-right">{w.total}</button>
      </div>
    );
  }

  return (
    <div className="card mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-mango-amber" />
          <h2 className="text-lg font-semibold">Google Ratings — {windowLabel}</h2>
        </div>
        <WindowToggle value={windowKind} onChange={setWindowKind} />
      </div>
      <p className="text-xs text-mango-muted mb-4">
        Click any shop name to open its Google Maps page. Click a review count to see what was written. Auto-refreshes every 15 min. Cumulative rating + total update once a day; new-review counts arrive in real time from your Zapier feed.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-mango-bg/40 rounded-lg p-3">
          <div className="text-xs font-semibold text-mango-muted mb-2 uppercase tracking-wide">Current Google rating</div>
          {/* Column headers — align with cell widths in leftRow */}
          <div className="flex items-center gap-3 pb-1 mb-1 border-b border-mango-line/60 text-[10px] uppercase tracking-wide text-mango-faint font-semibold">
            <div className="w-5" /> {/* rank */}
            <div className="w-3.5" /> {/* trophy slot */}
            <div className="w-2.5" /> {/* shop color dot */}
            <span className="flex-1">Shop</span>
            <span className="w-12 text-right">Rating</span>
            <span className="w-16 text-right">Reviews</span>
          </div>
          {byRating.map(leftRow)}
        </div>
        <div className="bg-mango-amber/5 rounded-lg p-3">
          <div className="text-xs font-semibold text-mango-muted mb-2 uppercase tracking-wide">New reviews ({windowCopy})</div>
          {/* Column headers — align with cell widths in rightRow */}
          <div className="flex items-center gap-3 pb-1 mb-1 border-b border-mango-line/60 text-[10px] uppercase tracking-wide text-mango-faint font-semibold">
            <div className="w-5" /> {/* rank */}
            <div className="w-3.5" /> {/* trophy slot */}
            <div className="w-2.5" /> {/* shop color dot */}
            <span className="flex-1">Shop</span>
            <span className="w-10 text-right text-mango-green">5★</span>
            <span className="w-12 text-right text-mango-amber">1–4★</span>
            <span className="w-12 text-right">Total</span>
          </div>
          {byRecent.map(rightRow)}
        </div>
      </div>

      {modal && <ReviewsModal shop={modal.shop} filter={modal.filter} windowReviews={windowSlice(modal.shop).reviews} onClose={() => setModal(null)} />}
    </div>
  );
}
