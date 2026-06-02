'use client';

// Re-Book at Checkout leaderboard. Uses LAST FULL WEEK so the picture is
// complete (Mon-Sun closed). Bars use per-shop brand colors instead of
// rate-based green/amber/red so the chart matches the rest of the dashboard's
// shop palette. A summary banner totals revenue lost across all shops.

import { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp, CalendarDays, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { pct, num, usd } from '@/lib/format';
import { TrophyIcon } from './Trophy';
import { SHOP_BY_NUM } from '@/lib/shops';
import { WindowToggle } from './AppointmentBookedRate';
import { MissedRebooksShopList } from './MissedRebooks';

type WindowKind = 'rolling' | 'this_week';

interface ShopRow {
  shopNum: string;
  shopName: string;
  fbr: { eligibleROs: number; forwardBookedROs: number; fbrPct: number; avgMonthsToRebook?: number | null };
  kar: { expectedAppts: number; keptAppts: number; karPct: number };
  ramping: boolean;
  woWDelta?: number;
  sparkline?: number[];
}

interface SummaryStrip {
  chainFbr: number;
  chainFbrPriorWeek: number;
  chainKar: number;
  chainReturn180d: number;
  ticketsThisWeek: number;
}

const TARGET = 0.60;

export default function FBRLeaderboard() {
  const [rows, setRows] = useState<ShopRow[] | null>(null);
  const [summary, setSummary] = useState<SummaryStrip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowKind, setWindowKind] = useState<WindowKind>('this_week');
  // Which shop's missed-rebook customer list is open. Only one open at a
  // time to keep the row layout scannable. Only shows on rolling-7d view
  // (the missed-rebook cache is rolling-7 only).
  const [expandedShop, setExpandedShop] = useState<string | null>(null);
  // Per-shop ARO — used to estimate Revenue Lost on not-rebooked customers.
  // Pulls from the window matching the toggle so ARO denominator and the
  // re-book counts agree.
  const [aroByShop, setAroByShop] = useState<Record<string, number>>({});

  useEffect(() => {
    const aroRange = windowKind === 'this_week' ? 'this_week' : 'last_7_days';
    fetch(`/api/metrics?range=${aroRange}`).then(r => r.json()).then(d => {
      const map: Record<string, number> = {};
      for (const s of (d?.kpi?.byShop || [])) map[s.shopNum] = s.aro;
      setAroByShop(map);
    }).catch(() => {});
  }, [windowKind]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setRows(null); setSummary(null); setError(null);
    const fbrUrl = windowKind === 'this_week'
      ? '/api/fbr?view=leaderboard_wtd'
      : '/api/fbr?view=leaderboard';
    async function load() {
      setError(null);
      try {
        const res = await fetch(fbrUrl);
        if (!res.ok) {
          if (!cancelled) setError(`Server returned ${res.status}. The first load can take a few minutes — give it a moment and refresh.`);
          return;
        }
        const d = await res.json();
        if (cancelled) return;
        if (d.error) { setError(d.error); return; }
        if (d.warming) {
          // Durable Redis cache not yet seeded (true cold start only — once any
          // shop is warmed the numbers persist and we never re-enter this).
          // Silently retry; the skeleton stays up, no "calculating" message.
          retryTimer = setTimeout(load, 30_000);
          return;
        }
        const shops: ShopRow[] = d.shops || [];
        setRows(shops);
        const chainElig = shops.reduce((s, r) => s + (r.fbr?.eligibleROs ?? 0), 0);
        const chainBooked = shops.reduce((s, r) => s + (r.fbr?.forwardBookedROs ?? 0), 0);
        const chainKarN = shops.reduce((s, r) => s + (r.kar?.keptAppts ?? 0), 0);
        const chainKarD = shops.reduce((s, r) => s + (r.kar?.expectedAppts ?? 0), 0);
        setSummary({
          chainFbr: chainElig ? chainBooked / chainElig : 0,
          chainFbrPriorWeek: 0,
          chainKar: chainKarD ? chainKarN / chainKarD : 0,
          chainReturn180d: 0,
          ticketsThisWeek: chainElig,
        });
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Network error');
      }
    }
    load();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [windowKind]);

  // Chain-wide revenue lost = sum across shops of (missed customers × that shop's ARO).
  const totalRevenueLost = (rows || []).reduce((sum, r) => {
    const aro = aroByShop[r.shopNum] || 0;
    const missed = Math.max(0, (r.fbr?.eligibleROs ?? 0) - (r.fbr?.forwardBookedROs ?? 0));
    return sum + missed * aro;
  }, 0);
  const totalMissed = (rows || []).reduce((sum, r) =>
    sum + Math.max(0, (r.fbr?.eligibleROs ?? 0) - (r.fbr?.forwardBookedROs ?? 0)), 0);

  const windowLabel = windowKind === 'this_week' ? 'This Week' : 'Rolling 7 Days';
  const windowCopy  = windowKind === 'this_week' ? 'this week (Mon → today)' : 'the last 7 days';
  return (
    <div className="card mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Customers who Re-Booked — {windowLabel}</h2>
        </div>
        <WindowToggle value={windowKind} onChange={setWindowKind} />
      </div>
      <p className="text-xs text-mango-muted mb-4">% of closed retail tickets in {windowCopy} where the customer booked a future appointment — at checkout or within 14 days of leaving (callback bookings count).</p>

      {rows && totalRevenueLost > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-mango-red/10 border border-mango-red/30 flex items-center justify-between">
          <div>
            <div className="text-xs text-mango-muted uppercase tracking-wide font-medium">Total future revenue lost by not rebooking ({windowCopy})</div>
            <div className="text-2xl font-bold text-mango-red tabular-nums">{usd(totalRevenueLost)}</div>
          </div>
          <div className="text-right text-xs text-mango-muted">
            <div>{num(totalMissed)} customers walked out without a future appointment</div>
            <div className="opacity-75 mt-0.5">Each = ~1 missed future ticket at the shop's average RO value</div>
          </div>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <SummaryCard label={`Company Re-Book Rate (${windowLabel.toLowerCase()})`} value={pct(summary.chainFbr)} delta={summary.chainFbr - summary.chainFbrPriorWeek} />
          <SummaryCard label="Company KAR (kept appts)" value={pct(summary.chainKar)} />
          <SummaryCard label="180d Return Rate" value={summary.chainReturn180d ? pct(summary.chainReturn180d) : '—'} hint="Monthly refresh" />
          <SummaryCard label="Tickets closed (eligible)" value={num(summary.ticketsThisWeek)} />
        </div>
      )}

      {error ? (
        <div className="p-4 bg-mango-red/10 border border-mango-red/30 rounded-md text-sm">
          <div className="font-semibold text-mango-red mb-1">Couldn't load Re-Book data</div>
          <div className="text-mango-muted">{error}</div>
        </div>
      ) : !rows ? (
        <div className="h-[400px] animate-pulse bg-mango-bg rounded-md" />
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const shopMeta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
            const shopColor = shopMeta?.color || '#94A3B8';
            const barPct = Math.min(100, (r.fbr.fbrPct / Math.max(TARGET * 1.5, 1e-6)) * 100);
            const aro = aroByShop[r.shopNum] || 0;
            const missed = Math.max(0, (r.fbr?.eligibleROs ?? 0) - (r.fbr?.forwardBookedROs ?? 0));
            const revLost = missed * aro;
            return (
              <div key={r.shopNum}>
                <div className="grid grid-cols-12 items-center gap-3 p-3 bg-mango-bg/40 rounded-lg hover:bg-mango-bg/80">
                  <div className="col-span-1 text-mango-muted font-semibold flex items-center gap-1.5">
                    {i + 1}{i < 3 && <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={14} />}
                  </div>
                  <div className="col-span-3 flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: shopColor }} />
                    <div>
                      <div className="font-semibold leading-tight">{r.shopName}</div>
                      <div className="text-xs text-mango-muted">Shop {r.shopNum}{r.ramping ? ' · Ramping' : ''}</div>
                    </div>
                  </div>
                  <div className="col-span-2 text-2xl font-bold tabular-nums" style={{ color: shopColor }}>{pct(r.fbr.fbrPct)}</div>
                  <div className="col-span-2">
                    <div className="relative h-2.5 bg-mango-line rounded-full overflow-hidden">
                      <div className="h-full" style={{ width: `${barPct}%`, background: shopColor }} />
                      <div className="absolute top-0 h-full w-px bg-mango-ink" style={{ left: `${(TARGET / (TARGET * 1.5)) * 100}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-mango-muted mt-0.5">
                      <span>0%</span>
                      <span>Target {pct(TARGET, 0)}</span>
                      <span>{pct(TARGET * 1.5, 0)}</span>
                    </div>
                  </div>
                  <div className="col-span-1 text-right text-xs text-mango-muted" title="Booked / Eligible">
                    {num(r.fbr.forwardBookedROs)}/{num(r.fbr.eligibleROs)}
                  </div>
                  <div className="col-span-2 text-right" title="Mean months from RO close to the rebooked appointment's scheduled start">
                    <div className="text-xs text-mango-muted">Avg time to rebook</div>
                    <div className="font-bold text-sm tabular-nums text-mango-ink">
                      {r.fbr.avgMonthsToRebook != null ? `${r.fbr.avgMonthsToRebook.toFixed(1)} mo` : '—'}
                    </div>
                  </div>
                  <div className="col-span-1 text-right" title={`${missed} not rebooked × ARO ${usd(aro)}`}>
                    <div className="text-xs text-mango-muted">Rev. lost</div>
                    <div className="font-bold text-mango-red text-sm tabular-nums">{aro ? usd(revLost) : '—'}</div>
                  </div>
                </div>
                {windowKind === 'rolling' && missed > 0 && (
                  <div className="mt-1 flex items-center justify-end pr-2">
                    <button
                      onClick={() => setExpandedShop(expandedShop === r.shopNum ? null : r.shopNum)}
                      className="inline-flex items-center gap-1 text-[11px] text-mango-muted hover:text-mango-orange"
                      title="Show the customers who didn't rebook this week"
                    >
                      <Users className="w-3.5 h-3.5" />
                      {missed} customers didn't rebook
                      {expandedShop === r.shopNum ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
                {windowKind === 'rolling' && expandedShop === r.shopNum && (
                  <MissedRebooksShopList shopNum={r.shopNum} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, delta, hint }: { label: string; value: string; delta?: number; hint?: string }) {
  return (
    <div className="bg-white border border-mango-line rounded-lg p-3">
      <div className="text-xs text-mango-muted">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value}</div>
      {delta !== undefined && delta !== 0 && (
        <div className={`text-[11px] font-medium flex items-center gap-1 mt-0.5 ${delta >= 0 ? 'text-mango-green' : 'text-mango-red'}`}>
          {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}pp vs last week
        </div>
      )}
      {hint && <div className="text-[10px] text-mango-muted mt-1">{hint}</div>}
    </div>
  );
}
