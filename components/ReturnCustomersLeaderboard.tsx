'use client';

// Return Customers + Churn leaderboard. Cache-only read — the cron does the
// 18-month RO pull, this just renders. All percentages use UNIQUE CUSTOMERS,
// never repair orders, and the formulas are surfaced in the UI so the math is
// never a black box.

import { useEffect, useState } from 'react';
import { Repeat, TrendingDown } from 'lucide-react';
import { num, pct } from '@/lib/format';
import { SHOP_BY_NUM } from '@/lib/shops';
import { WindowToggle } from './AppointmentBookedRate';

type WindowKind = 'rolling' | 'this_week';

interface Row {
  shopNum: string;
  shopName: string;
  returns7d?: number;
  total7d?: number;
  return7dPct?: number;
  returnsWtd?: number;
  totalWtd?: number;
  returnWtdPct?: number;
  returns12mo?: number;
  total12mo?: number;
  return12moPct?: number;
  avgVisitsPerYearReturning?: number;
  previouslyActive?: number;
  churned?: number;
  churnPct?: number;
  pending?: true;
}

interface ChainSummary {
  return12moPct: number;
  total12mo: number;
  returns12mo: number;
  avgVisitsPerYearReturning: number;
  churnPct: number;
  previouslyActive: number;
  churned: number;
  shopsReady: number;
  shopsTotal: number;
}

// Plain-English label for a churn % — same thresholds chain-wide and per-shop.
// "Lower churn = healthier" so the bands invert intuitively from a typical
// rate-good = high-good scale.
function churnBand(churnPct: number): { label: string; color: string; bg: string } {
  if (churnPct < 0.35) return { label: 'Strong retention', color: '#1F6D3A', bg: '#E4F4EA' };
  if (churnPct < 0.55) return { label: 'Healthy',          color: '#7A6300', bg: '#FBF1D0' };
  if (churnPct < 0.70) return { label: 'Watch',            color: '#A6510D', bg: '#FBE3CB' };
  return                       { label: 'High churn risk', color: '#8B1F1F', bg: '#F8D7D7' };
}

export default function ReturnCustomersLeaderboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [chain, setChain] = useState<ChainSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowKind, setWindowKind] = useState<WindowKind>('this_week');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/extras?view=return-customers', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!cancelled) { setRows(d?.shops || []); setChain(d?.chain || null); } })
      .catch(e => { if (!cancelled) setError(e?.message || 'Network error'); });
    return () => { cancelled = true; };
  }, []);

  const primaryPct = (r: Row) => (windowKind === 'this_week' ? r.returnWtdPct : r.return7dPct) ?? 0;
  const primaryReturns = (r: Row) => (windowKind === 'this_week' ? r.returnsWtd : r.returns7d) ?? 0;
  const primaryTotal = (r: Row) => (windowKind === 'this_week' ? r.totalWtd : r.total7d) ?? 0;

  // Primary sort = chosen-window return %. Tiebreaker = 12-month return %.
  // Pending shops sink to the bottom so a fresh deploy isn't ranked at zero.
  const sorted = [...(rows || [])].sort((a, b) => {
    if (a.pending && !b.pending) return 1;
    if (!a.pending && b.pending) return -1;
    if (a.pending && b.pending) return 0;
    const p = primaryPct(b) - primaryPct(a);
    if (Math.abs(p) > 1e-9) return p;
    return (b.return12moPct ?? 0) - (a.return12moPct ?? 0);
  });

  const windowLabel = windowKind === 'this_week' ? 'This Week' : 'Rolling 7 Days';
  const windowCopy  = windowKind === 'this_week' ? 'this week (Mon → today MT)' : 'the last 7 days';

  return (
    <div className="card mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <Repeat className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Return Customers — {windowLabel}</h2>
        </div>
        <WindowToggle value={windowKind} onChange={setWindowKind} />
      </div>
      <p className="text-xs text-mango-muted mb-3">
        Ranking: {windowCopy} return % (primary), 12-month return % (tiebreaker). Unique customers, not repair orders.
      </p>

      {/* Explicit formulas so the math isn't a black box. */}
      <div className="text-[11px] text-mango-muted/90 bg-mango-bg/50 rounded-md px-3 py-2 mb-4 space-y-1">
        <div><span className="font-semibold text-mango-ink">12-month return %</span> = unique customers with ≥2 posted ROs in the last 12 months ÷ unique customers with ≥1 posted RO in the last 12 months.</div>
        <div><span className="font-semibold text-mango-ink">Avg visits / year (returning)</span> = mean visit count among customers with ≥2 visits in the last 12 months.</div>
        <div><span className="font-semibold text-mango-ink">Churn %</span> = unique customers active in months 12–18 ago who did NOT come back in the last 12 months ÷ those previously-active customers.</div>
      </div>

      {/* Chain-wide summary stripe (above the per-shop table). */}
      {chain && chain.shopsReady > 0 && (() => {
        const band = churnBand(chain.churnPct);
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-mango-bg/50 rounded-lg p-3">
              <div className="text-xs text-mango-muted">Company 12-month return %</div>
              <div className="text-2xl font-bold tabular-nums mt-0.5">{pct(chain.return12moPct)}</div>
              <div className="text-[11px] text-mango-muted tabular-nums">{num(chain.returns12mo)} / {num(chain.total12mo)} customers</div>
            </div>
            <div className="bg-mango-bg/50 rounded-lg p-3">
              <div className="text-xs text-mango-muted">Company avg visits / year</div>
              <div className="text-2xl font-bold tabular-nums mt-0.5">{chain.avgVisitsPerYearReturning.toFixed(2)}</div>
              <div className="text-[11px] text-mango-muted">returning customers only</div>
            </div>
            <div className="rounded-lg p-3" style={{ background: band.bg }}>
              <div className="text-xs text-mango-muted flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5" />
                Company churn %
              </div>
              <div className="text-2xl font-bold tabular-nums mt-0.5" style={{ color: band.color }}>{pct(chain.churnPct)}</div>
              <div className="text-[11px] tabular-nums" style={{ color: band.color }}>{num(chain.churned)} / {num(chain.previouslyActive)} previously active</div>
            </div>
            <div className="rounded-lg p-3 flex flex-col justify-center" style={{ background: band.bg }}>
              <div className="text-xs uppercase tracking-wide" style={{ color: band.color, opacity: 0.7 }}>Company status</div>
              <div className="text-lg font-bold mt-0.5" style={{ color: band.color }}>{band.label}</div>
              {chain.shopsReady < chain.shopsTotal && (
                <div className="text-[10px] text-mango-muted mt-0.5">{chain.shopsReady} of {chain.shopsTotal} shops warmed</div>
              )}
            </div>
          </div>
        );
      })()}

      {error ? (
        <div className="p-4 bg-mango-red/10 border border-mango-red/30 rounded-md text-sm">
          <div className="font-semibold text-mango-red mb-1">Couldn’t load Return Customers</div>
          <div className="text-mango-muted">{error}</div>
        </div>
      ) : !rows ? (
        <div className="h-[360px] animate-pulse bg-mango-bg rounded-md" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-mango-muted">
              <tr className="border-b border-mango-line">
                <th className="py-2 px-2 text-left w-8">#</th>
                <th className="py-2 px-2 text-left">Shop</th>
                <th className="py-2 px-2 text-right">{windowLabel} Return %</th>
                <th className="py-2 px-2 text-right">{windowLabel} Counts</th>
                <th className="py-2 px-2 text-right">12-mo Return %</th>
                <th className="py-2 px-2 text-right">Visits/yr (returning)</th>
                <th className="py-2 px-2 text-right">Churn %</th>
                <th className="py-2 px-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const meta = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM];
                const color = meta?.color || '#94A3B8';
                const rank = i + 1;
                const band = r.pending ? null : churnBand(r.churnPct ?? 0);
                return (
                  <tr key={r.shopNum} className="border-b border-mango-line/60 hover:bg-mango-bg/40">
                    <td className="py-2 px-2 align-middle text-mango-muted font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        {rank}
                      </span>
                    </td>
                    <td className="py-2 px-2 align-middle">
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                        <span className="font-medium">{r.shopName}</span>
                      </span>
                    </td>
                    {r.pending ? (
                      <td colSpan={6} className="py-2 px-2 text-mango-muted italic text-xs text-right">Warming — data will appear within ~2 hours</td>
                    ) : (
                      <>
                        <td className="py-2 px-2 text-right font-bold tabular-nums" style={{ color }}>{pct(primaryPct(r))}</td>
                        <td className="py-2 px-2 text-right text-xs text-mango-muted tabular-nums">{num(primaryReturns(r))} / {num(primaryTotal(r))}</td>
                        <td className="py-2 px-2 text-right font-semibold tabular-nums" title={`${num(r.returns12mo ?? 0)} returning / ${num(r.total12mo ?? 0)} unique customers in last 12 months`}>{pct(r.return12moPct ?? 0)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{(r.avgVisitsPerYearReturning ?? 0).toFixed(2)}</td>
                        <td className="py-2 px-2 text-right font-semibold tabular-nums" style={{ color: band?.color }} title={`${num(r.churned ?? 0)} churned / ${num(r.previouslyActive ?? 0)} previously active`}>{pct(r.churnPct ?? 0)}</td>
                        <td className="py-2 px-2 align-middle">
                          {band && (
                            <span className="inline-block text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: band.bg, color: band.color }}>
                              {band.label}
                            </span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
